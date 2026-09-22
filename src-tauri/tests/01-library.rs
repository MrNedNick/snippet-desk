//! Integration coverage for the "Локальная библиотека и FTS" milestone.
//!
//! Unlike `src/db.rs`'s unit tests (which call `db::` functions directly),
//! these drive the actual `#[tauri::command]` functions through a mock Tauri
//! app + managed `DbState`, exercising the same boundary the frontend calls
//! through `invoke`: validation, error-string mapping, and the db layer
//! together.
//!
//! "Отмена импорта" (an edge case named on this milestone's card) has no
//! code here on purpose — import/export doesn't exist yet, it's scheduled
//! for M3 (T13-18) in `plan/blueprints/snippet-desk.md`.

use rusqlite::Connection;
use snippet_desk_lib::commands;
use snippet_desk_lib::db::{self, DbState, NewSnippetInput};
use std::sync::Mutex;
use tauri::Manager;

fn temp_db_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "snippet-desk-integration-{}-{}.sqlite3",
        name,
        uuid::Uuid::new_v4()
    ))
}

fn build_test_app(conn: Connection) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(DbState(Mutex::new(conn)))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("failed to build mock tauri app")
}

fn snippet_input(title: &str, code: &str, language: &str) -> NewSnippetInput {
    NewSnippetInput {
        title: title.into(),
        code: code.into(),
        language: language.into(),
    }
}

#[test]
fn the_full_scenario_create_list_search_works_through_the_command_boundary() {
    let path = temp_db_path("main-scenario");
    let conn = db::open_connection(&path).expect("open db");
    let app = build_test_app(conn);

    let created = commands::create_snippet(
        app.state::<DbState>(),
        snippet_input("Debounce a function", "fn debounce() {}", "rust"),
    )
    .expect("create should succeed");
    assert_eq!(created.title, "Debounce a function");

    let listed = commands::list_snippets(app.state::<DbState>()).expect("list should succeed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, created.id);

    let found = commands::search_snippets(app.state::<DbState>(), "debounce".into())
        .expect("search should succeed");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, created.id);

    std::fs::remove_file(&path).ok();
}

#[test]
fn each_validation_edge_returns_its_own_distinguishable_reason() {
    let path = temp_db_path("validation");
    let conn = db::open_connection(&path).expect("open db");
    let app = build_test_app(conn);

    let empty_title = commands::create_snippet(
        app.state::<DbState>(),
        snippet_input("  ", "code", "rust"),
    );
    assert_eq!(empty_title.unwrap_err(), "title-empty");

    let empty_code =
        commands::create_snippet(app.state::<DbState>(), snippet_input("Title", "", "rust"));
    assert_eq!(empty_code.unwrap_err(), "code-empty");

    let empty_language =
        commands::create_snippet(app.state::<DbState>(), snippet_input("Title", "code", " "));
    assert_eq!(empty_language.unwrap_err(), "language-empty");

    let empty_query = commands::search_snippets(app.state::<DbState>(), "  ".into());
    assert_eq!(empty_query.unwrap_err(), "query-empty");

    std::fs::remove_file(&path).ok();
}

#[test]
fn special_characters_and_fts_operators_round_trip_without_breaking_search() {
    let path = temp_db_path("special-characters");
    let conn = db::open_connection(&path).expect("open db");
    let app = build_test_app(conn);

    let odd_title = "He said \"OR\" -x AND y*";
    let odd_code = "let s = \"quote\\\"inside\\\"\"; // OR -1";
    let created = commands::create_snippet(
        app.state::<DbState>(),
        snippet_input(odd_title, odd_code, "rust"),
    )
    .expect("create should accept arbitrary characters");
    assert_eq!(created.title, odd_title);
    assert_eq!(created.code, odd_code);

    let listed = commands::list_snippets(app.state::<DbState>()).expect("list should succeed");
    assert_eq!(listed[0].title, odd_title);

    // A benign term from the odd title must still be searchable safely.
    let found = commands::search_snippets(app.state::<DbState>(), "said".into())
        .expect("search must not choke on stored FTS-operator characters");
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].id, created.id);

    std::fs::remove_file(&path).ok();
}

#[test]
fn creating_two_snippets_with_identical_fields_is_allowed_by_design() {
    let path = temp_db_path("duplicates");
    let conn = db::open_connection(&path).expect("open db");
    let app = build_test_app(conn);

    let first = commands::create_snippet(
        app.state::<DbState>(),
        snippet_input("Retry with backoff", "fn retry() {}", "rust"),
    )
    .expect("first create should succeed");
    let second = commands::create_snippet(
        app.state::<DbState>(),
        snippet_input("Retry with backoff", "fn retry() {}", "rust"),
    )
    .expect("duplicate title/code is not an error");

    assert_ne!(first.id, second.id);
    let listed = commands::list_snippets(app.state::<DbState>()).expect("list should succeed");
    assert_eq!(listed.len(), 2);

    std::fs::remove_file(&path).ok();
}

#[test]
fn opening_a_corrupted_database_file_fails_cleanly_instead_of_panicking() {
    let path = temp_db_path("corrupted");
    std::fs::write(&path, b"not a sqlite file, just garbage bytes").expect("write garbage file");

    let result = db::open_connection(&path);
    assert!(
        result.is_err(),
        "a corrupted file must surface as an error, not open silently or panic"
    );

    std::fs::remove_file(&path).ok();
}
