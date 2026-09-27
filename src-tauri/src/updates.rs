//! Signed self-updates through `tauri-plugin-updater`.
//!
//! A build only updates itself when it was compiled with the public half of the release signing key in
//! `SNIPPET_DESK_UPDATER_PUBKEY`. Without it the app cannot verify a download, so it does not try: the
//! check answers `updates-not-configured` instead of reaching the network.

use serde::Serialize;
use tauri::{AppHandle, Runtime};

/// The public key this build verifies updates with, if the release workflow provided one.
pub const PUBKEY: Option<&str> = option_env!("SNIPPET_DESK_UPDATER_PUBKEY");

pub fn configured() -> bool {
    PUBKEY.is_some_and(|key| !key.trim().is_empty())
}

/// `darwin-aarch64`, `linux-x86_64`, `windows-x86_64` — the keys the update manifest uses.
pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppVersionDto {
    pub version: String,
    pub platform: String,
    /// `configured` or `not-configured`.
    pub updates: &'static str,
}

pub fn app_version<R: Runtime>(app: &AppHandle<R>) -> AppVersionDto {
    AppVersionDto {
        version: app.package_info().version.to_string(),
        platform: platform(),
        updates: if configured() { "configured" } else { "not-configured" },
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum UpdateCheckDto {
    UpToDate { current: String },
    Available { current: String, version: String, notes: String, date: Option<String> },
}

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct PendingUpdate(pub std::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[cfg(desktop)]
pub async fn check<R: Runtime>(app: &AppHandle<R>, pending: &PendingUpdate) -> Result<UpdateCheckDto, String> {
    use tauri_plugin_updater::UpdaterExt;
    let key = PUBKEY.filter(|key| !key.trim().is_empty()).ok_or_else(|| "updates-not-configured".to_string())?;
    let updater = app.updater_builder().pubkey(key).build().map_err(|err| format!("update-check-failed: {err}"))?;
    let current = app.package_info().version.to_string();
    let found = updater.check().await.map_err(|err| format!("update-check-failed: {err}"))?;
    let Some(update) = found else {
        return Ok(UpdateCheckDto::UpToDate { current });
    };
    let answer = UpdateCheckDto::Available {
        current,
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date: update.date.map(|date| date.to_string()),
    };
    *pending.0.lock().map_err(|_| "update-lock-poisoned".to_string())? = Some(update);
    Ok(answer)
}

/// Downloads the pending update — the plugin refuses it unless its signature matches the built-in key —
/// installs it and restarts into the new version.
#[cfg(desktop)]
pub async fn install<R: Runtime>(app: &AppHandle<R>, pending: &PendingUpdate) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|_| "update-lock-poisoned".to_string())?
        .take()
        .ok_or_else(|| "no-pending-update".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| format!("update-install-failed: {err}"))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_platform_key_is_the_manifest_spelling() {
        let key = platform();
        assert!(key.starts_with("darwin-") || key.starts_with("linux-") || key.starts_with("windows-"), "{key}");
        assert!(!key.contains("macos"));
    }

    #[test]
    fn the_updater_block_in_tauri_conf_is_one_the_plugin_accepts() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let block = conf["plugins"]["updater"].clone();
        let config: tauri_plugin_updater::Config = serde_json::from_value(block).expect("plugin config");
        assert_eq!(config.endpoints.len(), 1);
        assert!(config.endpoints[0].as_str().starts_with("https://"), "updates only over HTTPS");
        assert!(config.require_signed_version, "the signature must name the version it was made for");
    }

    #[test]
    fn a_build_without_a_key_does_not_claim_updates() {
        if PUBKEY.is_none() {
            assert!(!configured());
        }
    }
}
