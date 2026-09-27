use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// The library connection, and whether the file behind it turned out to be damaged.
///
/// A damaged file does not stop the app: it starts on an empty in-memory database, every command
/// answers `database-corrupted: …` instead of showing an empty library, and `set_aside_and_reset`
/// moves the file out of the way (never deletes it) and opens a fresh one.
pub struct DbState {
    conn: Mutex<Connection>,
    damage: Mutex<Option<String>>,
    path: Option<PathBuf>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self { conn: Mutex::new(conn), damage: Mutex::new(None), path: None }
    }

    /// Opens the library at `path`, checking it with `PRAGMA quick_check`.
    pub fn open(path: &Path) -> Self {
        match open_connection(path).and_then(|conn| check_integrity(&conn).map(|_| conn)) {
            Ok(conn) => Self { conn: Mutex::new(conn), damage: Mutex::new(None), path: Some(path.to_path_buf()) },
            Err(err) => Self {
                conn: Mutex::new(Connection::open_in_memory().expect("in-memory database")),
                damage: Mutex::new(Some(err.to_string())),
                path: Some(path.to_path_buf()),
            },
        }
    }

    /// The connection, unless the library is damaged or a previous command panicked holding it.
    pub fn lock(&self) -> Result<MutexGuard<'_, Connection>, String> {
        if let Some(detail) = self.damage() {
            return Err(format!("database-corrupted: {detail}"));
        }
        self.conn.lock().map_err(|_| "db-lock-poisoned".to_string())
    }

    pub fn damage(&self) -> Option<String> {
        self.damage.lock().ok().and_then(|damage| damage.clone())
    }

    /// Renames the damaged file (and its `-wal`/`-shm` companions) to `<name>.damaged-<unix time>`,
    /// opens a fresh library in its place and returns the name the damaged file was kept under.
    pub fn set_aside_and_reset(&self) -> Result<String, String> {
        if self.damage().is_none() {
            return Err("database-not-damaged".into());
        }
        let path = self.path.as_ref().ok_or_else(|| "database-has-no-file".to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_secs())
            .unwrap_or_default();
        let kept = path.with_extension(format!("damaged-{stamp}.sqlite3"));
        if path.exists() {
            std::fs::rename(path, &kept).map_err(|err| err.to_string())?;
        }
        for suffix in ["-wal", "-shm"] {
            let companion = PathBuf::from(format!("{}{suffix}", path.display()));
            if companion.exists() {
                let _ = std::fs::rename(&companion, PathBuf::from(format!("{}{suffix}", kept.display())));
            }
        }
        let fresh = open_connection(path).map_err(|err| err.to_string())?;
        *self.conn.lock().map_err(|_| "db-lock-poisoned".to_string())? = fresh;
        *self.damage.lock().map_err(|_| "db-lock-poisoned".to_string())? = None;
        Ok(kept.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default())
    }
}

/// `PRAGMA quick_check` answers `ok` for a healthy file and a list of problems otherwise.
pub fn check_integrity(conn: &Connection) -> rusqlite::Result<()> {
    let verdict: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if verdict == "ok" {
        Ok(())
    } else {
        Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
            Some(format!("database disk image is malformed: {verdict}")),
        ))
    }
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnippetInput {
    pub id: String,
    pub title: String,
    pub code: String,
    pub language: String,
    pub note: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RevisionDto {
    pub id: String,
    pub snippet_id: String,
    pub code: String,
    pub note: String,
    pub created_at: String,
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
        );
        CREATE TABLE IF NOT EXISTS revisions (
            id TEXT PRIMARY KEY,
            snippet_id TEXT NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
            code TEXT NOT NULL,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        CREATE INDEX IF NOT EXISTS revisions_by_snippet ON revisions (snippet_id, created_at);",
    )?;
    crate::organize::migrate(&conn)?;
    crate::quick::migrate(&conn)?;
    Ok(conn)
}

pub(crate) fn row_to_snippet(row: &rusqlite::Row) -> rusqlite::Result<SnippetDto> {
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

/// Saves a new title, code and language for an existing snippet in one
/// transaction. When the code changes, the previous code is kept as a
/// revision with `note`; a rename alone leaves no revision. The FTS row is
/// replaced so search sees the new text. `Ok(None)` when no snippet has `id`.
pub fn update_snippet(
    conn: &mut Connection,
    id: &str,
    title: &str,
    code: &str,
    language: &str,
    note: &str,
) -> rusqlite::Result<Option<SnippetDto>> {
    let tx = conn.transaction()?;
    let previous: Option<String> = match tx.query_row(
        "SELECT code FROM snippets WHERE id = ?1",
        rusqlite::params![id],
        |row| row.get(0),
    ) {
        Ok(code) => Some(code),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(other) => return Err(other),
    };
    let Some(previous) = previous else {
        return Ok(None);
    };
    if previous != code {
        tx.execute(
            "INSERT INTO revisions (id, snippet_id, code, note) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), id, previous, note],
        )?;
    }
    let updated = tx.query_row(
        "UPDATE snippets
         SET title = ?2, code = ?3, language = ?4,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1
         RETURNING id, title, code, language, tag_ids, collection_id, created_at, updated_at",
        rusqlite::params![id, title, code, language],
        row_to_snippet,
    )?;
    tx.execute("DELETE FROM snippets_fts WHERE id = ?1", rusqlite::params![id])?;
    tx.execute(
        "INSERT INTO snippets_fts (id, title, code, language) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![updated.id, updated.title, updated.code, updated.language],
    )?;
    tx.commit()?;
    Ok(Some(updated))
}

/// Earlier versions of a snippet's code, newest first.
pub fn list_revisions(conn: &Connection, snippet_id: &str) -> rusqlite::Result<Vec<RevisionDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, snippet_id, code, note, created_at FROM revisions
         WHERE snippet_id = ?1 ORDER BY created_at DESC, rowid DESC",
    )?;
    let rows = stmt.query_map(rusqlite::params![snippet_id], |row| {
        Ok(RevisionDto {
            id: row.get("id")?,
            snippet_id: row.get("snippet_id")?,
            code: row.get("code")?,
            note: row.get("note")?,
            created_at: row.get("created_at")?,
        })
    })?;
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

    #[test]
    fn editing_the_code_keeps_the_old_code_as_a_revision_and_search_sees_the_new_text() {
        let path = temp_db_path("update");
        let mut conn = open_connection(&path).expect("open");
        insert_snippet(&conn, "id-1", "Debounce", "fn debounce() {}", "rust").expect("insert");

        let renamed = update_snippet(&mut conn, "id-1", "Debounce fn", "fn debounce() {}", "rust", "")
            .expect("rename")
            .expect("found");
        assert_eq!(renamed.title, "Debounce fn");
        assert!(list_revisions(&conn, "id-1").expect("revisions").is_empty());

        update_snippet(&mut conn, "id-1", "Debounce fn", "fn throttle() {}", "rust", "rename body")
            .expect("update")
            .expect("found");
        let revisions = list_revisions(&conn, "id-1").expect("revisions");
        assert_eq!(revisions.len(), 1);
        assert_eq!(revisions[0].code, "fn debounce() {}");
        assert_eq!(revisions[0].note, "rename body");
        assert_eq!(search(&conn, "throttle").expect("search").len(), 1);
        assert_eq!(search(&conn, "debounce").expect("search").len(), 1); // still in the title
        assert!(update_snippet(&mut conn, "missing", "t", "c", "l", "").expect("update").is_none());

        std::fs::remove_file(&path).ok();
    }
}
