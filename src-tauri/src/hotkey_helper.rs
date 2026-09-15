#[cfg(windows)]
mod windows_impl {
    use std::{
        ffi::OsStr,
        io::{BufRead, BufReader, Read, Write},
        net::{Shutdown, TcpListener, TcpStream},
        os::windows::ffi::OsStrExt,
        sync::Mutex,
        thread,
        time::Duration,
    };

    use rand::RngCore;
    use tauri::{AppHandle, Emitter, State};
    use windows::{
        Win32::{
            Foundation::{GetLastError, LPARAM, WPARAM},
            System::Threading::GetCurrentThreadId,
            UI::{
                Input::KeyboardAndMouse::{
                    HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT,
                    RegisterHotKey, UnregisterHotKey, VK_F1,
                },
                Shell::ShellExecuteW,
                WindowsAndMessaging::{
                    GetMessageW, MSG, PostThreadMessageW, SW_SHOWNORMAL, WM_HOTKEY, WM_QUIT,
                },
            },
        },
        core::PCWSTR,
    };

    const HELPER_FLAG: &str = "--castaryn-hotkey-helper";
    const PRIMARY_ID: i32 = 0x4341;
    const UNDO_ID: i32 = 0x4342;

    #[derive(Default)]
    pub struct HotkeyHelperState {
        connection: Mutex<Option<TcpStream>>,
    }

    impl HotkeyHelperState {
        fn stop(&self) {
            if let Ok(mut guard) = self.connection.lock()
                && let Some(stream) = guard.take()
            {
                let _ = stream.shutdown(Shutdown::Both);
            }
        }
    }

    impl Drop for HotkeyHelperState {
        fn drop(&mut self) {
            self.stop();
        }
    }

    struct HelperArguments {
        port: u16,
        token: String,
        primary: String,
        undo: String,
    }

    pub fn run_if_requested() -> bool {
        let arguments = std::env::args().collect::<Vec<_>>();
        let Some(flag_index) = arguments.iter().position(|value| value == HELPER_FLAG) else {
            return false;
        };
        let Some(parsed) = parse_helper_arguments(&arguments[flag_index + 1..]) else {
            return true;
        };

        if !is_administrator() {
            let _ =
                launch_elevated_helper(parsed.port, &parsed.token, &parsed.primary, &parsed.undo);
            return true;
        }

        let _ = run_helper(parsed);
        true
    }

    pub fn configure(
        app: AppHandle,
        state: State<'_, HotkeyHelperState>,
        primary_shortcut: String,
        undo_shortcut: String,
    ) -> Result<(), String> {
        if primary_shortcut == undo_shortcut {
            return Err("Основное действие и отмена не могут использовать одну клавишу".into());
        }
        parse_shortcut(&primary_shortcut)?;
        parse_shortcut(&undo_shortcut)?;
        state.stop();

        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("Не удалось открыть локальный канал клавиш: {error}"))?;
        listener
            .set_nonblocking(false)
            .map_err(|error| format!("Не удалось настроить локальный канал клавиш: {error}"))?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Не удалось определить локальный канал клавиш: {error}"))?
            .port();
        let token = random_token();
        launch_elevated_helper(port, &token, &primary_shortcut, &undo_shortcut)?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Не удалось настроить ожидание обработчика: {error}"))?;

        let deadline = std::time::Instant::now() + Duration::from_secs(20);
        let (mut stream, _) = loop {
            match listener.accept() {
                Ok(connection) => break connection,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        return Err("Windows не разрешила запуск обработчика горячих клавиш".into());
                    }
                    thread::sleep(Duration::from_millis(50));
                }
                Err(error) => {
                    return Err(format!("Не удалось подключить обработчик клавиш: {error}"));
                }
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .map_err(|error| format!("Не удалось проверить обработчик клавиш: {error}"))?;
        let mut authentication = String::new();
        BufReader::new(
            stream
                .try_clone()
                .map_err(|error| format!("Не удалось проверить обработчик клавиш: {error}"))?,
        )
        .read_line(&mut authentication)
        .map_err(|error| format!("Не удалось проверить обработчик клавиш: {error}"))?;
        if authentication.trim_end() != format!("AUTH {token}") {
            let _ = stream.shutdown(Shutdown::Both);
            return Err("Обработчик горячих клавиш не прошёл проверку".into());
        }
        stream
            .set_read_timeout(None)
            .map_err(|error| format!("Не удалось запустить обработчик клавиш: {error}"))?;

        let shutdown_stream = stream
            .try_clone()
            .map_err(|error| format!("Не удалось сохранить канал клавиш: {error}"))?;
        *state
            .connection
            .lock()
            .map_err(|_| "Состояние обработчика клавиш временно недоступно")? =
            Some(shutdown_stream);

        thread::spawn(move || {
            let mut reader = BufReader::new(&mut stream);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => match line.trim_end() {
                        "PRIMARY" => {
                            let _ = app.emit("castaryn-hotkey-action", "primary");
                        }
                        "UNDO" => {
                            let _ = app.emit("castaryn-hotkey-action", "undo");
                        }
                        _ => {}
                    },
                }
            }
        });
        Ok(())
    }

    fn parse_helper_arguments(values: &[String]) -> Option<HelperArguments> {
        if values.len() != 4 {
            return None;
        }
        let port = values[0].parse().ok()?;
        if values[1].len() != 64 || !values[1].bytes().all(|value| value.is_ascii_hexdigit()) {
            return None;
        }
        parse_shortcut(&values[2]).ok()?;
        parse_shortcut(&values[3]).ok()?;
        Some(HelperArguments {
            port,
            token: values[1].clone(),
            primary: values[2].clone(),
            undo: values[3].clone(),
        })
    }

    fn run_helper(arguments: HelperArguments) -> Result<(), String> {
        let (primary_modifiers, primary_key) = parse_shortcut(&arguments.primary)?;
        let (undo_modifiers, undo_key) = parse_shortcut(&arguments.undo)?;
        unsafe {
            RegisterHotKey(
                None,
                PRIMARY_ID,
                primary_modifiers | MOD_NOREPEAT,
                primary_key,
            )
            .map_err(|_| format!("Основная клавиша уже занята: {}", GetLastError().0))?;
            if let Err(error) =
                RegisterHotKey(None, UNDO_ID, undo_modifiers | MOD_NOREPEAT, undo_key)
            {
                let _ = UnregisterHotKey(None, PRIMARY_ID);
                return Err(format!("Клавиша отмены уже занята: {error}"));
            }
        }

        let mut stream = TcpStream::connect(("127.0.0.1", arguments.port))
            .map_err(|error| format!("Не удалось подключиться к Castaryn: {error}"))?;
        writeln!(stream, "AUTH {}", arguments.token)
            .and_then(|_| stream.flush())
            .map_err(|error| format!("Не удалось подтвердить обработчик: {error}"))?;

        let thread_id = unsafe { GetCurrentThreadId() };
        let mut disconnect_stream = stream
            .try_clone()
            .map_err(|error| format!("Не удалось контролировать соединение: {error}"))?;
        thread::spawn(move || {
            let mut buffer = [0_u8; 1];
            let _ = disconnect_stream.read(&mut buffer);
            unsafe {
                let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
            }
        });

        let mut message = MSG::default();
        loop {
            let result = unsafe { GetMessageW(&mut message, None, 0, 0) };
            if result.0 <= 0 {
                break;
            }
            if message.message == WM_HOTKEY {
                let action = if message.wParam.0 == PRIMARY_ID as usize {
                    "PRIMARY"
                } else if message.wParam.0 == UNDO_ID as usize {
                    "UNDO"
                } else {
                    continue;
                };
                if writeln!(stream, "{action}")
                    .and_then(|_| stream.flush())
                    .is_err()
                {
                    break;
                }
            }
        }
        unsafe {
            let _ = UnregisterHotKey(None, PRIMARY_ID);
            let _ = UnregisterHotKey(None, UNDO_ID);
        }
        Ok(())
    }

    fn parse_shortcut(shortcut: &str) -> Result<(HOT_KEY_MODIFIERS, u32), String> {
        let mut modifiers = MOD_NOREPEAT;
        let mut key = None;
        for part in shortcut.split('+') {
            match part {
                "Shift" => modifiers |= MOD_SHIFT,
                "Control" => modifiers |= MOD_CONTROL,
                "Alt" => modifiers |= MOD_ALT,
                "F1" => key = Some(VK_F1.0 as u32),
                value if value.len() == 1 => {
                    let character = value.as_bytes()[0].to_ascii_uppercase();
                    if character.is_ascii_uppercase() {
                        key = Some(character as u32);
                    } else {
                        return Err("Горячая клавиша содержит неподдерживаемый символ".into());
                    }
                }
                _ => return Err("Горячая клавиша имеет неподдерживаемый формат".into()),
            }
        }
        key.map(|key| (modifiers, key))
            .ok_or_else(|| "В горячей клавише не указана основная клавиша".into())
    }

    fn random_token() -> String {
        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }

    fn is_administrator() -> bool {
        unsafe { windows::Win32::UI::Shell::IsUserAnAdmin().as_bool() }
    }

    fn launch_elevated_helper(
        port: u16,
        token: &str,
        primary: &str,
        undo: &str,
    ) -> Result<(), String> {
        let executable = std::env::current_exe()
            .map_err(|error| format!("Не удалось определить Castaryn: {error}"))?;
        let executable = wide(executable.as_os_str());
        let verb = wide(OsStr::new("runas"));
        let parameters = wide(OsStr::new(&format!(
            "{HELPER_FLAG} {port} {token} {primary} {undo}"
        )));
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(verb.as_ptr()),
                PCWSTR(executable.as_ptr()),
                PCWSTR(parameters.as_ptr()),
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err("Windows отклонила запуск обработчика горячих клавиш".into());
        }
        Ok(())
    }

    fn wide(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn accepts_all_shortcuts_exposed_by_the_desktop_ui() {
            for shortcut in [
                "Shift+F1",
                "Shift+F",
                "Shift+G",
                "Shift+H",
                "Control+F",
                "Control+G",
                "Control+Shift+F",
                "Control+Shift+G",
                "Alt+F",
                "Alt+G",
            ] {
                assert!(parse_shortcut(shortcut).is_ok(), "{shortcut}");
            }
        }

        #[test]
        fn rejects_untrusted_helper_arguments() {
            assert!(parse_helper_arguments(&[]).is_none());
            assert!(
                parse_helper_arguments(&[
                    "1234".into(),
                    "not-a-token".into(),
                    "Shift+F1".into(),
                    "Shift+G".into(),
                ])
                .is_none()
            );
            assert!(parse_shortcut("Shift+Delete").is_err());
        }
    }
}

#[cfg(windows)]
pub use windows_impl::{HotkeyHelperState, run_if_requested};

#[cfg(windows)]
#[tauri::command]
pub fn configure_hotkey_helper(
    app: tauri::AppHandle,
    state: tauri::State<'_, HotkeyHelperState>,
    primary_shortcut: String,
    undo_shortcut: String,
) -> Result<(), String> {
    windows_impl::configure(app, state, primary_shortcut, undo_shortcut)
}

#[cfg(not(windows))]
#[derive(Default)]
pub struct HotkeyHelperState;

#[cfg(not(windows))]
pub fn run_if_requested() -> bool {
    false
}

#[cfg(not(windows))]
#[tauri::command]
pub fn configure_hotkey_helper(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, HotkeyHelperState>,
    _primary_shortcut: String,
    _undo_shortcut: String,
) -> Result<(), String> {
    Err("Изолированный обработчик горячих клавиш доступен только в Windows".into())
}
