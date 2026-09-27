//! The global shortcut: registered with the OS through `tauri-plugin-global-shortcut`, it brings the
//! window forward and tells the page to open quick search.

use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event the page listens for to open the quick search.
pub const QUICK_SEARCH_EVENT: &str = "quick-search-requested";

#[cfg(desktop)]
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_global_shortcut::{Builder, ShortcutState};
    Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                bring_forward(app);
            }
        })
        .build()
}

/// Shows and focuses the main window, then asks the page to open quick search.
pub fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(QUICK_SEARCH_EVENT, ());
}

/// Registers `next`, then releases `previous`. Errors come back as `shortcut-unavailable: …`.
#[cfg(desktop)]
pub fn swap<R: Runtime>(app: &AppHandle<R>, previous: Option<&str>, next: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcuts = app.global_shortcut();
    if previous == Some(next) {
        return Ok(());
    }
    shortcuts.register(next).map_err(|err| format!("shortcut-unavailable: {err}"))?;
    if let Some(previous) = previous {
        let _ = shortcuts.unregister(previous);
    }
    Ok(())
}

#[cfg(not(desktop))]
pub fn swap<R: Runtime>(_app: &AppHandle<R>, _previous: Option<&str>, _next: &str) -> Result<(), String> {
    Err("shortcut-unavailable: global shortcuts need a desktop OS".into())
}
