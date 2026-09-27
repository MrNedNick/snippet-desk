//! Import, export and backups. The same rules as `src/domain/05-backup` (the browser preview's copy),
//! enforced here as the database's own guard: an archive is validated, planned as a dry run the user
//! can cancel, and applied in one transaction after an automatic backup.

use crate::db::{self, RevisionDto, SnippetDto};
use crate::organize::{self, CollectionDto};
use rusqlite::{params, Connection, DatabaseName};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const ARCHIVE_FORMAT: &str = "snippet-desk";
pub const ARCHIVE_VERSION: u64 = 1;
pub const MAX_ARCHIVE_SNIPPETS: usize = 5000;
pub const MAX_BACKUPS: usize = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDto {
    pub format: String,
    pub version: u64,
    pub exported_at: String,
    pub snippets: Vec<SnippetDto>,
    pub revisions: Vec<RevisionDto>,
    pub collections: Vec<CollectionDto>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntryDto {
    /// `added`, `updated`, `kept` or `duplicate` — see `ImportAction` in the TypeScript domain.
    pub action: &'static str,
    pub snippet: SnippetDto,
}

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
pub struct ImportCounts {
    pub added: usize,
    pub updated: usize,
    pub kept: usize,
    pub duplicate: usize,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportPlanDto {
    pub entries: Vec<ImportEntryDto>,
    pub new_collections: Vec<CollectionDto>,
    pub revisions: Vec<RevisionDto>,
    pub counts: ImportCounts,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    pub created_at: String,
    pub reason: String,
}

fn now(conn: &Connection) -> rusqlite::Result<String> {
    conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| row.get(0))
}

pub fn export_archive(conn: &Connection) -> rusqlite::Result<ArchiveDto> {
    let mut snippets = db::list_all(conn)?;
    snippets.sort_by(|a, b| a.created_at.cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
    let mut stmt = conn.prepare("SELECT id, snippet_id, code, note, created_at FROM revisions ORDER BY created_at")?;
    let revisions = stmt
        .query_map([], |row| {
            Ok(RevisionDto {
                id: row.get(0)?,
                snippet_id: row.get(1)?,
                code: row.get(2)?,
                note: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ArchiveDto {
        format: ARCHIVE_FORMAT.into(),
        version: ARCHIVE_VERSION,
        exported_at: now(conn)?,
        snippets,
        revisions,
        collections: organize::list_collections(conn)?,
    })
}

fn filled(value: &Value) -> Option<&str> {
    value.as_str().filter(|text| !text.trim().is_empty())
}

fn bad(reason: &str, index: usize, field: &str) -> String {
    format!("{reason}:{index}:{field}")
}

/// A date the frontend's `Date.parse` accepts: at least `YYYY-MM-DD`.
fn looks_like_date(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() >= 10
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
}

fn read_snippet(raw: &Value, index: usize) -> Result<SnippetDto, String> {
    let field = |name: &str| filled(&raw[name]).map(str::to_string).ok_or_else(|| bad("invalid-snippet", index, name));
    let (id, title, language) = (field("id")?, field("title")?, field("language")?);
    let code = raw["code"].as_str().filter(|code| !code.is_empty()).ok_or_else(|| bad("invalid-snippet", index, "code"))?;
    let tags: Vec<String> = raw["tagIds"]
        .as_array()
        .ok_or_else(|| bad("invalid-snippet", index, "tagIds"))?
        .iter()
        .map(|tag| tag.as_str().map(str::to_string))
        .collect::<Option<_>>()
        .ok_or_else(|| bad("invalid-snippet", index, "tagIds"))?;
    let tag_ids = organize::normalize_tags(&tags).map_err(|_| bad("invalid-snippet", index, "tagIds"))?;
    let collection_id = match &raw["collectionId"] {
        Value::Null => None,
        other => Some(filled(other).ok_or_else(|| bad("invalid-snippet", index, "collectionId"))?.to_string()),
    };
    let mut dates = ["createdAt", "updatedAt"].into_iter().map(|name| {
        filled(&raw[name]).filter(|text| looks_like_date(text)).map(str::to_string).ok_or_else(|| bad("invalid-snippet", index, name))
    });
    let (created_at, updated_at) = (dates.next().unwrap()?, dates.next().unwrap()?);
    Ok(SnippetDto {
        id,
        title: title.trim().to_string(),
        code: code.to_string(),
        language: language.trim().to_string(),
        tag_ids,
        collection_id,
        created_at,
        updated_at,
    })
}

/// Validates an archive file. Errors are the reasons the frontend knows, with `:<index>:<field>` for the
/// first bad record: `not-json`, `not-an-archive`, `unsupported-version`, `too-many-snippets`,
/// `invalid-snippet`, `invalid-collection`, `invalid-revision`.
pub fn parse_archive(text: &str) -> Result<ArchiveDto, String> {
    let raw: Value = serde_json::from_str(text).map_err(|_| "not-json".to_string())?;
    let snippets = match (&raw["format"], raw["snippets"].as_array()) {
        (Value::String(format), Some(list)) if format == ARCHIVE_FORMAT && raw.is_object() => list,
        _ => return Err("not-an-archive".into()),
    };
    if raw["version"].as_u64() != Some(ARCHIVE_VERSION) {
        return Err("unsupported-version".into());
    }
    if snippets.len() > MAX_ARCHIVE_SNIPPETS {
        return Err("too-many-snippets".into());
    }
    let snippets = snippets.iter().enumerate().map(|(i, raw)| read_snippet(raw, i)).collect::<Result<Vec<_>, _>>()?;

    let empty = Vec::new();
    let mut collections = Vec::new();
    for (index, entry) in raw["collections"].as_array().unwrap_or(&empty).iter().enumerate() {
        match (filled(&entry["id"]), filled(&entry["name"])) {
            (Some(id), Some(name)) if name.trim().chars().count() <= organize::MAX_COLLECTION_NAME_LENGTH => {
                collections.push(CollectionDto { id: id.into(), name: name.split_whitespace().collect::<Vec<_>>().join(" ") })
            }
            _ => return Err(format!("invalid-collection:{index}")),
        }
    }
    let mut revisions = Vec::new();
    for (index, entry) in raw["revisions"].as_array().unwrap_or(&empty).iter().enumerate() {
        match (filled(&entry["id"]), filled(&entry["snippetId"]), entry["code"].as_str(), entry["note"].as_str(), filled(&entry["createdAt"])) {
            (Some(id), Some(snippet_id), Some(code), Some(note), Some(created_at)) => revisions.push(RevisionDto {
                id: id.into(),
                snippet_id: snippet_id.into(),
                code: code.into(),
                note: note.into(),
                created_at: created_at.into(),
            }),
            _ => return Err(format!("invalid-revision:{index}")),
        }
    }
    Ok(ArchiveDto {
        format: ARCHIVE_FORMAT.into(),
        version: ARCHIVE_VERSION,
        exported_at: filled(&raw["exportedAt"]).unwrap_or_default().to_string(),
        snippets,
        revisions,
        collections,
    })
}

fn same_content(a: &SnippetDto, b: &SnippetDto) -> bool {
    a.title == b.title && a.language == b.language && a.code == b.code
}

/// The dry run: nothing is written. Mirrors `planImport` in `src/domain/05-backup/archive.ts`.
pub fn plan_import(conn: &Connection, archive: &ArchiveDto) -> rusqlite::Result<ImportPlanDto> {
    let library = db::list_all(conn)?;
    let mut known = organize::list_collections(conn)?;
    let mut mapping = std::collections::HashMap::new();
    let mut new_collections = Vec::new();
    for collection in &archive.collections {
        let lower = collection.name.to_lowercase();
        if let Some(found) = known.iter().find(|c| c.name.to_lowercase() == lower) {
            mapping.insert(collection.id.clone(), found.id.clone());
            continue;
        }
        let id = if known.iter().any(|c| c.id == collection.id) { uuid::Uuid::new_v4().to_string() } else { collection.id.clone() };
        let fresh = CollectionDto { id: id.clone(), name: collection.name.clone() };
        known.push(fresh.clone());
        new_collections.push(fresh);
        mapping.insert(collection.id.clone(), id);
    }

    let mut seen = library.clone();
    let mut entries = Vec::new();
    let mut counts = ImportCounts::default();
    for incoming in &archive.snippets {
        let mut snippet = incoming.clone();
        snippet.collection_id = incoming.collection_id.as_ref().and_then(|id| mapping.get(id).cloned());
        let action = match library.iter().find(|local| local.id == incoming.id) {
            Some(local) if incoming.updated_at > local.updated_at && !same_content(local, &snippet) => "updated",
            Some(_) => "kept",
            None if seen.iter().any(|other| same_content(other, &snippet)) => "duplicate",
            None => {
                seen.push(snippet.clone());
                "added"
            }
        };
        match action {
            "added" => counts.added += 1,
            "updated" => counts.updated += 1,
            "kept" => counts.kept += 1,
            _ => counts.duplicate += 1,
        }
        entries.push(ImportEntryDto { action, snippet });
    }
    let added: std::collections::HashSet<_> =
        entries.iter().filter(|entry| entry.action == "added").map(|entry| entry.snippet.id.clone()).collect();
    let revisions = archive.revisions.iter().filter(|revision| added.contains(&revision.snippet_id)).cloned().collect();
    Ok(ImportPlanDto { entries, new_collections, revisions, counts })
}

fn write_fts(tx: &Connection, snippet: &SnippetDto) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM snippets_fts WHERE id = ?1", [&snippet.id])?;
    tx.execute(
        "INSERT INTO snippets_fts (id, title, code, language) VALUES (?1, ?2, ?3, ?4)",
        params![snippet.id, snippet.title, snippet.code, snippet.language],
    )?;
    Ok(())
}

/// Applies a plan in one transaction: all of it, or — if anything fails — none of it.
pub fn apply_import(conn: &mut Connection, plan: &ImportPlanDto) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    for collection in &plan.new_collections {
        tx.execute("INSERT INTO collections (id, name) VALUES (?1, ?2)", params![collection.id, collection.name])?;
    }
    for entry in &plan.entries {
        let s = &entry.snippet;
        let tags = serde_json::to_string(&s.tag_ids).unwrap_or_else(|_| "[]".into());
        match entry.action {
            "added" => {
                tx.execute(
                    "INSERT INTO snippets (id, title, code, language, tag_ids, collection_id, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![s.id, s.title, s.code, s.language, tags, s.collection_id, s.created_at, s.updated_at],
                )?;
                write_fts(&tx, s)?;
            }
            "updated" => {
                // The code being replaced stays reachable, like any other edit.
                tx.execute(
                    "INSERT INTO revisions (id, snippet_id, code, note)
                     SELECT ?1, id, code, 'Before import' FROM snippets WHERE id = ?2",
                    params![uuid::Uuid::new_v4().to_string(), s.id],
                )?;
                tx.execute(
                    "UPDATE snippets SET title = ?2, code = ?3, language = ?4, tag_ids = ?5, collection_id = ?6, updated_at = ?7
                     WHERE id = ?1",
                    params![s.id, s.title, s.code, s.language, tags, s.collection_id, s.updated_at],
                )?;
                write_fts(&tx, s)?;
            }
            _ => {}
        }
    }
    for revision in &plan.revisions {
        tx.execute(
            "INSERT OR IGNORE INTO revisions (id, snippet_id, code, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![revision.id, revision.snippet_id, revision.code, revision.note, revision.created_at],
        )?;
    }
    tx.commit()
}

/// `snippet-desk-2026-09-27T10-30-05Z-before-import.sqlite3`, as `backupName` in the TypeScript domain.
fn backup_file_name(created_at: &str, reason: &str) -> String {
    let stamp = match created_at.split_once('.') {
        Some((whole, _)) => format!("{whole}Z"),
        None => created_at.to_string(),
    };
    format!("snippet-desk-{}-{reason}.sqlite3", stamp.replace(':', "-"))
}

const REASONS: [&str; 3] = ["manual", "before-import", "before-restore"];

fn describe_backup(name: &str) -> Option<BackupInfo> {
    let rest = name.strip_prefix("snippet-desk-")?.strip_suffix(".sqlite3")?;
    let reason = REASONS.iter().find(|reason| rest.ends_with(&format!("-{reason}")))?;
    let stamp = rest.strip_suffix(&format!("-{reason}"))?;
    let (date, time) = stamp.split_once('T')?;
    Some(BackupInfo { name: name.into(), created_at: format!("{date}T{}", time.replace('-', ":")), reason: (*reason).into() })
}

/// Newest first; files in the folder that are not backups are ignored.
pub fn list_backups(dir: &Path) -> Vec<BackupInfo> {
    let mut backups: Vec<BackupInfo> = std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(Result::ok).filter_map(|e| describe_backup(&e.file_name().to_string_lossy())).collect())
        .unwrap_or_default();
    backups.sort_by(|a, b| b.name.cmp(&a.name));
    backups
}

/// A consistent copy of the open library (`VACUUM INTO`), then the oldest backups beyond `MAX_BACKUPS` go.
pub fn create_backup(conn: &Connection, dir: &Path, reason: &str) -> Result<BackupInfo, String> {
    std::fs::create_dir_all(dir).map_err(|err| err.to_string())?;
    let created_at = now(conn).map_err(|err| err.to_string())?;
    let name = backup_file_name(&created_at, reason);
    let path = dir.join(&name);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|err| err.to_string())?;
    }
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy()]).map_err(|err| err.to_string())?;
    for old in list_backups(dir).into_iter().skip(MAX_BACKUPS) {
        let _ = std::fs::remove_file(dir.join(old.name));
    }
    describe_backup(&name).ok_or_else(|| "backup-name-unreadable".into())
}

/// Replaces the open library with a backup's contents, after backing up the current state. Only a name
/// from `list_backups` is accepted, so no path from outside the backup folder can be read.
pub fn restore_backup(conn: &mut Connection, dir: &Path, name: &str) -> Result<BackupInfo, String> {
    if !list_backups(dir).iter().any(|backup| backup.name == name) {
        return Err("backup-not-found".into());
    }
    let source: PathBuf = dir.join(name);
    let check = Connection::open(&source).map_err(|err| err.to_string())?;
    db::check_integrity(&check).map_err(|err| format!("database-corrupted: {err}"))?;
    drop(check);
    let safety = create_backup(conn, dir, "before-restore")?;
    conn.restore(DatabaseName::Main, &source, None::<fn(rusqlite::backup::Progress)>).map_err(|err| err.to_string())?;
    Ok(safety)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_round_trip_and_sort_newest_first() {
        let name = backup_file_name("2026-09-27T10:30:05.123Z", "before-import");
        assert_eq!(name, "snippet-desk-2026-09-27T10-30-05Z-before-import.sqlite3");
        let info = describe_backup(&name).unwrap();
        assert_eq!(info.created_at, "2026-09-27T10:30:05Z");
        assert_eq!(info.reason, "before-import");
        assert!(describe_backup("notes.txt").is_none());
        assert!(describe_backup("snippet-desk-2026-09-27T10-30-05Z-whatever.sqlite3").is_none());
    }

    #[test]
    fn parse_names_the_first_bad_record() {
        assert_eq!(parse_archive("{ nope").unwrap_err(), "not-json");
        assert_eq!(parse_archive("[]").unwrap_err(), "not-an-archive");
        assert_eq!(parse_archive(r#"{"format":"snippet-desk","version":2,"snippets":[]}"#).unwrap_err(), "unsupported-version");
        let no_code = r#"{"format":"snippet-desk","version":1,"snippets":[
            {"id":"x","title":"X","code":"","language":"ts","tagIds":[],"collectionId":null,"createdAt":"2026-09-01","updatedAt":"2026-09-01"}]}"#;
        assert_eq!(parse_archive(no_code).unwrap_err(), "invalid-snippet:0:code");
    }
}
