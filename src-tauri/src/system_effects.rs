use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemEffectResult {
    accepted: bool,
    panic_shortcut: &'static str,
}

#[tauri::command]
pub fn apply_system_effect(
    app: AppHandle,
    effect: String,
    duration_seconds: u64,
) -> Result<SystemEffectResult, String> {
    let expected_duration = match effect.as_str() {
        "rotate" => 10,
        "mouse_block" | "keyboard_block" | "key_shuffle" => 20,
        "lag" | "mouse_invert" => 30,
        _ => return Err("Unsupported system effect".into()),
    };
    if duration_seconds != expected_duration {
        return Err("Invalid system effect duration".into());
    }

    platform::start(app, &effect, duration_seconds)?;
    Ok(SystemEffectResult {
        accepted: true,
        panic_shortcut: "Ctrl+Shift+F12",
    })
}

#[tauri::command]
pub fn cancel_system_effect() {
    platform::cancel_and_wait();
}

pub fn recover_incomplete_effect(app: &AppHandle) -> Result<(), String> {
    platform::recover_incomplete_effect(app)
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use tauri::AppHandle;

    pub fn start(_app: AppHandle, _effect: &str, _duration_seconds: u64) -> Result<(), String> {
        Err("System effects are available only on Windows".into())
    }

    pub fn cancel_and_wait() {}

    pub fn recover_incomplete_effect(_app: &AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use rand::seq::SliceRandom;
    use serde::{Deserialize, Serialize};
    use std::{
        fs::{self, OpenOptions},
        io::Write,
        mem::{size_of, zeroed},
        path::PathBuf,
        sync::{
            OnceLock, RwLock,
            atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU64, Ordering},
            mpsc,
        },
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };
    use tauri::{AppHandle, Emitter, Manager};
    use windows::{
        Win32::{
            Foundation::{LPARAM, LRESULT, POINT, WPARAM},
            Graphics::Gdi::{
                ChangeDisplaySettingsExW, DEVMODE_DISPLAY_ORIENTATION, DEVMODEW,
                DISP_CHANGE_SUCCESSFUL, DM_DISPLAYORIENTATION, DMDO_180, ENUM_CURRENT_SETTINGS,
                EnumDisplaySettingsW,
            },
            UI::{
                Input::KeyboardAndMouse::{
                    GetAsyncKeyState, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
                    SendInput, VIRTUAL_KEY, VK_F12, VK_LCONTROL, VK_LSHIFT, VK_RCONTROL, VK_RSHIFT,
                },
                WindowsAndMessaging::{
                    CallNextHookEx, DispatchMessageW, GetCursorPos, KBDLLHOOKSTRUCT,
                    LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, PM_REMOVE, PeekMessageW,
                    SetCursorPos, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
                    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYUP, WM_MOUSEMOVE, WM_SYSKEYUP,
                },
            },
        },
        core::PCWSTR,
    };

    const MODE_NONE: u8 = 0;
    const MODE_MOUSE_BLOCK: u8 = 1;
    const MODE_KEYBOARD_BLOCK: u8 = 2;
    const MODE_KEY_REMAP: u8 = 3;
    const MODE_MOUSE_LAG: u8 = 4;
    const MODE_MOUSE_INVERT: u8 = 5;
    const MODE_ROTATE: u8 = 6;
    const INJECTED_MARKER: usize = 0x454C_5956_4F45_564E;
    const RECOVERY_FILE: &str = "active-system-effect.json";

    #[derive(Debug, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct RecoveryRecord {
        version: u8,
        effect: String,
        started_at_unix_ms: u64,
        recovery_needed: bool,
        original_display_orientation: Option<u32>,
    }

    static MODE: AtomicU8 = AtomicU8::new(MODE_NONE);
    static RUNNING: AtomicBool = AtomicBool::new(false);
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    static LAST_MOUSE_X: AtomicI32 = AtomicI32::new(0);
    static LAST_MOUSE_Y: AtomicI32 = AtomicI32::new(0);
    static KEY_MAP: OnceLock<RwLock<[u16; 256]>> = OnceLock::new();

    fn recovery_path(app: &AppHandle) -> Result<PathBuf, String> {
        app.path()
            .app_data_dir()
            .map(|directory| directory.join(RECOVERY_FILE))
            .map_err(|error| format!("Cannot resolve the Castaryn recovery directory: {error}"))
    }

    fn persist_recovery(
        app: &AppHandle,
        effect: &str,
        original_display_orientation: Option<u32>,
    ) -> Result<(), String> {
        let path = recovery_path(app)?;
        let directory = path
            .parent()
            .ok_or_else(|| "Invalid Castaryn recovery path".to_string())?;
        fs::create_dir_all(directory)
            .map_err(|error| format!("Cannot create the Castaryn recovery directory: {error}"))?;
        if path.exists() {
            return Err(
                "A previous system effect still requires recovery; restart Castaryn first".into(),
            );
        }
        let started_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        let source = serde_json::to_vec(&RecoveryRecord {
            version: 1,
            effect: effect.to_owned(),
            started_at_unix_ms,
            recovery_needed: true,
            original_display_orientation,
        })
        .map_err(|error| format!("Cannot encode the system effect recovery state: {error}"))?;
        let temporary_path = path.with_extension("json.tmp");
        let _ = fs::remove_file(&temporary_path);
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary_path)
                .map_err(|error| {
                    format!("Cannot create the system effect recovery state: {error}")
                })?;
            file.write_all(&source).map_err(|error| {
                format!("Cannot save the system effect recovery state: {error}")
            })?;
            file.sync_all().map_err(|error| {
                format!("Cannot flush the system effect recovery state: {error}")
            })?;
            fs::rename(&temporary_path, &path).map_err(|error| {
                format!("Cannot activate the system effect recovery state: {error}")
            })
        })();
        if result.is_err() {
            let _ = fs::remove_file(temporary_path);
        }
        result
    }

    fn clear_recovery(app: &AppHandle) {
        if let Ok(path) = recovery_path(app) {
            let _ = fs::remove_file(path);
        }
    }

    fn load_recovery(app: &AppHandle) -> Result<Option<RecoveryRecord>, String> {
        let path = recovery_path(app)?;
        let source = match fs::read(path) {
            Ok(source) => source,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "Cannot read the system effect recovery state: {error}"
                ));
            }
        };
        let record = serde_json::from_slice::<RecoveryRecord>(&source)
            .map_err(|error| format!("Invalid system effect recovery state: {error}"))?;
        if record.version != 1 {
            return Err("Unsupported system effect recovery state".into());
        }
        Ok(Some(record))
    }

    fn key_map() -> &'static RwLock<[u16; 256]> {
        KEY_MAP.get_or_init(|| {
            let mut identity = [0u16; 256];
            for (index, value) in identity.iter_mut().enumerate() {
                *value = index as u16;
            }
            RwLock::new(identity)
        })
    }

    fn randomize_key_map() -> Result<(), String> {
        let allowed: Vec<u16> = [
            0x57, 0x41, 0x53, 0x44, // WASD
            0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, // 1-9
            0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7A, 0x7B, // F1-F12
        ]
        .into_iter()
        .collect();
        let mut shuffled = allowed.clone();
        shuffled.shuffle(&mut rand::rng());
        let mut mapping = key_map()
            .write()
            .map_err(|_| "Cannot prepare the key remap".to_string())?;
        for (source, target) in allowed.into_iter().zip(shuffled) {
            mapping[source as usize] = target;
        }
        Ok(())
    }

    fn reset_key_map() {
        if let Ok(mut mapping) = key_map().write() {
            for (index, value) in mapping.iter_mut().enumerate() {
                *value = index as u16;
            }
        }
    }

    fn panic_chord_pressed(vk_code: u32) -> bool {
        if vk_code != VK_F12.0 as u32 {
            return false;
        }
        unsafe {
            let control = GetAsyncKeyState(VK_LCONTROL.0 as i32) < 0
                || GetAsyncKeyState(VK_RCONTROL.0 as i32) < 0;
            let shift = GetAsyncKeyState(VK_LSHIFT.0 as i32) < 0
                || GetAsyncKeyState(VK_RSHIFT.0 as i32) < 0;
            control && shift
        }
    }

    unsafe extern "system" fn keyboard_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code < 0 {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        let data = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        if data.flags.contains(LLKHF_INJECTED) || data.dwExtraInfo == INJECTED_MARKER {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        if panic_chord_pressed(data.vkCode) {
            MODE.store(MODE_NONE, Ordering::SeqCst);
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }

        match MODE.load(Ordering::SeqCst) {
            MODE_KEYBOARD_BLOCK => LRESULT(1),
            MODE_KEY_REMAP => {
                let mapped = key_map()
                    .read()
                    .ok()
                    .and_then(|mapping| mapping.get(data.vkCode as usize).copied())
                    .unwrap_or(data.vkCode as u16);
                if mapped == data.vkCode as u16 {
                    return unsafe { CallNextHookEx(None, code, wparam, lparam) };
                }
                let is_key_up = wparam.0 as u32 == WM_KEYUP || wparam.0 as u32 == WM_SYSKEYUP;
                let input = INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: VIRTUAL_KEY(mapped),
                            wScan: 0,
                            dwFlags: if is_key_up {
                                KEYEVENTF_KEYUP
                            } else {
                                Default::default()
                            },
                            time: 0,
                            dwExtraInfo: INJECTED_MARKER,
                        },
                    },
                };
                unsafe {
                    SendInput(&[input], size_of::<INPUT>() as i32);
                }
                LRESULT(1)
            }
            _ => unsafe { CallNextHookEx(None, code, wparam, lparam) },
        }
    }

    unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code < 0 {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        let data = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        if data.flags & LLMHF_INJECTED != 0 || data.dwExtraInfo == INJECTED_MARKER {
            return unsafe { CallNextHookEx(None, code, wparam, lparam) };
        }
        match MODE.load(Ordering::SeqCst) {
            MODE_MOUSE_BLOCK => LRESULT(1),
            MODE_MOUSE_LAG => {
                thread::sleep(Duration::from_millis(85));
                unsafe { CallNextHookEx(None, code, wparam, lparam) }
            }
            MODE_MOUSE_INVERT if wparam.0 as u32 == WM_MOUSEMOVE => {
                let previous_x = LAST_MOUSE_X.load(Ordering::SeqCst);
                let previous_y = LAST_MOUSE_Y.load(Ordering::SeqCst);
                let target_x = previous_x - (data.pt.x - previous_x);
                let target_y = previous_y - (data.pt.y - previous_y);
                LAST_MOUSE_X.store(target_x, Ordering::SeqCst);
                LAST_MOUSE_Y.store(target_y, Ordering::SeqCst);
                let _ = unsafe { SetCursorPos(target_x, target_y) };
                LRESULT(1)
            }
            _ => unsafe { CallNextHookEx(None, code, wparam, lparam) },
        }
    }

    fn current_primary_display() -> Result<DEVMODEW, String> {
        let mut original = DEVMODEW {
            dmSize: size_of::<DEVMODEW>() as u16,
            ..Default::default()
        };
        if !unsafe { EnumDisplaySettingsW(PCWSTR::null(), ENUM_CURRENT_SETTINGS, &mut original) }
            .as_bool()
        {
            return Err("Windows did not return the current display mode".into());
        }
        Ok(original)
    }

    fn change_primary_orientation(orientation: DEVMODE_DISPLAY_ORIENTATION) -> Result<(), String> {
        let mut mode = current_primary_display()?;
        mode.dmFields |= DM_DISPLAYORIENTATION;
        mode.Anonymous1.Anonymous2.dmDisplayOrientation = orientation;
        let result = unsafe {
            ChangeDisplaySettingsExW(PCWSTR::null(), Some(&mode), None, Default::default(), None)
        };
        if result != DISP_CHANGE_SUCCESSFUL {
            return Err("Display rotation is not supported by this configuration".into());
        }
        Ok(())
    }

    fn restore_primary_display(original: &DEVMODEW) -> bool {
        for _ in 0..3 {
            let result = unsafe {
                ChangeDisplaySettingsExW(
                    PCWSTR::null(),
                    Some(original),
                    None,
                    Default::default(),
                    None,
                )
            };
            if result == DISP_CHANGE_SUCCESSFUL {
                return true;
            }
            thread::sleep(Duration::from_millis(250));
        }
        false
    }

    pub fn start(app: AppHandle, effect: &str, duration_seconds: u64) -> Result<(), String> {
        let mode = match effect {
            "rotate" => MODE_ROTATE,
            "mouse_block" => MODE_MOUSE_BLOCK,
            "keyboard_block" => MODE_KEYBOARD_BLOCK,
            "key_shuffle" => MODE_KEY_REMAP,
            "lag" => MODE_MOUSE_LAG,
            "mouse_invert" => MODE_MOUSE_INVERT,
            _ => return Err("Unsupported system effect".into()),
        };
        MODE.compare_exchange(MODE_NONE, mode, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Another system effect is already active".to_string())?;
        if mode == MODE_KEY_REMAP
            && let Err(error) = randomize_key_map()
        {
            MODE.store(MODE_NONE, Ordering::SeqCst);
            return Err(error);
        }
        if mode == MODE_MOUSE_INVERT {
            let mut point = POINT::default();
            if let Err(error) = unsafe { GetCursorPos(&mut point) } {
                MODE.store(MODE_NONE, Ordering::SeqCst);
                return Err(format!("Cannot read mouse position: {error}"));
            }
            LAST_MOUSE_X.store(point.x, Ordering::SeqCst);
            LAST_MOUSE_Y.store(point.y, Ordering::SeqCst);
        }

        let original_display = if mode == MODE_ROTATE {
            let original = match current_primary_display() {
                Ok(original) => original,
                Err(error) => {
                    MODE.store(MODE_NONE, Ordering::SeqCst);
                    return Err(error);
                }
            };
            let orientation = unsafe { original.Anonymous1.Anonymous2.dmDisplayOrientation };
            if let Err(error) = persist_recovery(&app, effect, Some(orientation.0)) {
                MODE.store(MODE_NONE, Ordering::SeqCst);
                return Err(error);
            }
            if let Err(error) = change_primary_orientation(DMDO_180) {
                clear_recovery(&app);
                MODE.store(MODE_NONE, Ordering::SeqCst);
                return Err(error);
            }
            Some(original)
        } else {
            if let Err(error) = persist_recovery(&app, effect, None) {
                MODE.store(MODE_NONE, Ordering::SeqCst);
                if mode == MODE_KEY_REMAP {
                    reset_key_map();
                }
                return Err(error);
            }
            None
        };

        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        RUNNING.store(true, Ordering::SeqCst);
        let original_orientation = original_display
            .as_ref()
            .map(|mode| unsafe { mode.Anonymous1.Anonymous2.dmDisplayOrientation });
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let effect_app = app.clone();
        if let Err(error) = thread::Builder::new()
            .name(format!("castaryn-system-effect-{effect}"))
            .spawn(move || {
                let keyboard_hook = match unsafe {
                    SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), None, 0)
                } {
                    Ok(hook) => hook,
                    Err(error) => {
                        let restored = original_display
                            .as_ref()
                            .is_none_or(restore_primary_display);
                        if restored {
                            clear_recovery(&effect_app);
                        }
                        if mode == MODE_KEY_REMAP {
                            reset_key_map();
                        }
                        MODE.store(MODE_NONE, Ordering::SeqCst);
                        RUNNING.store(false, Ordering::SeqCst);
                        let _ = ready_tx
                            .send(Err(format!("Cannot install keyboard safety hook: {error}")));
                        return;
                    }
                };
                let mouse_hook =
                    if matches!(mode, MODE_MOUSE_BLOCK | MODE_MOUSE_LAG | MODE_MOUSE_INVERT) {
                        match unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), None, 0) } {
                            Ok(hook) => Some(hook),
                            Err(error) => {
                                let _ = unsafe { UnhookWindowsHookEx(keyboard_hook) };
                                let restored = original_display
                                    .as_ref()
                                    .is_none_or(restore_primary_display);
                                if restored {
                                    clear_recovery(&effect_app);
                                }
                                MODE.store(MODE_NONE, Ordering::SeqCst);
                                RUNNING.store(false, Ordering::SeqCst);
                                let _ = ready_tx
                                    .send(Err(format!("Cannot install mouse hook: {error}")));
                                return;
                            }
                        }
                    } else {
                        None
                    };
                let _ = ready_tx.send(Ok(()));

                let deadline = Instant::now() + Duration::from_secs(duration_seconds);
                let mut message: MSG = unsafe { zeroed() };
                while Instant::now() < deadline
                    && GENERATION.load(Ordering::SeqCst) == generation
                    && MODE.load(Ordering::SeqCst) != MODE_NONE
                {
                    while unsafe { PeekMessageW(&mut message, None, 0, 0, PM_REMOVE) }.as_bool() {
                        unsafe {
                            let _ = TranslateMessage(&message);
                            DispatchMessageW(&message);
                        }
                    }
                    thread::sleep(Duration::from_millis(8));
                }

                if GENERATION.load(Ordering::SeqCst) == generation {
                    MODE.store(MODE_NONE, Ordering::SeqCst);
                }
                if let Some(hook) = mouse_hook {
                    let _ = unsafe { UnhookWindowsHookEx(hook) };
                }
                let _ = unsafe { UnhookWindowsHookEx(keyboard_hook) };
                if let Some(original) = original_display {
                    if restore_primary_display(&original) {
                        clear_recovery(&effect_app);
                    } else {
                        let _ = effect_app.emit(
                            "castaryn-system-effect-error",
                            "Не удалось восстановить ориентацию экрана. Выполнены три повторные попытки.",
                        );
                    }
                } else {
                    clear_recovery(&effect_app);
                }
                if mode == MODE_KEY_REMAP {
                    reset_key_map();
                }
                RUNNING.store(false, Ordering::SeqCst);
            })
        {
            let restored = original_orientation
                .map(change_primary_orientation)
                .transpose()
                .is_ok();
            if restored {
                clear_recovery(&app);
            }
            MODE.store(MODE_NONE, Ordering::SeqCst);
            if mode == MODE_KEY_REMAP {
                reset_key_map();
            }
            RUNNING.store(false, Ordering::SeqCst);
            return Err(format!("Cannot start system effect: {error}"));
        }
        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(result) => result,
            Err(_) => {
                cancel_and_wait();
                Err("System effect did not start in time".into())
            }
        }
    }

    pub fn cancel_and_wait() {
        GENERATION.fetch_add(1, Ordering::SeqCst);
        MODE.store(MODE_NONE, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(2);
        while RUNNING.load(Ordering::SeqCst) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn recover_incomplete_effect(app: &AppHandle) -> Result<(), String> {
        let Some(record) = load_recovery(app)? else {
            return Ok(());
        };
        if !record.recovery_needed {
            clear_recovery(app);
            return Ok(());
        }
        if record.effect == "rotate" {
            let orientation = record
                .original_display_orientation
                .ok_or_else(|| "Missing original display orientation".to_string())?;
            let mut restored = false;
            for _ in 0..3 {
                if change_primary_orientation(DEVMODE_DISPLAY_ORIENTATION(orientation)).is_ok() {
                    restored = true;
                    break;
                }
                thread::sleep(Duration::from_millis(250));
            }
            if !restored {
                return Err(
                    "Castaryn could not restore the display orientation from recovery state".into(),
                );
            }
        }
        clear_recovery(app);
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::RecoveryRecord;

        #[test]
        fn recovery_record_round_trips() {
            let record = RecoveryRecord {
                version: 1,
                effect: "rotate".into(),
                started_at_unix_ms: 123,
                recovery_needed: true,
                original_display_orientation: Some(0),
            };
            let encoded = serde_json::to_vec(&record).unwrap();
            let decoded: RecoveryRecord = serde_json::from_slice(&encoded).unwrap();
            assert_eq!(decoded.effect, "rotate");
            assert_eq!(decoded.original_display_orientation, Some(0));
            assert!(decoded.recovery_needed);
        }
    }
}
