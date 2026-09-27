use crate::db::{self, DbState, NewSnippetInput, RevisionDto, SnippetDto, UpdateSnippetInput};
use crate::organize::{self, CollectionDto};
use crate::backup;
use crate::quick;
use tauri::State;

#[tauri::command]
pub fn create_snippet(
    state: State<DbState>,
    input: NewSnippetInput,
) -> Result<SnippetDto, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title-empty".into());
    }
    if input.code.is_empty() {
        return Err("code-empty".into());
    }
    let language = input.language.trim();
    if language.is_empty() {
        return Err("language-empty".into());
    }

    let id = uuid::Uuid::new_v4().to_string();
    let conn = state.lock()?;
    db::insert_snippet(&conn, &id, title, &input.code, language).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_snippets(state: State<DbState>) -> Result<Vec<SnippetDto>, String> {
    let conn = state.lock()?;
    db::list_all(&conn).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn search_snippets(state: State<DbState>, query: String) -> Result<Vec<SnippetDto>, String> {
    if query.trim().is_empty() {
        return Err("query-empty".into());
    }
    let conn = state.lock()?;
    db::search(&conn, &query).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn update_snippet(
    state: State<DbState>,
    input: UpdateSnippetInput,
) -> Result<SnippetDto, String> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err("title-empty".into());
    }
    if input.code.is_empty() {
        return Err("code-empty".into());
    }
    let language = input.language.trim();
    if language.is_empty() {
        return Err("language-empty".into());
    }

    let mut conn = state.lock()?;
    db::update_snippet(&mut conn, &input.id, title, &input.code, language, input.note.trim())
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "snippet-not-found".to_string())
}

#[tauri::command]
pub fn list_revisions(state: State<DbState>, snippet_id: String) -> Result<Vec<RevisionDto>, String> {
    let conn = state.lock()?;
    db::list_revisions(&conn, &snippet_id).map_err(|err| err.to_string())
}

fn lock<'a>(state: &'a State<'_, DbState>) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state.lock()
}

#[tauri::command]
pub fn set_snippet_tags(state: State<DbState>, id: String, tags: Vec<String>) -> Result<SnippetDto, String> {
    organize::set_snippet_tags(&*lock(&state)?, &id, &tags).map_err(|err| err.as_str())
}

#[tauri::command]
pub fn set_snippet_collection(
    state: State<DbState>,
    id: String,
    collection_id: Option<String>,
) -> Result<SnippetDto, String> {
    organize::set_snippet_collection(&*lock(&state)?, &id, collection_id.as_deref()).map_err(|err| err.as_str())
}

#[tauri::command]
pub fn list_collections(state: State<DbState>) -> Result<Vec<CollectionDto>, String> {
    organize::list_collections(&*lock(&state)?).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn create_collection(state: State<DbState>, name: String) -> Result<CollectionDto, String> {
    let id = uuid::Uuid::new_v4().to_string();
    organize::create_collection(&*lock(&state)?, &id, &name).map_err(|err| err.as_str())
}

#[tauri::command]
pub fn rename_collection(state: State<DbState>, id: String, name: String) -> Result<CollectionDto, String> {
    organize::rename_collection(&*lock(&state)?, &id, &name).map_err(|err| err.as_str())
}

#[tauri::command]
pub fn delete_collection(state: State<DbState>, id: String) -> Result<(), String> {
    organize::delete_collection(&mut *lock(&state)?, &id).map_err(|err| err.as_str())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryHealthDto {
    /// `ok` or `damaged`.
    pub status: &'static str,
    pub detail: Option<String>,
}

#[tauri::command]
pub fn library_health(state: State<DbState>) -> LibraryHealthDto {
    match state.damage() {
        Some(detail) => LibraryHealthDto { status: "damaged", detail: Some(detail) },
        None => LibraryHealthDto { status: "ok", detail: None },
    }
}

/// Keeps the damaged file under a new name and starts an empty library; returns the name it was kept under.
#[tauri::command]
pub fn set_aside_damaged_library(state: State<DbState>) -> Result<String, String> {
    state.set_aside_and_reset()
}

#[tauri::command]
pub fn list_recent_uses(state: State<DbState>) -> Result<Vec<quick::UsageDto>, String> {
    quick::list_recent(&*lock(&state)?).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn record_snippet_use(state: State<DbState>, id: String) -> Result<Vec<quick::UsageDto>, String> {
    quick::record_use(&*lock(&state)?, &id)
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "snippet-not-found".to_string())
}

/// The shortcut that opens quick search, and whether the system accepted it.
#[derive(serde::Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    pub accelerator: String,
    pub registered: bool,
    /// Why registration failed — usually another app already owns the combination.
    pub error: Option<String>,
}

pub struct ShortcutState(pub std::sync::Mutex<ShortcutStatus>);

#[tauri::command]
pub fn get_quick_shortcut(shortcut: State<ShortcutState>) -> Result<ShortcutStatus, String> {
    shortcut.0.lock().map(|status| status.clone()).map_err(|_| "shortcut-lock-poisoned".to_string())
}

/// Swaps the global shortcut. The old one is only released once the new one is registered, and the
/// choice is saved only then — a combination another app owns leaves everything as it was.
#[tauri::command]
pub fn set_quick_shortcut(
    app: tauri::AppHandle,
    state: State<DbState>,
    shortcut: State<ShortcutState>,
    accelerator: String,
) -> Result<ShortcutStatus, String> {
    let conn = lock(&state)?;
    let mut status = shortcut.0.lock().map_err(|_| "shortcut-lock-poisoned".to_string())?;
    crate::shortcut::swap(&app, status.registered.then_some(status.accelerator.as_str()), &accelerator)?;
    quick::save_shortcut(&conn, &accelerator).map_err(|err| err.to_string())?;
    *status = ShortcutStatus { accelerator, registered: true, error: None };
    Ok(status.clone())
}

/// Archives read from a file and waiting for the user to apply or cancel them, by token.
#[derive(Default)]
pub struct ImportState(pub std::sync::Mutex<std::collections::HashMap<String, backup::ImportPlanDto>>);

/// Where backups are written: `<app data>/backups`.
pub struct BackupDir(pub std::path::PathBuf);

#[derive(serde::Serialize, Debug)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum ExportOutcome {
    Saved { path: String, snippets: usize },
    Cancelled,
}

#[derive(serde::Serialize, Debug)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum StageOutcome {
    Ready { token: String, plan: backup::ImportPlanDto },
    Cancelled,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    pub counts: backup::ImportCounts,
    pub backup: backup::BackupInfo,
}

/// Opens the save dialog and writes the whole library there as JSON. The path comes from the dialog,
/// never from the page. `async` so the dialog does not block the main thread it needs.
#[tauri::command]
pub async fn export_library(app: tauri::AppHandle, state: State<'_, DbState>) -> Result<ExportOutcome, String> {
    use tauri_plugin_dialog::DialogExt;
    let archive = backup::export_archive(&*lock(&state)?).map_err(|err| err.to_string())?;
    let suggested = format!("snippet-desk-{}.json", archive.exported_at.get(..10).unwrap_or("export"));
    let Some(target) = app
        .dialog()
        .file()
        .add_filter("Snippet Desk archive", &["json"])
        .set_file_name(&suggested)
        .blocking_save_file()
    else {
        return Ok(ExportOutcome::Cancelled);
    };
    let path = target.into_path().map_err(|err| err.to_string())?;
    let json = serde_json::to_string_pretty(&archive).map_err(|err| err.to_string())? + "\n";
    std::fs::write(&path, json).map_err(|err| err.to_string())?;
    Ok(ExportOutcome::Saved { path: path.display().to_string(), snippets: archive.snippets.len() })
}

/// Validates an archive's text and keeps its dry-run plan until it is applied or cancelled.
pub fn stage_import(state: &DbState, imports: &ImportState, text: &str) -> Result<StageOutcome, String> {
    let archive = backup::parse_archive(text)?;
    let plan = backup::plan_import(&*state.lock()?, &archive).map_err(|err| err.to_string())?;
    let token = uuid::Uuid::new_v4().to_string();
    imports.0.lock().map_err(|_| "import-lock-poisoned".to_string())?.insert(token.clone(), plan.clone());
    Ok(StageOutcome::Ready { token, plan })
}

/// Opens the file dialog and returns the import's dry run. Closing the dialog is `cancelled`, not an error.
#[tauri::command]
pub async fn pick_import_file(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    imports: State<'_, ImportState>,
) -> Result<StageOutcome, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().add_filter("Snippet Desk archive", &["json"]).blocking_pick_file() else {
        return Ok(StageOutcome::Cancelled);
    };
    let path = picked.into_path().map_err(|err| err.to_string())?;
    let text = std::fs::read_to_string(&path).map_err(|_| "not-json".to_string())?;
    stage_import(&state, &imports, &text)
}

/// Backs the library up, then applies the staged plan in one transaction.
#[tauri::command]
pub fn apply_import(
    state: State<DbState>,
    imports: State<ImportState>,
    backups: State<BackupDir>,
    token: String,
) -> Result<ApplyOutcome, String> {
    let plan = imports
        .0
        .lock()
        .map_err(|_| "import-lock-poisoned".to_string())?
        .remove(&token)
        .ok_or_else(|| "import-not-found".to_string())?;
    let mut conn = lock(&state)?;
    let backup = backup::create_backup(&conn, &backups.0, "before-import")?;
    backup::apply_import(&mut conn, &plan).map_err(|err| err.to_string())?;
    Ok(ApplyOutcome { counts: plan.counts, backup })
}

/// Forgets a staged import. Nothing was written, so there is nothing to undo.
#[tauri::command]
pub fn cancel_import(imports: State<ImportState>, token: String) -> Result<(), String> {
    imports.0.lock().map_err(|_| "import-lock-poisoned".to_string())?.remove(&token);
    Ok(())
}

#[tauri::command]
pub fn create_backup(state: State<DbState>, backups: State<BackupDir>) -> Result<backup::BackupInfo, String> {
    backup::create_backup(&*lock(&state)?, &backups.0, "manual")
}

#[tauri::command]
pub fn list_backups(backups: State<BackupDir>) -> Vec<backup::BackupInfo> {
    backup::list_backups(&backups.0)
}

/// Restores a backup by name; returns the backup of the state it replaced.
#[tauri::command]
pub fn restore_backup(state: State<DbState>, backups: State<BackupDir>, name: String) -> Result<backup::BackupInfo, String> {
    backup::restore_backup(&mut *lock(&state)?, &backups.0, &name)
}

#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> crate::updates::AppVersionDto {
    crate::updates::app_version(&app)
}

/// `updates-not-configured` when this build has no updater key; `update-check-failed: …` when the
/// release feed can't be read or its answer can't be trusted.
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    pending: State<'_, crate::updates::PendingUpdate>,
) -> Result<crate::updates::UpdateCheckDto, String> {
    crate::updates::check(&app, &pending).await
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, pending: State<'_, crate::updates::PendingUpdate>) -> Result<(), String> {
    crate::updates::install(&app, &pending).await
}
