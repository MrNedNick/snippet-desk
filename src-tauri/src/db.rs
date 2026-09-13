use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SnippetDto {
    pub id: String,
    pub title: String,
    pub code: String,
    pub language: String,
    pub tag_ids: Vec<String>,
    pub collection_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSnippetInput {
    pub title: String,
    pub code: String,
    pub language: String,
}

pub fn open_connection(path: &std::path::Path) -> rusqlite::Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).expect("failed to create app data dir");
    }
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippets (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            code TEXT NOT NULL,
            language TEXT NOT NULL,
            tag_ids TEXT NOT NULL,
            collection_id TEXT,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
            id UNINDEXED,
            title,
            code,
            language
        );",
    )?;
    Ok(conn)
}

fn row_to_snippet(row: &rusqlite::Row) -> rusqlite::Result<SnippetDto> {
    let tag_ids_raw: String = row.get("tag_ids")?;
    let tag_ids: Vec<String> = serde_json::from_str(&tag_ids_raw).unwrap_or_default();
    Ok(SnippetDto {
        id: row.get("id")?,
        title: row.get("title")?,
        code: row.get("code")?,
        language: row.get("language")?,
        tag_ids,
        collection_id: row.get("collection_id")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// Inserts a new snippet, letting SQLite stamp `created_at`/`updated_at` so
/// Rust never has to compute a UTC timestamp itself. Returns the row as
/// stored, timestamps included.
pub fn insert_snippet(
    conn: &Connection,
    id: &str,
    title: &str,
    code: &str,
    language: &str,
) -> rusqlite::Result<SnippetDto> {
    let tag_ids_json = "[]";
    conn.query_row(
        "INSERT INTO snippets (id, title, code, language, tag_ids, collection_id)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL)
         RETURNING id, title, code, language, tag_ids, collection_id, created_at, updated_at",
        rusqlite::params![id, title, code, language, tag_ids_json],
        row_to_snippet,
    )
    .and_then(|snippet| {
        conn.execute(
            "INSERT INTO snippets_fts (id, title, code, language) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![snippet.id, snippet.title, snippet.code, snippet.language],
        )?;
        Ok(snippet)
    })
}

pub fn list_all(conn: &Connection) -> rusqlite::Result<Vec<SnippetDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, code, language, tag_ids, collection_id, created_at, updated_at
         FROM snippets ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], row_to_snippet)?;
    rows.collect()
}

pub fn search(conn: &Connection, raw_query: &str) -> rusqlite::Result<Vec<SnippetDto>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.title, s.code, s.language, s.tag_ids, s.collection_id, s.created_at, s.updated_at
         FROM snippets s
         JOIN snippets_fts f ON f.id = s.id
         WHERE snippets_fts MATCH ?1
         ORDER BY rank",
    )?;
    let rows = stmt.query_map(rusqlite::params![fts_query(raw_query)], row_to_snippet)?;
    rows.collect()
}

/// FTS5 MATCH treats bare terms as a query language (`AND`/`OR`/`-`/`*` are
/// operators); quoting each term keeps arbitrary user input safe to pass in.
fn fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "snippet-desk-test-{}-{}.sqlite3",
            name,
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn a_snippet_survives_reopening_the_same_database_file() {
        let path = temp_db_path("restart");

        {
            let conn = open_connection(&path).expect("open");
            insert_snippet(&conn, "id-1", "Debounce", "fn debounce() {}", "typescript")
                .expect("insert");
        } // connection dropped here, simulating the app closing

        let conn = open_connection(&path).expect("reopen after restart");
        let rows = list_all(&conn).expect("list");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "id-1");
        assert_eq!(rows[0].title, "Debounce");

        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn search_finds_a_snippet_by_a_term_in_its_code_and_is_safe_against_fts_operators() {
        let path = temp_db_path("search");
        let conn = open_connection(&path).expect("open");
        insert_snippet(&conn, "id-1", "Debounce", "fn debounce() {}", "typescript")
            .expect("insert");
        insert_snippet(&conn, "id-2", "Throttle", "fn throttle() {}", "typescript")
            .expect("insert");

        let results = search(&conn, "debounce").expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "id-1");

        // `"` and bare `OR`/`-` are FTS5 query-language operators; a raw user
        // query containing them must not panic or be treated as a query.
        let odd_query = search(&conn, "OR -\"debounce\"").expect("search with fts operators");
        assert_eq!(odd_query.len(), 0);

        std::fs::remove_file(&path).ok();
    }
}
