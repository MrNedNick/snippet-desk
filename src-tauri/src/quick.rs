//! Quick search support: which snippets were copied lately, and the global shortcut that opens it.
//! Both live in SQLite next to the snippets, so they survive a restart like everything else.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

/// Same limit as `MAX_RECENT` in `src/domain/04-quick/types.ts`.
pub const MAX_RECENT: i64 = 20;
/// Same default as `DEFAULT_SHORTCUT` in `src/domain/04-quick/types.ts`.
pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+Space";
const SHORTCUT_KEY: &str = "quick_shortcut";

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageDto {
    pub snippet_id: String,
    pub used_at: String,
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS snippet_uses (
            snippet_id TEXT PRIMARY KEY REFERENCES snippets(id) ON DELETE CASCADE,
            used_at TEXT NOT NULL,
            -- Orders uses made within the same millisecond; `used_at` alone would tie.
            seq INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )
}

/// Most recent first. Entries whose snippet is gone are skipped.
pub fn list_recent(conn: &Connection) -> rusqlite::Result<Vec<UsageDto>> {
    let mut stmt = conn.prepare(
        "SELECT u.snippet_id, u.used_at FROM snippet_uses u
         JOIN snippets s ON s.id = u.snippet_id
         ORDER BY u.seq DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([MAX_RECENT], |row| Ok(UsageDto { snippet_id: row.get(0)?, used_at: row.get(1)? }))?;
    rows.collect()
}

/// Records that a snippet was copied. One row per snippet (a second copy moves it to the top instead
/// of adding a duplicate) and at most `MAX_RECENT` rows. `Ok(None)` means there is no such snippet.
pub fn record_use(conn: &Connection, snippet_id: &str) -> rusqlite::Result<Option<Vec<UsageDto>>> {
    let exists: Option<i64> =
        conn.query_row("SELECT 1 FROM snippets WHERE id = ?1", [snippet_id], |row| row.get(0)).optional()?;
    if exists.is_none() {
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO snippet_uses (snippet_id, used_at, seq)
         VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), (SELECT COALESCE(MAX(seq), 0) + 1 FROM snippet_uses))
         ON CONFLICT(snippet_id) DO UPDATE SET used_at = excluded.used_at, seq = excluded.seq",
        [snippet_id],
    )?;
    conn.execute(
        "DELETE FROM snippet_uses WHERE snippet_id NOT IN
           (SELECT snippet_id FROM snippet_uses ORDER BY seq DESC LIMIT ?1)",
        [MAX_RECENT],
    )?;
    list_recent(conn).map(Some)
}

pub fn shortcut(conn: &Connection) -> rusqlite::Result<String> {
    let stored: Option<String> =
        conn.query_row("SELECT value FROM settings WHERE key = ?1", [SHORTCUT_KEY], |row| row.get(0)).optional()?;
    Ok(stored.unwrap_or_else(|| DEFAULT_SHORTCUT.to_string()))
}

pub fn save_shortcut(conn: &Connection, accelerator: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SHORTCUT_KEY, accelerator],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn library() -> Connection {
        let path = std::env::temp_dir().join(format!("snippet-desk-quick-{}.sqlite3", uuid::Uuid::new_v4()));
        let conn = db::open_connection(&path).expect("open");
        for (id, title) in [("a", "Alpha"), ("b", "Beta"), ("c", "Gamma")] {
            db::insert_snippet(&conn, id, title, "code", "text").expect("insert");
        }
        conn
    }

    #[test]
    fn a_second_use_moves_the_snippet_to_the_top_instead_of_duplicating_it() {
        let conn = library();
        record_use(&conn, "a").unwrap();
        record_use(&conn, "b").unwrap();
        let recent = record_use(&conn, "a").unwrap().unwrap();
        let ids: Vec<_> = recent.iter().map(|entry| entry.snippet_id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn an_unknown_snippet_is_not_recorded() {
        let conn = library();
        assert_eq!(record_use(&conn, "missing").unwrap(), None);
        assert!(list_recent(&conn).unwrap().is_empty());
    }

    #[test]
    fn keeps_at_most_the_limit() {
        let conn = library();
        for n in 0..25 {
            let id = format!("s{n}");
            db::insert_snippet(&conn, &id, "S", "code", "text").unwrap();
            record_use(&conn, &id).unwrap();
        }
        let recent = list_recent(&conn).unwrap();
        assert_eq!(recent.len() as i64, MAX_RECENT);
        assert_eq!(recent[0].snippet_id, "s24");
    }

    #[test]
    fn the_shortcut_defaults_and_persists() {
        let conn = library();
        assert_eq!(shortcut(&conn).unwrap(), DEFAULT_SHORTCUT);
        save_shortcut(&conn, "Alt+Shift+K").unwrap();
        assert_eq!(shortcut(&conn).unwrap(), "Alt+Shift+K");
    }
}
