use crate::db::{self, DbState, NewSnippetInput, SnippetDto};
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
