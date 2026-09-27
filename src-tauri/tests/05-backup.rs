//! Integration coverage for "Импорт экспорт и backup": export from one library, stage and apply the
//! archive in another, cancel, re-import, back up and restore — through the command layer over real
//! SQLite files. The dialogs themselves need a window, so staging is driven with the file's text.

use snippet_desk_lib::backup;
use snippet_desk_lib::commands::{self, BackupDir, ImportState, StageOutcome};
use snippet_desk_lib::db::{DbState, NewSnippetInput};
use tauri::Manager;

type App = tauri::App<tauri::test::MockRuntime>;

fn temp(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("snippet-desk-backup-{}-{}", name, uuid::Uuid::new_v4()))
}

fn app(name: &str) -> App {
    let dir = temp(name);
    tauri::test::mock_builder()
        .manage(DbState::open(&dir.join("library.sqlite3")))
        .manage(ImportState::default())
        .manage(BackupDir(dir.join("backups")))
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .expect("mock app")
}

fn add(app: &App, title: &str, code: &str) -> String {
    commands::create_snippet(app.state::<DbState>(), NewSnippetInput { title: title.into(), code: code.into(), language: "rust".into() })
        .expect("create")
        .id
}

fn titles(app: &App) -> Vec<String> {
    let mut titles: Vec<_> = commands::list_snippets(app.state::<DbState>()).unwrap().into_iter().map(|s| s.title).collect();
    titles.sort();
    titles
}

fn export_text(app: &App) -> String {
    let archive = backup::export_archive(&app.state::<DbState>().lock().unwrap()).unwrap();
    serde_json::to_string(&archive).unwrap()
}

fn stage(app: &App, text: &str) -> Result<(String, backup::ImportPlanDto), String> {
    match commands::stage_import(&app.state::<DbState>(), &app.state::<ImportState>(), text)? {
        StageOutcome::Ready { token, plan } => Ok((token, plan)),
        StageOutcome::Cancelled => unreachable!(),
    }
}

#[test]
fn export_then_import_into_another_library_and_again_without_duplicates() {
    let laptop = app("laptop");
    let retry = add(&laptop, "Retry", "fn retry() {}");
    commands::set_snippet_tags(laptop.state::<DbState>(), retry, vec!["Rust".into(), "errors".into()]).unwrap();
    add(&laptop, "Special", "\tlet s = \"✓ 👩‍💻\";\r\n");
    let text = export_text(&laptop);

    let desktop = app("desktop");
    add(&desktop, "Local", "// stays");
    let (token, plan) = stage(&desktop, &text).expect("stage");
    assert_eq!(plan.counts, backup::ImportCounts { added: 2, updated: 0, kept: 0, duplicate: 0 });

    let applied = commands::apply_import(desktop.state(), desktop.state(), desktop.state(), token).expect("apply");
    assert_eq!(applied.backup.reason, "before-import");
    assert_eq!(titles(&desktop), ["Local", "Retry", "Special"]);
    let special = commands::list_snippets(desktop.state::<DbState>()).unwrap().into_iter().find(|s| s.title == "Special").unwrap();
    assert_eq!(special.code, "\tlet s = \"✓ 👩‍💻\";\r\n", "code survives byte for byte");
    assert_eq!(commands::search_snippets(desktop.state::<DbState>(), "retry".into()).unwrap().len(), 1, "imported text is searchable");

    let (_, again) = stage(&desktop, &text).expect("stage again");
    assert_eq!(again.counts.added, 0);
    assert_eq!(again.counts.kept, 2);
}

#[test]
fn cancelling_an_import_writes_nothing_and_its_token_is_gone() {
    let source = app("source");
    add(&source, "Retry", "fn retry() {}");
    let text = export_text(&source);

    let target = app("target");
    let (token, _) = stage(&target, &text).unwrap();
    commands::cancel_import(target.state(), token.clone()).unwrap();
    assert!(titles(&target).is_empty());
    assert!(backup::list_backups(&target.state::<BackupDir>().0).is_empty(), "no backup for an import that never ran");
    assert_eq!(
        commands::apply_import(target.state(), target.state(), target.state(), token).unwrap_err(),
        "import-not-found"
    );
}

#[test]
fn a_wrong_file_is_refused_with_its_reason() {
    let target = app("wrong");
    assert_eq!(stage(&target, "{\"name\":\"package\"}").unwrap_err(), "not-an-archive");
    assert_eq!(stage(&target, "not json at all").unwrap_err(), "not-json");
}

#[test]
fn a_backup_restores_the_library_and_the_replaced_state_is_backed_up_too() {
    let desk = app("restore");
    add(&desk, "Keep me", "1");
    let saved = commands::create_backup(desk.state(), desk.state()).expect("backup");
    assert_eq!(saved.reason, "manual");
    add(&desk, "Added later", "2");

    let safety = commands::restore_backup(desk.state(), desk.state(), saved.name.clone()).expect("restore");
    assert_eq!(safety.reason, "before-restore");
    assert_eq!(titles(&desk), ["Keep me"]);
    let names: Vec<_> = commands::list_backups(desk.state()).into_iter().map(|b| b.reason).collect();
    assert!(names.contains(&"before-restore".to_string()) && names.contains(&"manual".to_string()));

    assert_eq!(
        commands::restore_backup(desk.state(), desk.state(), "../library.sqlite3".into()).unwrap_err(),
        "backup-not-found",
        "only names from the backup folder are accepted"
    );
}
