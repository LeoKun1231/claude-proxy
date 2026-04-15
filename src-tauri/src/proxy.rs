use std::{
    convert::Infallible,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use async_stream::stream;
use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{HeaderMap, HeaderValue, Method, Response, StatusCode, Uri},
    routing::any,
    Router,
};
use chrono::Utc;
use futures_util::StreamExt;
use reqwest::Client;
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpListener,
    sync::oneshot,
    task::JoinHandle,
};
use uuid::Uuid;

use crate::{
    config::{ConfigStore, BUILTIN_PROVIDER_KEYS},
    openai,
    types::{AppConfig, ProxyCommandResult, ProxyLogPayload, ProxyStatusPayload, TokenUsagePayload, TokenUsageRecord},
};

const UPSTREAM_TIMEOUT_MS: u64 = 120_000;
const MAX_PROXY_LOGS: usize = 500;
const MAX_TOKEN_RECORDS: usize = 10_000;
const DOCKER_HOST_ALIAS: &str = "host.docker.internal";

#[derive(Clone)]
pub struct ProxyManager {
    app_handle: AppHandle,
    config_store: Arc<ConfigStore>,
    logs: Arc<Mutex<Vec<ProxyLogPayload>>>,
    token_records: Arc<Mutex<Vec<TokenUsageRecord>>>,
    token_records_path: Arc<PathBuf>,
    client: Client,
    current_port: Arc<Mutex<u16>>,
    server_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl ProxyManager {
    pub fn new(app_handle: AppHandle, config_store: Arc<ConfigStore>, data_dir: PathBuf) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .pool_max_idle_per_host(20)
            .build()
            .map_err(|err| err.to_string())?;
        let token_records_path = data_dir.join("token-usage.json");
        let token_records = load_token_records(&token_records_path);

        Ok(Self {
            app_handle,
            config_store,
            logs: Arc::new(Mutex::new(Vec::new())),
            token_records: Arc::new(Mutex::new(token_records)),
            token_records_path: Arc::new(token_records_path),
            client,
            current_port: Arc::new(Mutex::new(5055)),
            server_task: Arc::new(Mutex::new(None)),
            shutdown_tx: Arc::new(Mutex::new(None)),
        })
    }

    pub fn get_status(&self) -> ProxyStatusPayload {
        let running = self
            .server_task
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false);
        let port = self.current_port.lock().map(|guard| *guard).unwrap_or(5055);
        ProxyStatusPayload { running, port }
    }

    pub fn get_logs(&self) -> Vec<ProxyLogPayload> {
        self.logs.lock().map(|guard| guard.clone()).unwrap_or_default()
    }

    pub fn get_token_usage_records(&self) -> Vec<TokenUsageRecord> {
        self.token_records
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn emit_log(&self, kind: &str, message: impl Into<String>) {
        self.emit_log_payload(ProxyLogPayload {
            message: message.into(),
            r#type: kind.to_string(),
            timestamp: Utc::now().to_rfc3339(),
            request_id: None,
            provider_id: None,
            provider_label: None,
            model: None,
            token_usage: None,
        });
    }

    pub fn record_token_usage(
        &self,
        request_id: &str,
        provider_id: &str,
        provider_label: &str,
        model: &str,
        token_usage: TokenUsagePayload,
    ) {
        let now = Utc::now();
        let record = TokenUsageRecord {
            request_id: request_id.to_string(),
            provider_id: provider_id.trim().to_string(),
            provider_label: provider_label.trim().to_string(),
            model: model.trim().to_string(),
            input_tokens: token_usage.input_tokens,
            output_tokens: token_usage.output_tokens,
            total_tokens: token_usage.total_tokens,
            timestamp: now.to_rfc3339(),
            timestamp_ms: now.timestamp_millis(),
        };
        if let Ok(mut guard) = self.token_records.lock() {
            guard.push(record);
            if guard.len() > MAX_TOKEN_RECORDS {
                let overflow = guard.len() - MAX_TOKEN_RECORDS;
                guard.drain(0..overflow);
            }
            if let Err(err) = persist_token_records(&self.token_records_path, &guard) {
                self.emit_log("error", format!("持久化 token 统计失败: {err}"));
            }
        }

        let message = format!(
            "[TOKENS][{request_id}] provider={} model={} input={} output={} total={}",
            if provider_label.trim().is_empty() { provider_id.trim() } else { provider_label.trim() },
            if model.trim().is_empty() { "unknown" } else { model.trim() },
            token_usage.input_tokens,
            token_usage.output_tokens,
            token_usage.total_tokens,
        );
        self.emit_log_payload(ProxyLogPayload {
            message,
            r#type: "info".to_string(),
            timestamp: now.to_rfc3339(),
            request_id: Some(request_id.to_string()),
            provider_id: Some(provider_id.trim().to_string()),
            provider_label: Some(provider_label.trim().to_string()),
            model: Some(model.trim().to_string()),
            token_usage: Some(token_usage),
        });
    }

    fn emit_log_payload(&self, payload: ProxyLogPayload) {
        let payload = ProxyLogPayload {
            message: payload.message,
            r#type: payload.r#type,
            timestamp: payload.timestamp,
            request_id: payload.request_id,
            provider_id: payload.provider_id,
            provider_label: payload.provider_label,
            model: payload.model,
            token_usage: payload.token_usage,
        };

        if let Ok(mut guard) = self.logs.lock() {
            guard.push(payload.clone());
            if guard.len() > MAX_PROXY_LOGS {
                let overflow = guard.len() - MAX_PROXY_LOGS;
                guard.drain(0..overflow);
            }
        }

        let _ = self.app_handle.emit("proxy-log", payload);
    }

    pub async fn clear_logs(&self) {
        if let Ok(mut guard) = self.logs.lock() {
            guard.clear();
        }
    }

    pub async fn clear_token_usage_records(&self) {
        if let Ok(mut guard) = self.token_records.lock() {
            guard.clear();
            let _ = persist_token_records(&self.token_records_path, &guard);
        }
    }

    pub async fn start(&self, port: u16) -> ProxyCommandResult {
        if self
            .server_task
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
        {
            return ProxyCommandResult {
                success: true,
                port: self.current_port.lock().map(|guard| *guard).unwrap_or(port),
                error: None,
                already_running: Some(true),
            };
        }

        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(err) => {
                return ProxyCommandResult {
                    success: false,
                    port,
                    error: Some(err.to_string()),
                    already_running: None,
                };
            }
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let state = self.clone();
        let app = Router::new().fallback(any(proxy_handler)).with_state(state.clone());

        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        if let Ok(mut guard) = self.current_port.lock() {
            *guard = port;
        }
        if let Ok(mut guard) = self.shutdown_tx.lock() {
            *guard = Some(shutdown_tx);
        }
        if let Ok(mut guard) = self.server_task.lock() {
            *guard = Some(task);
        }

        self.emit_log("info", format!("代理服务器已启动，监听端口 {port}"));

        ProxyCommandResult {
            success: true,
            port,
            error: None,
            already_running: None,
        }
    }

    pub async fn stop(&self) {
        if let Ok(mut guard) = self.shutdown_tx.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
        let task = if let Ok(mut guard) = self.server_task.lock() {
            guard.take()
        } else {
            None
        };
        if let Some(task) = task {
            let _ = task.await;
        }
        self.emit_log("info", "代理服务器已停止");
    }
}

#[derive(Debug, Clone)]
struct ResolvedProviderConfig {
    provider_id: String,
    provider_label: String,
    base_url: String,
    api_key: String,
    model_name: String,
    resolution_source: &'static str,
    route_id: Option<String>,
    source_model: Option<String>,
}

fn load_token_records(path: &Path) -> Vec<TokenUsageRecord> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };

    serde_json::from_str::<Vec<TokenUsageRecord>>(&raw)
        .map(trim_token_records)
        .unwrap_or_default()
}

fn persist_token_records(path: &Path, records: &[TokenUsageRecord]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let raw = serde_json::to_string_pretty(records).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn trim_token_records(mut records: Vec<TokenUsageRecord>) -> Vec<TokenUsageRecord> {
    if records.len() > MAX_TOKEN_RECORDS {
        let overflow = records.len() - MAX_TOKEN_RECORDS;
        records.drain(0..overflow);
    }
    records
}

async fn proxy_handler(
    State(manager): State<ProxyManager>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    if method == Method::OPTIONS {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = StatusCode::OK;
        add_cors_headers(response.headers_mut());
        return response;
    }

    let request_id = create_request_id(&headers);
    let body_text = String::from_utf8(body.to_vec()).unwrap_or_default();
    let content_type = read_header_value(&headers, "content-type").to_lowercase();
    let is_json_like_body =
        !body_text.trim().is_empty()
            && (content_type.contains("application/json")
                || body_text.trim_start().starts_with('{')
                || body_text.trim_start().starts_with('['));
    let parsed_body = if is_json_like_body {
        serde_json::from_str::<serde_json::Value>(&body_text).ok()
    } else {
        None
    };
    let requested_model = parsed_body
        .as_ref()
        .and_then(|value| value.get("model"))
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    let app_config = manager.config_store.get_config();
    let resolution = resolve_request_provider_config(&app_config, &requested_model);
    let provider = match resolution {
        Ok(provider) => provider,
        Err(message) => {
            manager.emit_log(
                "error",
                format!(
                    "[ERR][{request_id}] {message} | requested_model={}",
                    if requested_model.is_empty() { "(empty)" } else { &requested_model }
                ),
            );
            return json_response(StatusCode::BAD_REQUEST, serde_json::json!({
                "error": message,
                "requestId": request_id
            }));
        }
    };

    if provider.resolution_source == "modelRoute" {
        manager.emit_log(
            "info",
            format!(
                "[ROUTE][{request_id}] model_route_hit route={} source={} target={} provider={}",
                provider.route_id.clone().unwrap_or_else(|| "unknown".into()),
                provider.source_model.clone().unwrap_or_else(|| requested_model.clone()),
                if provider.model_name.is_empty() { "(empty)" } else { &provider.model_name },
                provider.provider_label
            ),
        );
    } else if provider.resolution_source == "providerInference" {
        manager.emit_log(
            "info",
            format!(
                "[ROUTE][{request_id}] provider_inferred provider={} requested_model={}",
                provider.provider_label,
                if requested_model.is_empty() { "(empty)" } else { &requested_model }
            ),
        );
    } else {
        manager.emit_log(
            "info",
            format!(
                "[ROUTE][{request_id}] legacy_fallback requested_model={}",
                if requested_model.is_empty() { "(empty)" } else { &requested_model }
            ),
        );
    }

    let incoming_path = normalize_path(uri.path());
    let incoming_search = uri
        .path_and_query()
        .map(|value| value.as_str())
        .and_then(|value| value.split_once('?').map(|(_, search)| format!("?{search}")))
        .unwrap_or_default();

    let should_use_openai_compat = openai::is_openai_chat_completions_path(&incoming_path)
        && openai::is_anthropic_compatible_provider(&provider.provider_id, &provider.base_url);

    let mut upstream_path = incoming_path.clone();
    let mut final_body = body_text.clone();
    let mut openai_stream_requested = false;

    if should_use_openai_compat {
        if let Some(parsed) = parsed_body.as_ref() {
            let converted = openai::convert_openai_chat_request_to_anthropic(parsed, &provider.model_name);
            openai_stream_requested = converted
                .get("stream")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            final_body = serde_json::to_string(&converted).unwrap_or_default();
            upstream_path = "/v1/messages".into();
            manager.emit_log(
                "info",
                format!("[MAP][{request_id}] OpenAI chat/completions -> Anthropic messages"),
            );
        }
    } else if !provider.model_name.is_empty() {
        if let Some(mut parsed) = parsed_body.clone() {
            parsed["model"] = serde_json::Value::String(provider.model_name.clone());
            final_body = serde_json::to_string(&parsed).unwrap_or_default();
        }
    }

    let base_url = normalize_base_url_for_docker(&provider.base_url);
    let target_url = format!(
        "{}/{}{}",
        base_url.trim_end_matches('/'),
        upstream_path.trim_start_matches('/'),
        incoming_search
    );

    manager.emit_log(
        "info",
        format!(
            "[REQ][{request_id}] {} {} | Model: {}",
            method,
            target_url,
            if provider.model_name.is_empty() { "unknown" } else { &provider.model_name }
        ),
    );

    let mut request_builder = manager.client.request(method.clone(), &target_url);
    for (name, value) in headers.iter() {
        let key = name.as_str().to_ascii_lowercase();
        if matches!(
            key.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "authorization"
                | "proxy-authorization"
                | "x-api-key"
                | "anthropic-api-key"
                | "x-forwarded-for"
                | "x-forwarded-host"
                | "x-forwarded-proto"
                | "forwarded"
                | "x-real-ip"
        ) {
            continue;
        }
        if let Ok(text) = value.to_str() {
            request_builder = request_builder.header(name.as_str(), text);
        }
    }

    request_builder = request_builder.header("x-request-id", &request_id);
    if !provider.api_key.is_empty() {
        request_builder = request_builder.header("x-api-key", &provider.api_key);
        request_builder = request_builder.bearer_auth(&provider.api_key);
    }

    if (should_use_openai_compat || upstream_path == "/v1/messages")
        && !headers.contains_key("anthropic-version")
    {
        request_builder = request_builder.header("anthropic-version", "2023-06-01");
    }

    if !final_body.is_empty() {
        request_builder = request_builder.body(final_body.clone());
    }

    let upstream_response = match request_builder.send().await {
        Ok(response) => response,
        Err(err) => {
            let hint = build_proxy_error_hint(&err, &provider.base_url);
            let detail = if hint.is_empty() {
                err.to_string()
            } else {
                format!("{} | {}", err, hint)
            };
            manager.emit_log("error", format!("[ERR][{request_id}] 请求失败: {detail}"));
            if should_use_openai_compat {
                return json_response(
                    StatusCode::BAD_GATEWAY,
                    openai::get_openai_error_payload(502, "{}"),
                );
            }
            return json_response(StatusCode::BAD_GATEWAY, serde_json::json!({
                "error": "Proxy Error: upstream request failed",
                "requestId": request_id
            }));
        }
    };

    let status = StatusCode::from_u16(upstream_response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let upstream_headers = upstream_response.headers().clone();
    let response_content_type = upstream_response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_lowercase();

    if should_use_openai_compat {
        if status.is_client_error() || status.is_server_error() {
            let body = upstream_response.text().await.unwrap_or_default();
            manager.emit_log("error", format!("[ERR][{request_id}] Upstream {} ", status.as_u16()));
            return json_response(status, openai::get_openai_error_payload(status.as_u16(), &body));
        }

        if openai_stream_requested || response_content_type.contains("text/event-stream") {
            let manager_for_usage = manager.clone();
            let request_id_for_usage = request_id.clone();
            let provider_id_for_usage = provider.provider_id.clone();
            let provider_label_for_usage = provider.provider_label.clone();
            let model_for_usage = provider.model_name.clone();
            let stream = openai::proxy_anthropic_stream_as_openai(
                upstream_response.bytes_stream(),
                provider.model_name.clone(),
                Some(Arc::new(move |usage: TokenUsagePayload| {
                    manager_for_usage.record_token_usage(
                        &request_id_for_usage,
                        &provider_id_for_usage,
                        &provider_label_for_usage,
                        &model_for_usage,
                        usage,
                    );
                })),
            );
            let mut response = Response::new(Body::from_stream(stream));
            *response.status_mut() = status;
            add_cors_headers(response.headers_mut());
            response.headers_mut().insert(
                "content-type",
                HeaderValue::from_static("text/event-stream; charset=utf-8"),
            );
            response.headers_mut().insert("cache-control", HeaderValue::from_static("no-cache"));
            response.headers_mut().insert("x-accel-buffering", HeaderValue::from_static("no"));
            manager.emit_log("info", format!("[RES][{request_id}] status={}", status.as_u16()));
            return response;
        }

        let response_body = upstream_response.text().await.unwrap_or_default();
        let transformed = serde_json::from_str::<serde_json::Value>(&response_body)
            .map(|value| {
                if let Some(token_usage) = extract_token_usage_from_value(&value) {
                    manager.record_token_usage(
                        &request_id,
                        &provider.provider_id,
                        &provider.provider_label,
                        &provider.model_name,
                        token_usage,
                    );
                }
                openai::convert_anthropic_message_to_openai_response(&value, &provider.model_name)
            })
            .unwrap_or_else(|_| serde_json::Value::String(response_body));
        manager.emit_log("info", format!("[RES][{request_id}] status={}", status.as_u16()));
        return json_response(status, transformed);
    }

    if response_content_type.contains("text/event-stream") {
        let manager_for_usage = manager.clone();
        let request_id_for_usage = request_id.clone();
        let provider_id_for_usage = provider.provider_id.clone();
        let provider_label_for_usage = provider.provider_label.clone();
        let model_for_usage = provider.model_name.clone();
        let raw_stream = stream! {
            let mut upstream = upstream_response.bytes_stream();
            let mut frame_buffer = String::new();
            let mut token_usage = None;
            while let Some(item) = upstream.next().await {
                if let Ok(chunk) = item {
                    frame_buffer.push_str(&String::from_utf8_lossy(&chunk));
                    while let Some(boundary_index) = frame_buffer.find("\r\n\r\n").or_else(|| frame_buffer.find("\n\n")) {
                        let frame = frame_buffer[..boundary_index].to_string();
                        let boundary_len = if frame_buffer[boundary_index..].starts_with("\r\n\r\n") { 4 } else { 2 };
                        frame_buffer = frame_buffer[boundary_index + boundary_len..].to_string();
                        merge_token_usage(&mut token_usage, parse_sse_usage_frame(&frame));
                    }
                    yield Ok::<Bytes, Infallible>(chunk);
                } else {
                    break;
                }
            }
            if !frame_buffer.trim().is_empty() {
                merge_token_usage(&mut token_usage, parse_sse_usage_frame(&frame_buffer));
            }
            if let Some(usage) = token_usage {
                manager_for_usage.record_token_usage(
                    &request_id_for_usage,
                    &provider_id_for_usage,
                    &provider_label_for_usage,
                    &model_for_usage,
                    usage,
                );
            }
        };
        let mut response = Response::new(Body::from_stream(raw_stream));
        *response.status_mut() = status;
        add_cors_headers(response.headers_mut());
        copy_response_headers(response.headers_mut(), &upstream_headers);
        manager.emit_log("info", format!("[RES][{request_id}] status={}", status.as_u16()));
        return response;
    }

    let bytes = upstream_response.bytes().await.unwrap_or_default();
    if response_content_type.contains("application/json") {
        if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(token_usage) = extract_token_usage_from_value(&value) {
                manager.record_token_usage(
                    &request_id,
                    &provider.provider_id,
                    &provider.provider_label,
                    &provider.model_name,
                    token_usage,
                );
            }
        }
    }
    let mut response = Response::new(Body::from(bytes));
    *response.status_mut() = status;
    add_cors_headers(response.headers_mut());
    copy_response_headers(response.headers_mut(), &upstream_headers);
    manager.emit_log("info", format!("[RES][{request_id}] status={}", status.as_u16()));
    response
}

fn resolve_request_provider_config(
    config: &AppConfig,
    requested_model: &str,
) -> Result<ResolvedProviderConfig, String> {
    if let Some(route) = config
        .model_routes
        .iter()
        .find(|route| route.enabled && route_matches_requested_model(&route.source_model, requested_model))
    {
        let routed_model = resolve_route_target_model(config, route, requested_model);
        let provider = build_provider_config(
            config,
            &route.provider_id,
            &routed_model,
            Some(route.base_url.trim()),
            Some(route.api_key.trim()),
            Some(route.provider_label.trim()),
        )?;
        return Ok(ResolvedProviderConfig {
            resolution_source: "modelRoute",
            route_id: Some(route.id.clone()),
            source_model: Some(route.source_model.clone()),
            ..provider
        });
    }

    let fallback = config.mapping.main.trim();
    let (provider_id, model_name) = if let Some(parts) = fallback.split_once(':') {
        parts
    } else if fallback == "pass" {
        if let Some(inferred) = infer_provider_config_from_enabled_models(config, requested_model)? {
            return Ok(inferred);
        }
        return Err("未命中模型路由，且默认回退映射未配置".to_string());
    } else {
        return Err(format!("未命中模型路由，且默认回退 Provider 配置无效: {fallback}"));
    };

    let mut provider = build_provider_config(config, provider_id, model_name, None, None, None)?;
    provider.resolution_source = "legacyMapping";
    Ok(provider)
}

fn infer_provider_config_from_enabled_models(
    config: &AppConfig,
    requested_model: &str,
) -> Result<Option<ResolvedProviderConfig>, String> {
    let normalized_requested_model = normalize_route_match_model(requested_model);
    if normalized_requested_model.is_empty() {
        return Ok(None);
    }

    let mut matches = Vec::new();

    for provider_id in BUILTIN_PROVIDER_KEYS {
        let provider = match provider_id {
            "anthropic" => &config.providers.anthropic,
            "glm" => &config.providers.glm,
            "kimi" => &config.providers.kimi,
            "minimax" => &config.providers.minimax,
            "deepseek" => &config.providers.deepseek,
            "litellm" => &config.providers.litellm,
            "cliproxyapi" => &config.providers.cliproxyapi,
            _ => continue,
        };

        if provider.enabled
            && provider
                .models
                .iter()
                .any(|model| normalize_route_match_model(model) == normalized_requested_model)
        {
            matches.push((provider_id.to_string(), provider_id.to_string()));
        }
    }

    for provider in &config.providers.custom_providers {
        if provider.provider.enabled
            && provider
                .provider
                .models
                .iter()
                .any(|model| normalize_route_match_model(model) == normalized_requested_model)
        {
            matches.push((provider.id.clone(), provider.name.clone()));
        }
    }

    if matches.is_empty() {
        return Ok(None);
    }

    if matches.len() > 1 {
        let providers = matches
            .iter()
            .map(|(_, label)| label.clone())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "未命中模型路由，且默认回退映射未配置；检测到多个可匹配该模型的 Provider: {providers}"
        ));
    }

    let (provider_id, provider_label) = &matches[0];
    let mut provider = build_provider_config(
        config,
        provider_id,
        requested_model,
        None,
        None,
        Some(provider_label),
    )?;
    provider.resolution_source = "providerInference";
    Ok(Some(provider))
}

fn resolve_route_target_model(config: &AppConfig, route: &crate::types::ModelRoute, requested_model: &str) -> String {
    let explicit_target = route.target_model.trim();
    if !explicit_target.is_empty() {
        return explicit_target.to_string();
    }

    if route.source_model.trim() == "*" {
        if let Some(provider_model) = get_first_provider_model(config, &route.provider_id) {
            return provider_model;
        }
    }

    requested_model.trim().to_string()
}

fn get_first_provider_model(config: &AppConfig, provider_id: &str) -> Option<String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return None;
    }

    if let Some(custom) = config
        .providers
        .custom_providers
        .iter()
        .find(|item| item.id == provider_id)
    {
        return custom
            .provider
            .models
            .iter()
            .map(|model| model.trim())
            .find(|model| !model.is_empty())
            .map(ToOwned::to_owned);
    }

    let provider = match provider_id {
        "anthropic" => &config.providers.anthropic,
        "glm" => &config.providers.glm,
        "kimi" => &config.providers.kimi,
        "minimax" => &config.providers.minimax,
        "deepseek" => &config.providers.deepseek,
        "litellm" => &config.providers.litellm,
        "cliproxyapi" => &config.providers.cliproxyapi,
        _ => return None,
    };

    provider
        .models
        .iter()
        .map(|model| model.trim())
        .find(|model| !model.is_empty())
        .map(ToOwned::to_owned)
}

fn build_provider_config(
    config: &AppConfig,
    provider_id: &str,
    model_name: &str,
    override_base_url: Option<&str>,
    override_api_key: Option<&str>,
    provider_label: Option<&str>,
) -> Result<ResolvedProviderConfig, String> {
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        return Err("providerId 不能为空".into());
    }

    if let Some(custom) = config.providers.custom_providers.iter().find(|item| item.id == provider_id) {
        let base_url = override_base_url
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .or_else(|| custom.provider.base_url.clone())
            .unwrap_or_default();
        return Ok(ResolvedProviderConfig {
            provider_id: provider_id.into(),
            provider_label: provider_label.filter(|value| !value.is_empty()).unwrap_or(&custom.name).to_string(),
            base_url,
            api_key: override_api_key.filter(|value| !value.is_empty()).unwrap_or(&custom.provider.api_key).to_string(),
            model_name: model_name.trim().to_string(),
            resolution_source: "legacyMapping",
            route_id: None,
            source_model: None,
        });
    }

    let provider = match provider_id {
        "anthropic" => &config.providers.anthropic,
        "glm" => &config.providers.glm,
        "kimi" => &config.providers.kimi,
        "minimax" => &config.providers.minimax,
        "deepseek" => &config.providers.deepseek,
        "litellm" => &config.providers.litellm,
        "cliproxyapi" => &config.providers.cliproxyapi,
        _ => return Err(format!("未找到可用的上游配置: {provider_id}")),
    };

    let base_url = override_base_url
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| provider.base_url.clone())
        .unwrap_or_else(|| get_builtin_provider_url(provider_id));

    Ok(ResolvedProviderConfig {
        provider_id: provider_id.into(),
        provider_label: provider_label.filter(|value| !value.is_empty()).unwrap_or(provider_id).to_string(),
        base_url,
        api_key: override_api_key.filter(|value| !value.is_empty()).unwrap_or(&provider.api_key).to_string(),
        model_name: model_name.trim().to_string(),
        resolution_source: "legacyMapping",
        route_id: None,
        source_model: None,
    })
}

fn get_builtin_provider_url(provider_id: &str) -> String {
    match provider_id {
        "anthropic" => "https://api.anthropic.com",
        "glm" => "https://open.bigmodel.cn/api/anthropic",
        "kimi" => "https://api.moonshot.cn/anthropic",
        "minimax" => "https://api.minimaxi.com/anthropic",
        "deepseek" => "https://api.deepseek.com/anthropic",
        _ => "https://api.anthropic.com",
    }
    .to_string()
}

fn normalize_route_match_model(model: &str) -> String {
    let normalized = model.trim().to_lowercase();
    if normalized.starts_with("claude-") {
        normalized.replace('.', "-")
    } else {
        normalized
    }
}

fn extract_token_usage_from_value(value: &serde_json::Value) -> Option<TokenUsagePayload> {
    let usage = if value.get("usage").is_some() {
        value.get("usage")
    } else {
        Some(value)
    }?;

    let input_tokens = usage
        .get("input_tokens")
        .or_else(|| usage.get("prompt_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .or_else(|| usage.get("completion_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(input_tokens + output_tokens);

    if input_tokens == 0 && output_tokens == 0 && total_tokens == 0 {
        return None;
    }

    Some(TokenUsagePayload {
        input_tokens,
        output_tokens,
        total_tokens,
    })
}

fn merge_token_usage(current: &mut Option<TokenUsagePayload>, incoming: Option<TokenUsagePayload>) {
    let Some(incoming_usage) = incoming else {
        return;
    };

    match current {
        Some(existing) => {
            existing.input_tokens = existing.input_tokens.max(incoming_usage.input_tokens);
            existing.output_tokens = existing.output_tokens.max(incoming_usage.output_tokens);
            existing.total_tokens = existing.total_tokens.max(incoming_usage.total_tokens);
        }
        None => *current = Some(incoming_usage),
    }
}

fn parse_sse_usage_frame(frame: &str) -> Option<TokenUsagePayload> {
    let mut data_lines = Vec::new();
    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }

    let data = data_lines.join("\n");
    if data.is_empty() {
        return None;
    }

    let payload = serde_json::from_str::<serde_json::Value>(&data).ok()?;
    extract_token_usage_from_value(&payload)
        .or_else(|| payload.get("message").and_then(extract_token_usage_from_value))
        .or_else(|| payload.get("delta").and_then(extract_token_usage_from_value))
}

fn wildcard_match(pattern: &str, value: &str) -> bool {
    if pattern.is_empty() || value.is_empty() {
        return false;
    }
    if pattern == "*" {
        return true;
    }
    if !pattern.contains('*') {
        return pattern == value;
    }

    let starts_with_wildcard = pattern.starts_with('*');
    let ends_with_wildcard = pattern.ends_with('*');
    let parts = pattern
        .split('*')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return true;
    }

    let mut cursor = 0usize;
    for (index, part) in parts.iter().enumerate() {
        if index == 0 && !starts_with_wildcard {
            if !value[cursor..].starts_with(part) {
                return false;
            }
            cursor += part.len();
            continue;
        }

        let Some(offset) = value[cursor..].find(part) else {
            return false;
        };
        cursor += offset + part.len();
    }

    if !ends_with_wildcard {
        if let Some(last) = parts.last() {
            return value.ends_with(last);
        }
    }

    true
}

fn route_matches_requested_model(route_model: &str, requested_model: &str) -> bool {
    let route_model = route_model.trim();
    let requested_model = requested_model.trim();
    if route_model.is_empty() || requested_model.is_empty() {
        return false;
    }

    if route_model == "*" || route_model == requested_model {
        return true;
    }

    let normalized_route = normalize_route_match_model(route_model);
    let normalized_requested = normalize_route_match_model(requested_model);
    wildcard_match(&normalized_route, &normalized_requested)
}

fn normalize_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        "/".into()
    } else if trimmed.starts_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        format!("/{}", trimmed.trim_end_matches('/'))
    }
}

fn create_request_id(headers: &HeaderMap) -> String {
    headers
        .get("x-request-id")
        .or_else(|| headers.get("x-correlation-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("req_{}", Uuid::new_v4().simple()))
}

fn read_header_value(headers: &HeaderMap, key: &str) -> String {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

fn json_response(status: StatusCode, payload: serde_json::Value) -> Response<Body> {
    let mut response = Response::new(Body::from(payload.to_string()));
    *response.status_mut() = status;
    add_cors_headers(response.headers_mut());
    response
        .headers_mut()
        .insert("content-type", HeaderValue::from_static("application/json"));
    response
}

fn copy_response_headers(target: &mut HeaderMap, source: &reqwest::header::HeaderMap) {
    for (name, value) in source.iter() {
        if matches!(
            name.as_str().to_ascii_lowercase().as_str(),
            "content-length" | "connection" | "transfer-encoding" | "content-encoding"
        ) {
            continue;
        }
        target.insert(name.clone(), value.clone());
    }
}

fn add_cors_headers(headers: &mut HeaderMap) {
    headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    headers.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    headers.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Content-Type, x-api-key, anthropic-version, authorization, x-request-id, x-correlation-id, idempotency-key, openai-organization, openai-project"),
    );
}

fn normalize_base_url_for_docker(base_url: &str) -> String {
    let should_rewrite = std::env::var("REWRITE_LOCALHOST_FOR_DOCKER")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let normalized = base_url.trim().trim_end_matches('/').to_string();
    if !should_rewrite || !is_docker_container() {
        return normalized;
    }

    if normalized.contains("://localhost")
        || normalized.contains("://127.0.0.1")
        || normalized.contains("://[::1]")
    {
        return normalized
            .replace("://localhost", &format!("://{DOCKER_HOST_ALIAS}"))
            .replace("://127.0.0.1", &format!("://{DOCKER_HOST_ALIAS}"))
            .replace("://[::1]", &format!("://{DOCKER_HOST_ALIAS}"));
    }

    normalized
}

fn is_docker_container() -> bool {
    std::env::var("DOCKER_CONTAINER")
        .map(|value| value.eq_ignore_ascii_case("true"))
        .unwrap_or_else(|_| std::path::Path::new("/.dockerenv").exists())
}

fn build_proxy_error_hint(error: &reqwest::Error, original_base_url: &str) -> String {
    let is_local_origin = original_base_url.contains("localhost")
        || original_base_url.contains("127.0.0.1")
        || original_base_url.contains("[::1]");

    if error.is_connect() && is_docker_container() && is_local_origin {
        return format!(
            "容器内检测到 localhost 上游，请改为 http://{DOCKER_HOST_ALIAS}:<port> 或启用对应 host-network 设置。"
        );
    }

    String::new()
}
