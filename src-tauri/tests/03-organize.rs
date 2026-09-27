//! Integration coverage for the "Теги и коллекции" milestone, through the
//! `#[tauri::command]` boundary over a real temporary SQLite file.

use rusqlite::Connection;
use snippet_desk_lib::commands;
use snippet_desk_lib::db::{self, DbState, NewSnippetInput};
use tauri::Manager;

fn temp_db_path(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("snippet-desk-organize-{}-{}.sqlite3", name, uuid::Uuid::new_v4()))
}

fn app(conn: Connection) -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(DbState::new(conn))
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

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

#[test]
fn tags_and_a_collection_are_saved_and_survive_a_restart() {
    let path = temp_db_path("main");
    let (id, collection) = {
        let app = app(db::open_connection(&path).expect("open"));
        let id = snippet(&app, "Retry");
        let tagged = commands::set_snippet_tags(app.state::<DbState>(), id.clone(), strings(&["Rust", "error handling"]))
            .expect("tags");
        assert_eq!(tagged.tag_ids, strings(&["rust", "error-handling"]));
        let collection = commands::create_collection(app.state::<DbState>(), "  Backend   helpers ".into()).expect("create");
        assert_eq!(collection.name, "Backend helpers");
        let filed = commands::set_snippet_collection(app.state::<DbState>(), id.clone(), Some(collection.id.clone()))
            .expect("file");
        assert_eq!(filed.collection_id.as_deref(), Some(collection.id.as_str()));
        (id, collection)
    };

    let app = app(db::open_connection(&path).expect("reopen"));
    let listed = commands::list_snippets(app.state::<DbState>()).expect("list");
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].tag_ids, strings(&["rust", "error-handling"]));
    assert_eq!(listed[0].collection_id.as_deref(), Some(collection.id.as_str()));
    assert_eq!(commands::list_collections(app.state::<DbState>()).expect("collections"), vec![collection]);

    std::fs::remove_file(&path).ok();
}

#[test]
fn duplicates_collapse_for_tags_and_are_refused_for_collection_names() {
    let path = temp_db_path("duplicates");
    let app = app(db::open_connection(&path).expect("open"));
    let id = snippet(&app, "Hook");

    let tagged = commands::set_snippet_tags(app.state::<DbState>(), id, strings(&["React", "react", " REACT ", "hooks"]))
        .expect("tags");
    assert_eq!(tagged.tag_ids, strings(&["react", "hooks"]));

    let first = commands::create_collection(app.state::<DbState>(), "Ukrainian — Україна".into()).expect("create");
    let again = commands::create_collection(app.state::<DbState>(), "ukrainian — УКРАЇНА".into());
    assert_eq!(again.unwrap_err(), "collection-exists");
    // Renaming to its own name in another case is not a duplicate.
    let renamed = commands::rename_collection(app.state::<DbState>(), first.id, "UKRAINIAN — україна".into()).expect("rename");
    assert_eq!(renamed.name, "UKRAINIAN — україна");

    std::fs::remove_file(&path).ok();
}

#[test]
fn deleting_a_collection_keeps_its_snippets_unfiled() {
    let path = temp_db_path("delete");
    let app = app(db::open_connection(&path).expect("open"));
    let id = snippet(&app, "Query");
    let collection = commands::create_collection(app.state::<DbState>(), "SQL".into()).expect("create");
    commands::set_snippet_collection(app.state::<DbState>(), id.clone(), Some(collection.id.clone())).expect("file");

    commands::delete_collection(app.state::<DbState>(), collection.id.clone()).expect("delete");
    let listed = commands::list_snippets(app.state::<DbState>()).expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].collection_id, None);
    assert_eq!(commands::delete_collection(app.state::<DbState>(), collection.id).unwrap_err(), "collection-not-found");

    std::fs::remove_file(&path).ok();
}

#[test]
fn each_refusal_has_its_own_reason() {
    let path = temp_db_path("refusals");
    let app = app(db::open_connection(&path).expect("open"));
    let id = snippet(&app, "S");
    let state = || app.state::<DbState>();

    assert_eq!(commands::set_snippet_tags(state(), id.clone(), strings(&["ok", "!!!"])).unwrap_err(), "tag-empty");
    assert_eq!(commands::set_snippet_tags(state(), id.clone(), vec!["x".repeat(33)]).unwrap_err(), "tag-too-long");
    let many: Vec<String> = (0..13).map(|i| format!("t{i}")).collect();
    assert_eq!(commands::set_snippet_tags(state(), id.clone(), many).unwrap_err(), "too-many-tags");
    assert_eq!(commands::set_snippet_tags(state(), "gone".into(), strings(&["a"])).unwrap_err(), "snippet-not-found");
    assert_eq!(commands::create_collection(state(), "   ".into()).unwrap_err(), "collection-empty");
    assert_eq!(commands::create_collection(state(), "z".repeat(61)).unwrap_err(), "collection-too-long");
    assert_eq!(commands::rename_collection(state(), "gone".into(), "New".into()).unwrap_err(), "collection-not-found");
    assert_eq!(
        commands::set_snippet_collection(state(), id.clone(), Some("gone".into())).unwrap_err(),
        "collection-not-found"
    );
    // Nothing above changed the snippet.
    let listed = commands::list_snippets(state()).expect("list");
    assert!(listed[0].tag_ids.is_empty());
    assert_eq!(listed[0].collection_id, None);

    std::fs::remove_file(&path).ok();
}
