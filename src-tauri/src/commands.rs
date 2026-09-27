use crate::db::{self, DbState, NewSnippetInput, RevisionDto, SnippetDto, UpdateSnippetInput};
use crate::organize::{self, CollectionDto};
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
