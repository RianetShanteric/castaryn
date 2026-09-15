// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if castaryn_lib::run_hotkey_helper_if_requested() {
        return;
    }

    castaryn_lib::run()
}
