//! Tags and collections. Tags live on the snippet row (`tag_ids`, a JSON
//! list) and are identified by their normalised name; collections have their
//! own table. The rules match `src/domain/03-organize` on the frontend, so a
//! value the UI accepts is never refused here, and the other way round.

use crate::db::{row_to_snippet, SnippetDto};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const MAX_TAG_LENGTH: usize = 32;
pub const MAX_TAGS_PER_SNIPPET: usize = 12;
pub const MAX_COLLECTION_NAME_LENGTH: usize = 60;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct CollectionDto {
    pub id: String,
    pub name: String,
}

/// Why a tag or collection change was refused; `as_str` is the reason the
/// frontend receives.
#[derive(Debug, PartialEq)]
pub enum OrganizeError {
    TagEmpty,
    TagTooLong,
    TooManyTags,
    CollectionEmpty,
    CollectionTooLong,
    CollectionExists,
    CollectionNotFound,
    SnippetNotFound,
    Db(String),
}

impl OrganizeError {
    pub fn as_str(&self) -> String {
        match self {
            Self::TagEmpty => "tag-empty".into(),
            Self::TagTooLong => "tag-too-long".into(),
            Self::TooManyTags => "too-many-tags".into(),
            Self::CollectionEmpty => "collection-empty".into(),
            Self::CollectionTooLong => "collection-too-long".into(),
            Self::CollectionExists => "collection-exists".into(),
            Self::CollectionNotFound => "collection-not-found".into(),
            Self::SnippetNotFound => "snippet-not-found".into(),
            Self::Db(message) => message.clone(),
        }
    }
}

impl From<rusqlite::Error> for OrganizeError {
    fn from(err: rusqlite::Error) -> Self {
        Self::Db(err.to_string())
    }
}

pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );",
    )
}

/// `React Hooks` → `react-hooks`: lower case, anything but letters, digits
/// and `+ # . _ -` becomes a single `-`, trimmed at both ends.
pub fn normalize_tag(raw: &str) -> Result<String, OrganizeError> {
    let mut tag = String::new();
    for ch in raw.trim().to_lowercase().chars() {
        let keep = ch.is_alphanumeric() || matches!(ch, '+' | '#' | '.' | '_' | '-');
        let next = if keep { ch } else { '-' };
        if next == '-' && tag.ends_with('-') {
            continue;
        }
        tag.push(next);
    }
    let tag = tag.trim_matches('-').to_string();
    if tag.is_empty() {
        return Err(OrganizeError::TagEmpty);
    }
    if tag.chars().count() > MAX_TAG_LENGTH {
        return Err(OrganizeError::TagTooLong);
    }
    Ok(tag)
}

/// Normalises every tag and drops duplicates, keeping the first spelling's
/// position.
pub fn normalize_tags(raw: &[String]) -> Result<Vec<String>, OrganizeError> {
    let mut tags: Vec<String> = Vec::new();
    for piece in raw {
        let tag = normalize_tag(piece)?;
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    if tags.len() > MAX_TAGS_PER_SNIPPET {
        return Err(OrganizeError::TooManyTags);
    }
    Ok(tags)
}

fn select_snippet(conn: &Connection, id: &str) -> Result<SnippetDto, OrganizeError> {
    conn.query_row(
        "SELECT id, title, code, language, tag_ids, collection_id, created_at, updated_at
         FROM snippets WHERE id = ?1",
        params![id],
        row_to_snippet,
    )
    .optional()?
    .ok_or(OrganizeError::SnippetNotFound)
}

pub fn set_snippet_tags(conn: &Connection, id: &str, raw: &[String]) -> Result<SnippetDto, OrganizeError> {
    let tags = normalize_tags(raw)?;
    let json = serde_json::to_string(&tags).map_err(|err| OrganizeError::Db(err.to_string()))?;
    let changed = conn.execute(
        "UPDATE snippets SET tag_ids = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id, json],
    )?;
    if changed == 0 {
        return Err(OrganizeError::SnippetNotFound);
    }
    select_snippet(conn, id)
}

pub fn list_collections(conn: &Connection) -> rusqlite::Result<Vec<CollectionDto>> {
    let mut stmt = conn.prepare("SELECT id, name FROM collections ORDER BY name COLLATE NOCASE")?;
    let rows = stmt.query_map([], |row| Ok(CollectionDto { id: row.get(0)?, name: row.get(1)? }))?;
    rows.collect()
}

/// Trimmed, inner whitespace collapsed, case kept; unique ignoring case
/// (Unicode-aware, unlike SQLite's `NOCASE`). `except` is the collection
/// being renamed.
fn validate_collection_name(conn: &Connection, raw: &str, except: Option<&str>) -> Result<String, OrganizeError> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(OrganizeError::CollectionEmpty);
    }
    if name.chars().count() > MAX_COLLECTION_NAME_LENGTH {
        return Err(OrganizeError::CollectionTooLong);
    }
    let lower = name.to_lowercase();
    let taken = list_collections(conn)?
        .into_iter()
        .any(|c| Some(c.id.as_str()) != except && c.name.to_lowercase() == lower);
    if taken {
        return Err(OrganizeError::CollectionExists);
    }
    Ok(name)
}

pub fn create_collection(conn: &Connection, id: &str, raw: &str) -> Result<CollectionDto, OrganizeError> {
    let name = validate_collection_name(conn, raw, None)?;
    conn.execute("INSERT INTO collections (id, name) VALUES (?1, ?2)", params![id, name])?;
    Ok(CollectionDto { id: id.into(), name })
}

pub fn rename_collection(conn: &Connection, id: &str, raw: &str) -> Result<CollectionDto, OrganizeError> {
    let name = validate_collection_name(conn, raw, Some(id))?;
    let changed = conn.execute("UPDATE collections SET name = ?2 WHERE id = ?1", params![id, name])?;
    if changed == 0 {
        return Err(OrganizeError::CollectionNotFound);
    }
    Ok(CollectionDto { id: id.into(), name })
}

/// Removes a collection; its snippets stay in the library, unfiled.
pub fn delete_collection(conn: &mut Connection, id: &str) -> Result<(), OrganizeError> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE snippets SET collection_id = NULL WHERE collection_id = ?1", params![id])?;
    let changed = tx.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(OrganizeError::CollectionNotFound);
    }
    tx.commit()?;
    Ok(())
}

/// Files a snippet in a collection, or takes it out with `None`.
pub fn set_snippet_collection(
    conn: &Connection,
    id: &str,
    collection_id: Option<&str>,
) -> Result<SnippetDto, OrganizeError> {
    if let Some(collection) = collection_id {
        let exists: Option<String> = conn
            .query_row("SELECT id FROM collections WHERE id = ?1", params![collection], |row| row.get(0))
            .optional()?;
        if exists.is_none() {
            return Err(OrganizeError::CollectionNotFound);
        }
    }
    let changed = conn.execute(
        "UPDATE snippets SET collection_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        params![id, collection_id],
    )?;
    if changed == 0 {
        return Err(OrganizeError::SnippetNotFound);
    }
    select_snippet(conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_normalise_the_same_way_as_the_frontend() {
        assert_eq!(normalize_tag("  React   Hooks ").unwrap(), "react-hooks");
        assert_eq!(normalize_tag("C++").unwrap(), "c++");
        assert_eq!(normalize_tag("база даних").unwrap(), "база-даних");
        assert_eq!(normalize_tag("!!!"), Err(OrganizeError::TagEmpty));
        assert_eq!(normalize_tag(&"x".repeat(33)), Err(OrganizeError::TagTooLong));
        let dupes: Vec<String> = ["React", "react", "REACT", "c#"].iter().map(|s| s.to_string()).collect();
        assert_eq!(normalize_tags(&dupes).unwrap(), vec!["react", "c#"]);
    }
}
