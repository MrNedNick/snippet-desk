pub mod backup;
pub mod commands;
pub mod db;
pub mod organize;
pub mod quick;
pub mod shortcut;

use commands::{BackupDir, ImportState, ShortcutState, ShortcutStatus};
use db::DbState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = builder.plugin(shortcut::plugin());

    builder
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("no app data dir available");
            // A damaged file no longer stops the app from starting: `DbState` remembers the damage and the
            // page offers to set the file aside.
            let state = DbState::open(&data_dir.join("snippet-desk.sqlite3"));
            let accelerator = state
                .lock()
                .ok()
                .and_then(|conn| quick::shortcut(&conn).ok())
                .unwrap_or_else(|| quick::DEFAULT_SHORTCUT.to_string());
            // Another app may already own the combination; the app still starts and the page says so.
            let status = match shortcut::swap(app.handle(), None, &accelerator) {
                Ok(()) => ShortcutStatus { accelerator, registered: true, error: None },
                Err(error) => ShortcutStatus { accelerator, registered: false, error: Some(error) },
            };
            app.manage(state);
            app.manage(ShortcutState(Mutex::new(status)));
            app.manage(ImportState::default());
            app.manage(BackupDir(data_dir.join("backups")));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_snippet,
            commands::list_snippets,
            commands::search_snippets,
            commands::update_snippet,
            commands::list_revisions,
            commands::set_snippet_tags,
            commands::set_snippet_collection,
            commands::list_collections,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
            commands::library_health,
            commands::set_aside_damaged_library,
            commands::list_recent_uses,
            commands::record_snippet_use,
            commands::get_quick_shortcut,
            commands::set_quick_shortcut,
            commands::export_library,
            commands::pick_import_file,
            commands::apply_import,
            commands::cancel_import,
            commands::create_backup,
            commands::list_backups,
            commands::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
