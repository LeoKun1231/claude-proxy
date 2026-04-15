use std::sync::Arc;

use serde_json::Value;
use serde::{Deserialize, Serialize};
use tauri::{
    menu::{CheckMenuItem, Menu},
    AppHandle, Emitter, LogicalPosition, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    config::{get_available_targets as config_get_available_targets, ConfigStore},
    proxy::ProxyManager,
    types::{ConfigUpdatedPayload, ProxyCommandResult, ProxyStatusPayload},
};

pub struct DesktopState {
    pub app_handle: AppHandle,
    pub config_store: Arc<ConfigStore>,
    pub proxy_manager: ProxyManager,
}

const FLOAT_WINDOW_LABEL: &str = "float";
const CONTEXT_MENU_PREFIX: &str = "context-target:";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuOption {
    pub label: String,
    pub value: String,
    #[serde(default)]
    pub checked: bool,
}

impl DesktopState {
    pub fn emit_config_updated(&self, key: impl Into<String>) {
        let _ = self.app_handle.emit(
            "config-updated",
            ConfigUpdatedPayload {
                key: key.into(),
                updated_at: chrono::Utc::now().timestamp_millis(),
            },
        );
    }

    pub fn emit_config_imported(&self) {
        let _ = self.app_handle.emit(
            "config-imported",
            serde_json::json!({ "importedAt": chrono::Utc::now().timestamp_millis() }),
        );
    }
}

fn float_window_script() -> &'static str {
    r#"
      if (window.location.hash !== '#/float') {
        const base = window.location.href.split('#')[0];
        window.location.replace(`${base}#/float`);
      }
    "#
}

fn get_or_create_float_window(state: &DesktopState) -> Result<WebviewWindow, String> {
    if let Some(window) = state.app_handle.get_webview_window(FLOAT_WINDOW_LABEL) {
        return Ok(window);
    }

    let app_handle = state.app_handle.clone();
    let window = WebviewWindowBuilder::new(&app_handle, FLOAT_WINDOW_LABEL, WebviewUrl::App("index.html".into()))
        .title("Claude Proxy Float")
        .inner_size(72.0, 72.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .transparent(true)
        .visible(false)
        .focused(true)
        .center()
        .initialization_script(float_window_script())
        .build()
        .map_err(|err| err.to_string())?;

    let app_handle_for_menu = app_handle.clone();
    window.on_menu_event(move |_window, event| {
        let menu_id = event.id().as_ref();
        if let Some(value) = menu_id.strip_prefix(CONTEXT_MENU_PREFIX) {
            let _ = app_handle_for_menu.emit(
                "context-menu-command",
                serde_json::json!({ "value": value }),
            );
        }
    });

    Ok(window)
}

#[tauri::command]
pub async fn get_config(state: State<'_, DesktopState>, key: String) -> Result<Value, String> {
    Ok(state.config_store.get_value(&key))
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, DesktopState>,
    key: String,
    value: Value,
) -> Result<(), String> {
    state.config_store.set_value(&key, value)?;
    state.emit_config_updated(key);
    Ok(())
}

#[tauri::command]
pub async fn get_all_config(state: State<'_, DesktopState>) -> Result<Value, String> {
    serde_json::to_value(state.config_store.get_config()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_auto_launch(state: State<'_, DesktopState>) -> Result<bool, String> {
    Ok(state.config_store.get_config().settings.auto_launch)
}

#[tauri::command]
pub async fn set_auto_launch(
    state: State<'_, DesktopState>,
    enabled: bool,
) -> Result<bool, String> {
    if enabled {
        state
            .app_handle
            .autolaunch()
            .enable()
            .map_err(|err| err.to_string())?;
    } else {
        state
            .app_handle
            .autolaunch()
            .disable()
            .map_err(|err| err.to_string())?;
    }

    state
        .config_store
        .set_value("settings.autoLaunch", Value::Bool(enabled))?;
    state.emit_config_updated("settings.autoLaunch");
    Ok(true)
}

#[tauri::command]
pub async fn get_mapping(
    state: State<'_, DesktopState>,
    model_type: String,
) -> Result<String, String> {
    let config = state.config_store.get_config();
    Ok(match model_type.as_str() {
        "main" => config.mapping.main,
        "haiku" => config.mapping.haiku,
        _ => "pass".into(),
    })
}

#[tauri::command]
pub async fn set_mapping(
    state: State<'_, DesktopState>,
    model_type: String,
    value: String,
) -> Result<(), String> {
    let key = format!("mapping.{model_type}");
    state
        .config_store
        .set_value(&key, Value::String(value))?;
    state.emit_config_updated(key);
    Ok(())
}

#[tauri::command]
pub async fn get_available_targets(state: State<'_, DesktopState>) -> Result<Vec<String>, String> {
    Ok(config_get_available_targets(&state.config_store.get_config()))
}

#[tauri::command]
pub async fn check_system_env(_state: State<'_, DesktopState>) -> Result<Option<String>, String> {
    Ok(std::env::var("ANTHROPIC_BASE_URL").ok())
}

#[tauri::command]
pub async fn set_system_env(
    _state: State<'_, DesktopState>,
    url: Option<String>,
) -> Result<bool, String> {
    if let Some(url) = url.filter(|value| !value.trim().is_empty()) {
        unsafe {
            std::env::set_var("ANTHROPIC_BASE_URL", url);
            if std::env::var("ANTHROPIC_API_KEY").is_err() {
                std::env::set_var("ANTHROPIC_API_KEY", "sk-local-proxy");
            }
        }
    } else {
        unsafe {
            std::env::remove_var("ANTHROPIC_BASE_URL");
            std::env::remove_var("ANTHROPIC_API_KEY");
        }
    }
    Ok(true)
}

#[tauri::command]
pub async fn start_proxy(
    state: State<'_, DesktopState>,
) -> Result<ProxyCommandResult, String> {
    Ok(state.proxy_manager.start(5055).await)
}

#[tauri::command]
pub async fn stop_proxy(state: State<'_, DesktopState>) -> Result<(), String> {
    state.proxy_manager.stop().await;
    Ok(())
}

#[tauri::command]
pub async fn restart_proxy(
    state: State<'_, DesktopState>,
) -> Result<ProxyCommandResult, String> {
    state.proxy_manager.stop().await;
    Ok(state.proxy_manager.start(5055).await)
}

#[tauri::command]
pub async fn get_proxy_status(
    state: State<'_, DesktopState>,
) -> Result<ProxyStatusPayload, String> {
    Ok(state.proxy_manager.get_status())
}

#[tauri::command]
pub async fn import_config(
    state: State<'_, DesktopState>,
    config: Value,
) -> Result<bool, String> {
    state.config_store.replace_from_value(config)?;
    state.emit_config_imported();
    state.emit_config_updated("all");
    Ok(true)
}

#[tauri::command]
pub async fn export_config(state: State<'_, DesktopState>) -> Result<Value, String> {
    serde_json::to_value(state.config_store.get_config()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn clear_logs(state: State<'_, DesktopState>) -> Result<bool, String> {
    state.proxy_manager.clear_logs().await;
    Ok(true)
}

#[tauri::command]
pub async fn get_logs(state: State<'_, DesktopState>) -> Result<Value, String> {
    serde_json::to_value(state.proxy_manager.get_logs()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_token_usage_records(state: State<'_, DesktopState>) -> Result<Value, String> {
    serde_json::to_value(state.proxy_manager.get_token_usage_records()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn clear_token_usage_records(state: State<'_, DesktopState>) -> Result<bool, String> {
    state.proxy_manager.clear_token_usage_records().await;
    Ok(true)
}

#[tauri::command]
pub async fn show_main_window(state: State<'_, DesktopState>) -> Result<(), String> {
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    if let Some(float_window) = state.app_handle.get_webview_window(FLOAT_WINDOW_LABEL) {
        let _ = float_window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_main_window(state: State<'_, DesktopState>) -> Result<(), String> {
    if let Some(window) = state.app_handle.get_webview_window("main") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn show_float_window(state: State<'_, DesktopState>) -> Result<(), String> {
    let window = get_or_create_float_window(&state)?;
    let _ = window.show();
    // Linux/Wayland WM 有时会在 show 后重置 always_on_top，需要再次强制设置
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
pub async fn hide_float_window(state: State<'_, DesktopState>) -> Result<(), String> {
    if let Some(window) = state.app_handle.get_webview_window(FLOAT_WINDOW_LABEL) {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn move_float_window(
    state: State<'_, DesktopState>,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if let Some(window) = state.app_handle.get_webview_window(FLOAT_WINDOW_LABEL) {
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
    Ok(())
}

#[tauri::command]
pub async fn show_context_menu(
    state: State<'_, DesktopState>,
    window: WebviewWindow,
    options: Vec<ContextMenuOption>,
) -> Result<(), String> {
    let menu = Menu::new(&state.app_handle).map_err(|err| err.to_string())?;
    let menu_items = options
        .iter()
        .map(|option| {
            CheckMenuItem::with_id(
                &state.app_handle,
                format!("{CONTEXT_MENU_PREFIX}{}", option.value),
                &option.label,
                true,
                option.checked,
                None::<&str>,
            )
            .map_err(|err| err.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    let refs = menu_items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<_>)
        .collect::<Vec<_>>();
    menu.append_items(&refs).map_err(|err| err.to_string())?;
    window.popup_menu(&menu).map_err(|err| err.to_string())?;
    Ok(())
}
