mod commands;
mod config;
mod openai;
mod proxy;
mod types;

use std::sync::Arc;

use commands::DesktopState;
use config::{resolve_data_dir, ConfigStore};
use proxy::ProxyManager;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, Wry};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

fn configured_proxy_port(config_store: &ConfigStore) -> u16 {
    config_store.get_config().settings.proxy_port
}

/// 根据当前配置构建托盘菜单
fn build_tray_menu(
    app_handle: &tauri::AppHandle,
    config_store: &ConfigStore,
) -> Result<tauri::menu::Menu<Wry>, tauri::Error> {
    let config = config_store.get_config();

    // 构建活跃网关子菜单
    let gateway_submenu = {
        let submenu_builder = SubmenuBuilder::new(app_handle, "活跃网关");
        let mut builder = submenu_builder;

        // 添加自定义 providers
        for provider in &config.providers.custom_providers {
            if provider.provider.enabled {
                let item_id = format!("tray-provider:{}", provider.id);
                let item = MenuItemBuilder::with_id(&item_id, &provider.name)
                    .build(app_handle)?;
                builder = builder.item(&item);
            }
        }

        // 添加内置 providers
        let builtin_names = [
            ("anthropic", "Anthropic"),
            ("glm", "GLM"),
            ("kimi", "Kimi"),
            ("minimax", "MiniMax"),
            ("deepseek", "DeepSeek"),
            ("litellm", "LiteLLM"),
            ("cliproxyapi", "CLI Proxy API"),
        ];
        for (key, label) in builtin_names {
            let provider = config::get_builtin_provider_pub(&config.providers, key);
            if provider.enabled {
                let item_id = format!("tray-provider:{key}");
                let item = MenuItemBuilder::with_id(&item_id, label)
                    .build(app_handle)?;
                builder = builder.item(&item);
            }
        }

        builder.build()?
    };

    // 构建主菜单
    MenuBuilder::new(app_handle)
        .item(
            &MenuItemBuilder::with_id("tray-show", "显示主窗口")
                .build(app_handle)?,
        )
        .separator()
        .item(&gateway_submenu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("tray-start", "启动代理")
                .build(app_handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("tray-stop", "停止代理")
                .build(app_handle)?,
        )
        .item(
            &MenuItemBuilder::with_id("tray-restart", "重启代理")
                .build(app_handle)?,
        )
        .separator()
        .item(&PredefinedMenuItem::quit(app_handle, Some("退出"))?)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::<Wry>::default()
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_data_dir = app_handle
                .path()
                .app_data_dir()
                .map_err(|err| err.to_string())?;
            let data_dir = resolve_data_dir(app_data_dir);
            let config_store = Arc::new(ConfigStore::new(data_dir.clone())?);
            let proxy_manager = ProxyManager::new(app_handle.clone(), config_store.clone(), data_dir)?;
            let should_auto_launch = config_store.get_config().settings.auto_launch;

            // 同步 OS 级开机自启状态与配置
            let autostart_manager = app.handle().autolaunch();
            let is_os_enabled = autostart_manager.is_enabled().unwrap_or(false);
            if should_auto_launch && !is_os_enabled {
                let _ = autostart_manager.enable();
            } else if !should_auto_launch && is_os_enabled {
                let _ = autostart_manager.disable();
            }

            app.manage(DesktopState {
                app_handle: app_handle.clone(),
                config_store: config_store.clone(),
                proxy_manager: proxy_manager.clone(),
            });

            // 构建系统托盘
            let tray_menu = build_tray_menu(&app_handle, &config_store)
                .map_err(|err| err.to_string())?;

            let app_handle_for_tray = app_handle.clone();
            let proxy_manager_for_tray = proxy_manager.clone();
            let config_store_for_tray = config_store.clone();

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Claude Proxy - 代理网关")
                .menu(&tray_menu)
                .on_menu_event(move |app_handle, event| {
                    let menu_id = event.id().as_ref();
                    match menu_id {
                        "tray-show" => {
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "tray-start" => {
                            let pm = proxy_manager_for_tray.clone();
                            let port = configured_proxy_port(&config_store_for_tray);
                            tauri::async_runtime::spawn(async move {
                                let _ = pm.start(port).await;
                            });
                        }
                        "tray-stop" => {
                            let pm = proxy_manager_for_tray.clone();
                            tauri::async_runtime::spawn(async move {
                                pm.stop().await;
                            });
                        }
                        "tray-restart" => {
                            let pm = proxy_manager_for_tray.clone();
                            let port = configured_proxy_port(&config_store_for_tray);
                            tauri::async_runtime::spawn(async move {
                                pm.stop().await;
                                let _ = pm.start(port).await;
                            });
                        }
                        id if id.starts_with("tray-provider:") => {
                            if let Some(provider_id) = id.strip_prefix("tray-provider:") {
                                let _ = app_handle_for_tray.emit(
                                    "tray-switch-provider",
                                    serde_json::json!({ "providerId": provider_id }),
                                );
                                // 刷新托盘菜单
                                if let Ok(new_menu) = build_tray_menu(&app_handle_for_tray, &config_store_for_tray) {
                                    if let Some(tray) = app_handle_for_tray.tray_by_id("main") {
                                        let _ = tray.set_menu(Some(new_menu));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // 拦截窗口关闭事件 - 隐藏到托盘而非退出
            if let Some(window) = app_handle.get_webview_window("main") {
                let window_handle = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_handle.hide();
                    }
                });
            }

            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.center();
                let _ = window.show();
            }

            if should_auto_launch {
                let auto_launch_port = configured_proxy_port(&config_store);
                tauri::async_runtime::spawn(async move {
                    let _ = proxy_manager.start(auto_launch_port).await;
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::set_config,
            commands::get_all_config,
            commands::get_auto_launch,
            commands::set_auto_launch,
            commands::get_mapping,
            commands::set_mapping,
            commands::get_available_targets,
            commands::check_system_env,
            commands::set_system_env,
            commands::start_proxy,
            commands::stop_proxy,
            commands::restart_proxy,
            commands::get_proxy_status,
            commands::release_port_process,
            commands::import_config,
            commands::export_config,
            commands::clear_logs,
            commands::get_logs,
            commands::get_token_usage_records,
            commands::clear_token_usage_records,
            commands::show_main_window,
            commands::hide_main_window,
            commands::show_float_window,
            commands::hide_float_window,
            commands::move_float_window,
            commands::show_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
