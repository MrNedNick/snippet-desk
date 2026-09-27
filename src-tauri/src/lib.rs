pub mod commands;
pub mod db;

use db::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("no app data dir available");
            let conn = db::open_connection(&data_dir.join("snippet-desk.sqlite3"))
                .expect("failed to open snippet-desk database");
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_snippet,
            commands::list_snippets,
            commands::search_snippets,
            commands::update_snippet,
            commands::list_revisions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
