use crate::db::{self, DbState, NewSnippetInput, RevisionDto, SnippetDto, UpdateSnippetInput};
use crate::organize::{self, CollectionDto};
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
    let conn = state.0.lock().map_err(|_| "db-lock-poisoned".to_string())?;
    db::insert_snippet(&conn, &id, title, &input.code, language).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn list_snippets(state: State<DbState>) -> Result<Vec<SnippetDto>, String> {
    let conn = state.0.lock().map_err(|_| "db-lock-poisoned".to_string())?;
    db::list_all(&conn).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn search_snippets(state: State<DbState>, query: String) -> Result<Vec<SnippetDto>, String> {
    if query.trim().is_empty() {
        return Err("query-empty".into());
    }
    let conn = state.0.lock().map_err(|_| "db-lock-poisoned".to_string())?;
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

    let mut conn = state.0.lock().map_err(|_| "db-lock-poisoned".to_string())?;
    db::update_snippet(&mut conn, &input.id, title, &input.code, language, input.note.trim())
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "snippet-not-found".to_string())
}

#[tauri::command]
pub fn list_revisions(state: State<DbState>, snippet_id: String) -> Result<Vec<RevisionDto>, String> {
    let conn = state.0.lock().map_err(|_| "db-lock-poisoned".to_string())?;
    db::list_revisions(&conn, &snippet_id).map_err(|err| err.to_string())
}

fn lock<'a>(state: &'a State<'_, DbState>) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state.0.lock().map_err(|_| "db-lock-poisoned".to_string())
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
