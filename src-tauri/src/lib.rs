mod creator_auth;
mod database;
mod hotkey_helper;
mod system_effects;

use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};
use tauri_plugin_autostart::MacosLauncher;

pub fn run_hotkey_helper_if_requested() -> bool {
    hotkey_helper::run_if_requested()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(
        |app, _arguments, _working_directory| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        },
    ));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        MacosLauncher::LaunchAgent,
        None,
    ));

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(|app| {
            if let Err(error) = system_effects::recover_incomplete_effect(app.handle()) {
                eprintln!("Failed to recover incomplete system effect: {error}");
            }
            let database = database::Database::open(app.handle()).map_err(std::io::Error::other)?;
            app.manage(database);
            #[cfg(windows)]
            app.manage(hotkey_helper::HotkeyHelperState::default());
            #[cfg(not(windows))]
            app.manage(hotkey_helper::HotkeyHelperState);

            #[cfg(desktop)]
            {
                let show = MenuItem::with_id(app, "show", "Открыть Castaryn", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().cloned().expect("tray icon"))
                    .tooltip("Castaryn")
                    .menu(&menu)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            system_effects::cancel_system_effect();
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if matches!(event, tauri::tray::TrayIconEvent::DoubleClick { .. })
                            && let Some(window) = tray.app_handle().get_webview_window("main")
                        {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            database::load_app_state,
            database::save_app_state,
            database::clear_app_state,
            database::export_backup,
            database::import_backup,
            creator_auth::creator_runtime_config,
            creator_auth::begin_creator_login,
            creator_auth::refresh_creator_login,
            creator_auth::logout_creator,
            creator_auth::save_overlay_token,
            creator_auth::load_overlay_token,
            creator_auth::delete_overlay_token,
            creator_auth::creator_api_request,
            creator_auth::open_twitch_authorization,
            creator_auth::open_youtube_authorization,
            system_effects::apply_system_effect,
            system_effects::cancel_system_effect,
            hotkey_helper::configure_hotkey_helper,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
