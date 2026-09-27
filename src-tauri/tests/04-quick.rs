//! Integration coverage for the "Системный поиск и clipboard" milestone: recent uses through the
//! `#[tauri::command]` boundary, and what happens when the library file is damaged.

use snippet_desk_lib::commands;
use snippet_desk_lib::db::{self, DbState, NewSnippetInput};
use tauri::Manager;

fn temp_db_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("snippet-desk-quick-{}-{}.sqlite3", name, uuid::Uuid::new_v4()))
}

fn app(state: DbState) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(state)
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app")
}

fn snippet(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> String {
    commands::create_snippet(
        app.state::<DbState>(),
        NewSnippetInput { title: title.into(), code: "x".into(), language: "rust".into() },
    )
    .expect("create")
    .id
}

#[test]
fn recent_uses_are_deduplicated_and_survive_a_restart() {
    let path = temp_db_path("recent");
    let (retry, fetch) = {
        let app = app(DbState::open(&path));
        let retry = snippet(&app, "Retry");
        let fetch = snippet(&app, "Fetch");
        commands::record_snippet_use(app.state::<DbState>(), retry.clone()).expect("use");
        commands::record_snippet_use(app.state::<DbState>(), fetch.clone()).expect("use");
        let recent = commands::record_snippet_use(app.state::<DbState>(), retry.clone()).expect("use again");
        assert_eq!(recent.len(), 2, "a second use must not add a duplicate");
        (retry, fetch)
    };

    let app = app(DbState::open(&path));
    let recent = commands::list_recent_uses(app.state::<DbState>()).expect("recent");
    let ids: Vec<_> = recent.iter().map(|entry| entry.snippet_id.clone()).collect();
    assert_eq!(ids, [retry, fetch]);
    assert_eq!(
        commands::record_snippet_use(app.state::<DbState>(), "missing".into()).unwrap_err(),
        "snippet-not-found"
    );
}

#[test]
fn a_damaged_file_does_not_crash_the_app_and_is_set_aside_on_request() {
    let path = temp_db_path("damaged");
    std::fs::write(&path, b"this is not an SQLite database, just some bytes").expect("write garbage");

    let app = app(DbState::open(&path));
    let health = commands::library_health(app.state::<DbState>());
    assert_eq!(health.status, "damaged");

    // Every command says why, instead of showing an empty library that would then overwrite the file.
    let listed = commands::list_snippets(app.state::<DbState>()).unwrap_err();
    assert!(listed.starts_with("database-corrupted:"), "{listed}");
    assert!(commands::list_recent_uses(app.state::<DbState>()).unwrap_err().starts_with("database-corrupted:"));

    let kept = commands::set_aside_damaged_library(app.state::<DbState>()).expect("set aside");
    let kept_path = path.with_file_name(&kept);
    assert_eq!(std::fs::read(&kept_path).expect("damaged file kept"), b"this is not an SQLite database, just some bytes");

    assert_eq!(commands::library_health(app.state::<DbState>()).status, "ok");
    assert!(commands::list_snippets(app.state::<DbState>()).expect("fresh library").is_empty());
    snippet(&app, "After recovery");
    assert_eq!(commands::list_snippets(app.state::<DbState>()).unwrap().len(), 1);
    assert_eq!(commands::set_aside_damaged_library(app.state::<DbState>()).unwrap_err(), "database-not-damaged");
}

#[test]
fn a_truncated_library_is_caught_by_the_integrity_check() {
    let path = temp_db_path("truncated");
    {
        let conn = db::open_connection(&path).expect("open");
        for n in 0..200 {
            db::insert_snippet(&conn, &format!("id-{n}"), "Title", &"code ".repeat(200), "text").expect("insert");
        }
    }
    // Cut the file in half, the way an interrupted copy or sync leaves it.
    let bytes = std::fs::read(&path).expect("read");
    std::fs::write(&path, &bytes[..bytes.len() / 2]).expect("truncate");

    let app = app(DbState::open(&path));
    assert_eq!(commands::library_health(app.state::<DbState>()).status, "damaged");
}
