//! Integration coverage for the "Редактор и подсветка" milestone: editing a
//! snippet through the same `#[tauri::command]` boundary the editor calls,
//! over a real temporary SQLite file.

use rusqlite::Connection;
use snippet_desk_lib::commands;
use snippet_desk_lib::db::{self, DbState, NewSnippetInput, UpdateSnippetInput};
use std::sync::Mutex;
use tauri::Manager;

fn temp_db_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "snippet-desk-editor-{}-{}.sqlite3",
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

fn edit(id: &str, title: &str, code: &str, language: &str, note: &str) -> UpdateSnippetInput {
    UpdateSnippetInput {
        id: id.into(),
        title: title.into(),
        code: code.into(),
        language: language.into(),
        note: note.into(),
    }
}

fn created(app: &tauri::App<tauri::test::MockRuntime>, code: &str) -> String {
    commands::create_snippet(
        app.state::<DbState>(),
        NewSnippetInput {
            title: "Debounce".into(),
            code: code.into(),
            language: "typescript".into(),
        },
    )
    .expect("create")
    .id
}

#[test]
fn an_edit_is_saved_its_old_code_kept_and_both_survive_a_restart() {
    let path = temp_db_path("main");
    let id = {
        let app = build_test_app(db::open_connection(&path).expect("open"));
        let id = created(&app, "let a = 1;");
        let saved = commands::update_snippet(
            app.state::<DbState>(),
            edit(&id, "  Debounce v2 ", "let a = 2;\n", " ts ", " bump "),
        )
        .expect("update");
        assert_eq!(saved.title, "Debounce v2");
        assert_eq!(saved.language, "ts");
        assert_eq!(saved.code, "let a = 2;\n");
        id
    }; // app and connection dropped: the desktop app closing

    let app = build_test_app(db::open_connection(&path).expect("reopen"));
    let listed = commands::list_snippets(app.state::<DbState>()).expect("list");
    assert_eq!(listed[0].code, "let a = 2;\n");
    let revisions = commands::list_revisions(app.state::<DbState>(), id.clone()).expect("revisions");
    assert_eq!(revisions.len(), 1);
    assert_eq!(revisions[0].code, "let a = 1;");
    assert_eq!(revisions[0].note, "bump");

    std::fs::remove_file(&path).ok();
}

#[test]
fn special_characters_in_edited_code_round_trip_exactly() {
    let path = temp_db_path("special");
    let app = build_test_app(db::open_connection(&path).expect("open"));
    let id = created(&app, "x");
    let odd = "const html = \"<script>alert('x')</script> & &amp;\";\r\n\t// 表情 👋🏽 \\ \" OR -1\n";
    let saved = commands::update_snippet(app.state::<DbState>(), edit(&id, "Odd", odd, "typescript", ""))
        .expect("update");
    assert_eq!(saved.code, odd);
    let found = commands::search_snippets(app.state::<DbState>(), "alert".into()).expect("search");
    assert_eq!(found.len(), 1);

    std::fs::remove_file(&path).ok();
}

#[test]
fn each_refusal_has_its_own_reason_and_leaves_the_snippet_as_it_was() {
    let path = temp_db_path("refusals");
    let app = build_test_app(db::open_connection(&path).expect("open"));
    let id = created(&app, "keep me");

    let reason = |input| commands::update_snippet(app.state::<DbState>(), input).unwrap_err();
    assert_eq!(reason(edit(&id, " ", "c", "rust", "")), "title-empty");
    assert_eq!(reason(edit(&id, "t", "", "rust", "")), "code-empty");
    assert_eq!(reason(edit(&id, "t", "c", "  ", "")), "language-empty");
    assert_eq!(reason(edit("no-such-id", "t", "c", "rust", "")), "snippet-not-found");

    let listed = commands::list_snippets(app.state::<DbState>()).expect("list");
    assert_eq!(listed[0].code, "keep me");
    assert!(commands::list_revisions(app.state::<DbState>(), id).expect("revisions").is_empty());

    std::fs::remove_file(&path).ok();
}
