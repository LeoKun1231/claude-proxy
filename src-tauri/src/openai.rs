use std::{collections::HashMap, convert::Infallible, sync::Arc, time::{SystemTime, UNIX_EPOCH}};

use async_stream::stream;
use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::types::TokenUsagePayload;

pub fn is_openai_chat_completions_path(pathname: &str) -> bool {
    matches!(pathname, "/v1/chat/completions" | "/chat/completions")
}

pub fn is_anthropic_compatible_provider(provider_id: &str, base_url: &str) -> bool {
    let normalized_provider = provider_id.to_lowercase();
    if ["anthropic", "glm", "kimi", "minimax", "deepseek"].contains(&normalized_provider.as_str()) {
        return true;
    }
    let normalized_url = base_url.to_lowercase();
    normalized_url.contains("/anthropic") || normalized_url.contains("api.anthropic.com")
}

pub fn convert_openai_chat_request_to_anthropic(body: &Value, forced_model: &str) -> Value {
    let source_messages = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut system_chunks = Vec::new();
    let mut messages = Vec::new();

    for item in source_messages {
        let role = item
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_lowercase();

        if role == "system" {
            let system_text = normalize_openai_text_content(item.get("content"));
            if !system_text.is_empty() {
                system_chunks.push(system_text);
            }
            continue;
        }

        if role != "user" && role != "assistant" {
            continue;
        }

        let mut content_blocks = convert_openai_content_to_anthropic_blocks(item.get("content"));
        let tool_calls = item.get("tool_calls").and_then(Value::as_array).cloned().unwrap_or_default();

        if role == "assistant" && !tool_calls.is_empty() {
            let tool_use_blocks = tool_calls
                .iter()
                .enumerate()
                .filter_map(|(index, tool_call)| {
                    if tool_call.get("type").and_then(Value::as_str) != Some("function") {
                        return None;
                    }
                    let raw_args = tool_call
                        .get("function")
                        .and_then(|value| value.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let parsed_input = if raw_args.is_empty() {
                        json!({})
                    } else {
                        serde_json::from_str::<Value>(&raw_args).unwrap_or_else(|_| json!({ "raw": raw_args }))
                    };

                    Some(json!({
                        "type": "tool_use",
                        "id": tool_call.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("toolu_{}_{}", Uuid::new_v4(), index)),
                        "name": tool_call.get("function").and_then(|value| value.get("name")).and_then(Value::as_str).unwrap_or("tool"),
                        "input": parsed_input
                    }))
                })
                .collect::<Vec<_>>();

            content_blocks.extend(tool_use_blocks);
        }

        messages.push(json!({
            "role": role,
            "content": content_blocks
        }));
    }

    if messages.is_empty() {
        messages.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": "" }]
        }));
    }

    let max_tokens = body
        .get("max_tokens")
        .and_then(number_to_u64)
        .or_else(|| body.get("max_completion_tokens").and_then(number_to_u64))
        .unwrap_or(1024);

    let mut converted = json!({
        "model": if forced_model.is_empty() {
            body.get("model").and_then(Value::as_str).unwrap_or("unknown")
        } else {
            forced_model
        },
        "messages": messages,
        "max_tokens": max_tokens
    });

    if !system_chunks.is_empty() {
        converted["system"] = Value::String(system_chunks.join("\n\n"));
    }
    maybe_copy_number(body, "temperature", &mut converted);
    maybe_copy_number(body, "top_p", &mut converted);
    if let Some(top_k) = body.get("top_k").and_then(number_to_u64) {
        converted["top_k"] = Value::Number(top_k.into());
    }
    if body.get("stream").and_then(Value::as_bool) == Some(true) {
        converted["stream"] = Value::Bool(true);
    }
    if let Some(stop_items) = body.get("stop").and_then(Value::as_array) {
        converted["stop_sequences"] = Value::Array(
            stop_items
                .iter()
                .filter_map(|item| item.as_str().map(|value| Value::String(value.to_string())))
                .collect(),
        );
    } else if let Some(stop_value) = body.get("stop").and_then(Value::as_str) {
        converted["stop_sequences"] = Value::Array(vec![Value::String(stop_value.to_string())]);
    }

    let converted_tools = normalize_openai_tools(body.get("tools"));
    if !converted_tools.is_empty() {
        converted["tools"] = Value::Array(converted_tools);
    }

    if let Some(tool_choice) = body.get("tool_choice") {
        let mapped = map_tool_choice(tool_choice);
        if !mapped.is_null() {
            converted["tool_choice"] = mapped;
        }
    }

    if let Some(metadata) = body.get("metadata").filter(|value| value.is_object()) {
        converted["metadata"] = metadata.clone();
    }

    converted
}

pub fn convert_anthropic_message_to_openai_response(body: &Value, fallback_model: &str) -> Value {
    let text = extract_text_from_anthropic_content(body.get("content"));
    let tool_calls = extract_openai_tool_calls_from_anthropic(body.get("content"));
    let mut assistant_message = json!({
        "role": "assistant",
        "content": if text.is_empty() && !tool_calls.is_empty() {
            Value::Null
        } else {
            Value::String(text)
        }
    });

    if !tool_calls.is_empty() {
        assistant_message["tool_calls"] = Value::Array(tool_calls.clone());
    }

    json!({
        "id": body.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("chatcmpl_{}", Uuid::new_v4().simple())),
        "object": "chat.completion",
        "created": unix_timestamp_now(),
        "model": body.get("model").and_then(Value::as_str).filter(|value| !value.is_empty()).unwrap_or(fallback_model),
        "choices": [{
            "index": 0,
            "message": assistant_message,
            "finish_reason": map_anthropic_stop_reason_to_openai(
                body.get("stop_reason").and_then(Value::as_str),
                !tool_calls.is_empty()
            )
        }],
        "usage": convert_anthropic_usage_to_openai(body.get("usage"))
    })
}

pub fn get_openai_error_payload(status_code: u16, upstream_body: &str) -> Value {
    let parsed = serde_json::from_str::<Value>(upstream_body).ok();
    let upstream_error = parsed.as_ref().and_then(|value| value.get("error"));
    let default_message = format!("Upstream {status_code} error");
    let message = upstream_error
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .or_else(|| parsed.as_ref().and_then(|value| value.get("message")).and_then(Value::as_str))
        .unwrap_or(&default_message);

    json!({
        "error": {
            "message": message,
            "type": upstream_error.and_then(|value| value.get("type")).and_then(Value::as_str).unwrap_or("upstream_error"),
            "code": upstream_error.and_then(|value| value.get("code")).and_then(Value::as_str).unwrap_or("upstream_error")
        }
    })
}

pub fn proxy_anthropic_stream_as_openai<S>(
    upstream: S,
    fallback_model: String,
    on_usage: Option<Arc<dyn Fn(TokenUsagePayload) + Send + Sync>>,
) -> impl Stream<Item = Result<Bytes, Infallible>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    stream! {
        let mut state = OpenAiStreamState::new(fallback_model);
        let mut frame_buffer = String::new();
        let mut upstream = upstream;

        while let Some(item) = upstream.next().await {
            let Ok(chunk) = item else {
                yield Ok(Bytes::from_static(b"data: [DONE]\n\n"));
                return;
            };
            frame_buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(boundary_index) = find_sse_boundary(&frame_buffer) {
                let frame = frame_buffer[..boundary_index].to_string();
                let boundary_len = if frame_buffer[boundary_index..].starts_with("\r\n\r\n") { 4 } else { 2 };
                frame_buffer = frame_buffer[boundary_index + boundary_len..].to_string();
                for payload in process_sse_frame(&frame, &mut state) {
                    yield Ok(Bytes::from(payload));
                }
            }
        }

        if !frame_buffer.trim().is_empty() {
            for payload in process_sse_frame(&frame_buffer, &mut state) {
                yield Ok(Bytes::from(payload));
            }
        }

        if !state.finished {
            yield Ok(Bytes::from(write_openai_stream_chunk(&state, json!({}), Some("stop"))));
            state.finished = true;
        }
        if !state.done {
            yield Ok(Bytes::from_static(b"data: [DONE]\n\n"));
        }
        if let Some(callback) = on_usage.as_ref() {
            if let Some(token_usage) = state.token_usage.clone() {
                callback(token_usage);
            }
        }
    }
}

fn normalize_openai_text_content(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                if let Some(text) = item.as_str() {
                    return Some(text.to_string());
                }
                let kind = item.get("type").and_then(Value::as_str)?;
                if matches!(kind, "text" | "input_text") {
                    return item.get("text").and_then(Value::as_str).map(ToOwned::to_owned);
                }
                None
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Object(map)) => map.get("text").and_then(Value::as_str).map(ToOwned::to_owned).unwrap_or_default(),
        _ => String::new(),
    }
}

fn convert_openai_content_to_anthropic_blocks(content: Option<&Value>) -> Vec<Value> {
    let text = normalize_openai_text_content(content);
    vec![json!({
        "type": "text",
        "text": text
    })]
}

fn normalize_openai_tools(tools: Option<&Value>) -> Vec<Value> {
    tools
        .and_then(Value::as_array)
        .map(|items| {
            items.iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("function"))
                .filter_map(|item| {
                    let function = item.get("function")?;
                    let name = function.get("name").and_then(Value::as_str)?;
                    Some(json!({
                        "name": name,
                        "description": function.get("description").and_then(Value::as_str).unwrap_or_default(),
                        "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({"type":"object","properties":{}}))
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_tool_choice(tool_choice: &Value) -> Value {
    if tool_choice == "required" {
        return json!({ "type": "any" });
    }
    if tool_choice == "auto" {
        return json!({ "type": "auto" });
    }
    if let Some(name) = tool_choice
        .get("function")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
    {
        return json!({ "type": "tool", "name": name });
    }
    Value::Null
}

fn map_anthropic_stop_reason_to_openai(stop_reason: Option<&str>, has_tool_calls: bool) -> &'static str {
    match stop_reason.unwrap_or_default() {
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        _ if has_tool_calls => "tool_calls",
        _ => "stop",
    }
}

fn extract_openai_tool_calls_from_anthropic(content: Option<&Value>) -> Vec<Value> {
    content
        .and_then(Value::as_array)
        .map(|items| {
            items.iter()
                .enumerate()
                .filter_map(|(index, block)| {
                    if block.get("type").and_then(Value::as_str) != Some("tool_use") {
                        return None;
                    }
                    Some(json!({
                        "id": block.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("call_{}_{}", Uuid::new_v4(), index)),
                        "type": "function",
                        "function": {
                            "name": block.get("name").and_then(Value::as_str).unwrap_or("tool"),
                            "arguments": serde_json::to_string(block.get("input").unwrap_or(&json!({}))).unwrap_or_else(|_| "{}".into())
                        }
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extract_text_from_anthropic_content(content: Option<&Value>) -> String {
    content
        .and_then(Value::as_array)
        .map(|items| {
            items.iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn convert_anthropic_usage_to_openai(usage: Option<&Value>) -> Value {
    let prompt_tokens = usage
        .and_then(|value| value.get("input_tokens"))
        .and_then(number_to_u64)
        .unwrap_or(0);
    let completion_tokens = usage
        .and_then(|value| value.get("output_tokens"))
        .and_then(number_to_u64)
        .unwrap_or(0);

    json!({
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens
    })
}

fn maybe_copy_number(body: &Value, key: &str, target: &mut Value) {
    if let Some(number) = body.get(key).and_then(Value::as_f64).and_then(serde_json::Number::from_f64) {
        target[key] = Value::Number(number);
    }
}

fn number_to_u64(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|number| u64::try_from(number).ok()))
        .or_else(|| value.as_f64().map(|number| number.max(0.0) as u64))
}

fn unix_timestamp_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

#[derive(Debug)]
struct OpenAiStreamState {
    id: String,
    model: String,
    created: u64,
    role_sent: bool,
    finished: bool,
    done: bool,
    token_usage: Option<TokenUsagePayload>,
    next_tool_index: usize,
    tool_index_by_block: HashMap<i64, usize>,
}

impl OpenAiStreamState {
    fn new(fallback_model: String) -> Self {
        Self {
            id: format!("chatcmpl_{}", Uuid::new_v4().simple()),
            model: if fallback_model.is_empty() { "unknown".into() } else { fallback_model },
            created: unix_timestamp_now(),
            role_sent: false,
            finished: false,
            done: false,
            token_usage: None,
            next_tool_index: 0,
            tool_index_by_block: HashMap::new(),
        }
    }
}

fn extract_stream_token_usage(payload: &Value) -> Option<TokenUsagePayload> {
    let usage = payload
        .get("usage")
        .or_else(|| payload.get("message").and_then(|value| value.get("usage")))
        .or_else(|| payload.get("delta").and_then(|value| value.get("usage")))?;

    let input_tokens = usage
        .get("input_tokens")
        .and_then(number_to_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("output_tokens")
        .and_then(number_to_u64)
        .unwrap_or(0);
    let total_tokens = input_tokens + output_tokens;

    if total_tokens == 0 {
        return None;
    }

    Some(TokenUsagePayload {
        input_tokens,
        output_tokens,
        total_tokens,
    })
}

fn merge_stream_token_usage(state: &mut OpenAiStreamState, payload: &Value) {
    let Some(incoming) = extract_stream_token_usage(payload) else {
        return;
    };

    match &mut state.token_usage {
        Some(current) => {
            current.input_tokens = current.input_tokens.max(incoming.input_tokens);
            current.output_tokens = current.output_tokens.max(incoming.output_tokens);
            current.total_tokens = current.total_tokens.max(incoming.total_tokens);
        }
        None => state.token_usage = Some(incoming),
    }
}

fn parse_sse_frame(frame: &str) -> (String, String) {
    let mut event_name = "message".to_string();
    let mut data_lines = Vec::new();

    for line in frame.lines() {
        if let Some(rest) = line.strip_prefix("event:") {
            event_name = rest.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.trim_start().to_string());
        }
    }

    (event_name, data_lines.join("\n"))
}

fn process_sse_frame(frame: &str, state: &mut OpenAiStreamState) -> Vec<String> {
    let (event_name, data) = parse_sse_frame(frame);
    if data.is_empty() {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<Value>(&data) else {
        return Vec::new();
    };

    let mut output = Vec::new();
    merge_stream_token_usage(state, &payload);

    if event_name == "message_start" {
        if let Some(message) = payload.get("message") {
            if let Some(id) = message.get("id").and_then(Value::as_str) {
                state.id = id.to_string();
            }
            if let Some(model) = message.get("model").and_then(Value::as_str) {
                state.model = model.to_string();
            }
        }
        ensure_role_chunk(state, &mut output);
        return output;
    }

    if event_name == "content_block_start" {
        let Some(block) = payload.get("content_block") else {
            return output;
        };
        ensure_role_chunk(state, &mut output);

        if block.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(text) = block.get("text").and_then(Value::as_str).filter(|value| !value.is_empty()) {
                output.push(write_openai_stream_chunk(state, json!({ "content": text }), None));
            }
            return output;
        }

        if block.get("type").and_then(Value::as_str) == Some("tool_use") {
            let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
            let tool_call_index = state.next_tool_index;
            state.next_tool_index += 1;
            if block_index >= 0 {
                state.tool_index_by_block.insert(block_index, tool_call_index);
            }
            output.push(write_openai_stream_chunk(
                state,
                json!({
                    "tool_calls": [{
                        "index": tool_call_index,
                        "id": block.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("call_{}_{}", Uuid::new_v4(), tool_call_index)),
                        "type": "function",
                        "function": {
                            "name": block.get("name").and_then(Value::as_str).unwrap_or("tool"),
                            "arguments": ""
                        }
                    }]
                }),
                None,
            ));
        }
        return output;
    }

    if event_name == "content_block_delta" {
        let Some(delta) = payload.get("delta") else {
            return output;
        };
        ensure_role_chunk(state, &mut output);

        if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
            if let Some(text) = delta.get("text").and_then(Value::as_str).filter(|value| !value.is_empty()) {
                output.push(write_openai_stream_chunk(state, json!({ "content": text }), None));
            }
            return output;
        }

        if delta.get("type").and_then(Value::as_str) == Some("input_json_delta") {
            let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
            if let Some(tool_call_index) = state.tool_index_by_block.get(&block_index).copied() {
                if let Some(partial_json) = delta.get("partial_json").and_then(Value::as_str).filter(|value| !value.is_empty()) {
                    output.push(write_openai_stream_chunk(
                        state,
                        json!({
                            "tool_calls": [{
                                "index": tool_call_index,
                                "function": { "arguments": partial_json }
                            }]
                        }),
                        None,
                    ));
                }
            }
        }
        return output;
    }

    if event_name == "message_delta" {
        let finish_reason = map_anthropic_stop_reason_to_openai(
            payload.get("delta").and_then(|value| value.get("stop_reason")).and_then(Value::as_str),
            false,
        );
        if !state.finished {
            output.push(write_openai_stream_chunk(state, json!({}), Some(finish_reason)));
            state.finished = true;
        }
        return output;
    }

    if event_name == "message_stop" {
        if !state.finished {
            output.push(write_openai_stream_chunk(state, json!({}), Some("stop")));
            state.finished = true;
        }
        if !state.done {
            output.push("data: [DONE]\n\n".to_string());
            state.done = true;
        }
    }

    output
}

fn ensure_role_chunk(state: &mut OpenAiStreamState, output: &mut Vec<String>) {
    if state.role_sent {
        return;
    }
    output.push(write_openai_stream_chunk(state, json!({ "role": "assistant" }), None));
    state.role_sent = true;
}

fn write_openai_stream_chunk(state: &OpenAiStreamState, delta: Value, finish_reason: Option<&str>) -> String {
    format!(
        "data: {}\n\n",
        json!({
            "id": state.id,
            "object": "chat.completion.chunk",
            "created": state.created,
            "model": state.model,
            "choices": [{
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason
            }]
        })
    )
}

fn find_sse_boundary(buffer: &str) -> Option<usize> {
    buffer.find("\r\n\r\n").or_else(|| buffer.find("\n\n"))
}
