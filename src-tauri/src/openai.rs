use std::{
    collections::{HashMap, HashSet},
    convert::Infallible,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use async_stream::stream;
use axum::body::Bytes;
use futures_util::{Stream, StreamExt};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::types::TokenUsagePayload;

pub fn is_openai_chat_completions_path(pathname: &str) -> bool {
    matches!(pathname, "/v1/chat/completions" | "/chat/completions")
}

pub fn is_openai_responses_path(pathname: &str) -> bool {
    matches!(pathname, "/v1/responses" | "/responses")
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

        if role == "tool" {
            let tool_use_id = item
                .get("tool_call_id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .unwrap_or("tool_call");
            messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_use_id,
                    "content": normalize_openai_text_content(item.get("content"))
                }]
            }));
            continue;
        }

        if role != "user" && role != "assistant" {
            continue;
        }

        let mut content_blocks = convert_openai_content_to_anthropic_blocks(item.get("content"));
        let tool_calls = item
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

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
                        .unwrap_or_default();
                    let parsed_input = parse_tool_arguments(raw_args);

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

pub fn convert_openai_responses_request_to_anthropic(body: &Value, forced_model: &str) -> Value {
    let mut system_chunks = Vec::new();
    let mut messages = Vec::new();

    for key in ["instructions", "system"] {
        let text = normalize_openai_text_content(body.get(key));
        if !text.is_empty() {
            system_chunks.push(text);
        }
    }

    append_responses_input_as_anthropic(body.get("input"), &mut system_chunks, &mut messages);

    if messages.is_empty() {
        messages.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": "" }]
        }));
    }

    let max_tokens = body
        .get("max_output_tokens")
        .and_then(number_to_u64)
        .or_else(|| body.get("max_completion_tokens").and_then(number_to_u64))
        .or_else(|| body.get("max_tokens").and_then(number_to_u64))
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
    if body.get("stream").and_then(Value::as_bool) == Some(true) {
        converted["stream"] = Value::Bool(true);
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

pub fn convert_anthropic_message_to_openai_responses_response(
    body: &Value,
    fallback_model: &str,
) -> Value {
    let output = extract_openai_responses_output_from_anthropic(body.get("content"));
    let status = if body.get("stop_reason").and_then(Value::as_str) == Some("max_tokens") {
        "incomplete"
    } else {
        "completed"
    };

    json!({
        "id": body.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("resp_{}", Uuid::new_v4().simple())),
        "object": "response",
        "created_at": unix_timestamp_now(),
        "status": status,
        "model": body.get("model").and_then(Value::as_str).filter(|value| !value.is_empty()).unwrap_or(fallback_model),
        "output": if output.is_empty() {
            Value::Array(vec![json!({
                "id": format!("msg_{}", Uuid::new_v4().simple()),
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": "", "annotations": [] }]
            })])
        } else {
            Value::Array(output)
        },
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
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
        })
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
    on_error: Option<Arc<dyn Fn(String) + Send + Sync>>,
) -> impl Stream<Item = Result<Bytes, Infallible>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    stream! {
        let mut state = OpenAiStreamState::new(fallback_model);
        let mut frame_buffer = String::new();
        let mut upstream = upstream;

        while let Some(item) = upstream.next().await {
            let chunk = match item {
                Ok(chunk) => chunk,
                Err(err) => {
                    if let Some(callback) = on_error.as_ref() {
                        callback(err.to_string());
                    }
                    yield Ok(Bytes::from_static(b"data: [DONE]\n\n"));
                    return;
                }
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

pub fn proxy_anthropic_stream_as_openai_responses<S>(
    upstream: S,
    fallback_model: String,
    on_usage: Option<Arc<dyn Fn(TokenUsagePayload) + Send + Sync>>,
    on_error: Option<Arc<dyn Fn(String) + Send + Sync>>,
) -> impl Stream<Item = Result<Bytes, Infallible>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + Unpin + 'static,
{
    stream! {
        let mut state = OpenAiResponsesStreamState::new(fallback_model);
        let mut frame_buffer = String::new();
        let mut upstream = upstream;

        while let Some(item) = upstream.next().await {
            let chunk = match item {
                Ok(chunk) => chunk,
                Err(err) => {
                    if let Some(callback) = on_error.as_ref() {
                        callback(err.to_string());
                    }
                    for payload in finalize_responses_stream(&mut state) {
                        yield Ok(Bytes::from(payload));
                    }
                    return;
                }
            };
            frame_buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(boundary_index) = find_sse_boundary(&frame_buffer) {
                let frame = frame_buffer[..boundary_index].to_string();
                let boundary_len = if frame_buffer[boundary_index..].starts_with("\r\n\r\n") { 4 } else { 2 };
                frame_buffer = frame_buffer[boundary_index + boundary_len..].to_string();
                for payload in process_responses_sse_frame(&frame, &mut state) {
                    yield Ok(Bytes::from(payload));
                }
            }
        }

        if !frame_buffer.trim().is_empty() {
            for payload in process_responses_sse_frame(&frame_buffer, &mut state) {
                yield Ok(Bytes::from(payload));
            }
        }

        for payload in finalize_responses_stream(&mut state) {
            yield Ok(Bytes::from(payload));
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
                if matches!(kind, "text" | "input_text" | "output_text") {
                    return item
                        .get("text")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                }
                None
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Object(map)) => map
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_default(),
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

fn append_responses_input_as_anthropic(
    input: Option<&Value>,
    system_chunks: &mut Vec<String>,
    messages: &mut Vec<Value>,
) {
    match input {
        Some(Value::String(text)) => messages.push(json!({
            "role": "user",
            "content": [{ "type": "text", "text": text }]
        })),
        Some(Value::Array(items)) => {
            for item in items {
                append_responses_input_item_as_anthropic(item, system_chunks, messages);
            }
        }
        Some(Value::Object(_)) => {
            if let Some(item) = input {
                append_responses_input_item_as_anthropic(item, system_chunks, messages);
            }
        }
        _ => {}
    }
}

fn append_responses_input_item_as_anthropic(
    item: &Value,
    system_chunks: &mut Vec<String>,
    messages: &mut Vec<Value>,
) {
    let kind = item.get("type").and_then(Value::as_str).unwrap_or_default();
    if kind == "function_call" {
        let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
        let raw_args = item
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or_default();
        messages.push(json!({
            "role": "assistant",
            "content": [{
                "type": "tool_use",
                "id": from_responses_call_id(item.get("call_id").and_then(Value::as_str).unwrap_or_default()),
                "name": name,
                "input": parse_tool_arguments(raw_args)
            }]
        }));
        return;
    }

    if kind == "function_call_output" {
        messages.push(json!({
            "role": "user",
            "content": [{
                "type": "tool_result",
                "tool_use_id": from_responses_call_id(item.get("call_id").and_then(Value::as_str).unwrap_or_default()),
                "content": item.get("output").and_then(Value::as_str).unwrap_or_default()
            }]
        }));
        return;
    }

    let role = item
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("user")
        .to_lowercase();
    let text = normalize_openai_text_content(item.get("content"));
    if role == "system" {
        if !text.is_empty() {
            system_chunks.push(text);
        }
        return;
    }
    if role != "user" && role != "assistant" {
        return;
    }

    messages.push(json!({
        "role": role,
        "content": convert_openai_content_to_anthropic_blocks(item.get("content"))
    }));
}

fn parse_tool_arguments(raw: &str) -> Value {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        json!({})
    } else {
        serde_json::from_str::<Value>(trimmed).unwrap_or_else(|_| json!({ "raw": trimmed }))
    }
}

fn normalize_openai_tools(tools: Option<&Value>) -> Vec<Value> {
    tools
        .and_then(Value::as_array)
        .map(|items| {
            items.iter()
                .filter(|item| item.get("type").and_then(Value::as_str) == Some("function"))
                .filter_map(|item| {
                    if let Some(function) = item.get("function") {
                        let name = function.get("name").and_then(Value::as_str)?;
                        return Some(json!({
                            "name": name,
                            "description": function.get("description").and_then(Value::as_str).unwrap_or_default(),
                            "input_schema": function.get("parameters").cloned().unwrap_or_else(|| json!({"type":"object","properties":{}}))
                        }));
                    }

                    let name = item.get("name").and_then(Value::as_str)?;
                    Some(json!({
                        "name": name,
                        "description": item.get("description").and_then(Value::as_str).unwrap_or_default(),
                        "input_schema": item.get("parameters").cloned().unwrap_or_else(|| json!({"type":"object","properties":{}}))
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
    if tool_choice == "none" {
        return json!({ "type": "none" });
    }
    if let Some(name) = tool_choice
        .get("function")
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .or_else(|| tool_choice.get("name").and_then(Value::as_str))
    {
        return json!({ "type": "tool", "name": name });
    }
    Value::Null
}

fn map_anthropic_stop_reason_to_openai(
    stop_reason: Option<&str>,
    has_tool_calls: bool,
) -> &'static str {
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
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    Some(json!({
                        "id": block.get("id").and_then(Value::as_str).filter(|value| !value.is_empty()).map(ToOwned::to_owned).unwrap_or_else(|| format!("call_{}_{}", Uuid::new_v4(), index)),
                        "type": "function",
                        "function": {
                            "name": name,
                            "arguments": tool_input_arguments_string(name, block.get("input"))
                        }
                    }))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn extract_openai_responses_output_from_anthropic(content: Option<&Value>) -> Vec<Value> {
    let Some(items) = content.and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut output = Vec::new();
    let text = extract_text_from_anthropic_content(content);
    if !text.is_empty() {
        output.push(json!({
            "id": format!("msg_{}", Uuid::new_v4().simple()),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text, "annotations": [] }]
        }));
    }

    for (index, block) in items.iter().enumerate() {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
        let id = block
            .get("id")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(to_responses_call_id)
            .unwrap_or_else(|| format!("fc_{}_{}", Uuid::new_v4(), index));
        output.push(json!({
            "id": id,
            "type": "function_call",
            "status": "completed",
            "call_id": id,
            "name": name,
            "arguments": tool_input_arguments_string(name, block.get("input"))
        }));
    }

    output
}

fn sanitize_read_tool_input_value(name: &str, input: Value) -> Value {
    if name != "Read" {
        return input;
    }
    let Value::Object(mut map) = input else {
        return input;
    };
    if map.get("pages").and_then(Value::as_str) == Some("") {
        map.remove("pages");
    }
    Value::Object(map)
}

fn tool_input_arguments_string(name: &str, input: Option<&Value>) -> String {
    let input = input.cloned().unwrap_or_else(|| json!({}));
    serde_json::to_string(&sanitize_read_tool_input_value(name, input))
        .unwrap_or_else(|_| "{}".into())
}

fn sanitize_tool_arguments_string(name: &str, raw: &str) -> String {
    let input = parse_tool_arguments(raw);
    serde_json::to_string(&sanitize_read_tool_input_value(name, input))
        .unwrap_or_else(|_| raw.to_string())
}

fn sanitize_complete_read_arguments_string(raw: &str) -> Option<String> {
    let input = serde_json::from_str::<Value>(raw).ok()?;
    let sanitized = sanitize_read_tool_input_value("Read", input.clone());
    if sanitized == input {
        return None;
    }
    serde_json::to_string(&sanitized).ok()
}

pub fn sanitize_anthropic_read_tool_pages(body: &mut Value) -> bool {
    let Some(content) = body.get_mut("content").and_then(Value::as_array_mut) else {
        return false;
    };

    let mut changed = false;
    for block in content {
        if block.get("type").and_then(Value::as_str) != Some("tool_use") {
            continue;
        }
        if block.get("name").and_then(Value::as_str) != Some("Read") {
            continue;
        }
        let Some(input) = block.get_mut("input") else {
            continue;
        };
        if input.get("pages").and_then(Value::as_str) == Some("") {
            if let Some(map) = input.as_object_mut() {
                map.remove("pages");
                changed = true;
            }
        }
    }
    changed
}

fn to_responses_call_id(id: &str) -> String {
    if id.starts_with("fc_") {
        id.to_string()
    } else {
        format!("fc_{id}")
    }
}

fn from_responses_call_id(id: &str) -> String {
    if let Some(rest) = id.strip_prefix("fc_") {
        if rest.starts_with("toolu_") || rest.starts_with("call_") {
            return rest.to_string();
        }
    }
    if id.is_empty() {
        format!("toolu_{}", Uuid::new_v4().simple())
    } else {
        id.to_string()
    }
}

fn extract_text_from_anthropic_content(content: Option<&Value>) -> String {
    content
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
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
    if let Some(number) = body
        .get(key)
        .and_then(Value::as_f64)
        .and_then(serde_json::Number::from_f64)
    {
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
    tool_name_by_block: HashMap<i64, String>,
    tool_args_by_block: HashMap<i64, String>,
}

impl OpenAiStreamState {
    fn new(fallback_model: String) -> Self {
        Self {
            id: format!("chatcmpl_{}", Uuid::new_v4().simple()),
            model: if fallback_model.is_empty() {
                "unknown".into()
            } else {
                fallback_model
            },
            created: unix_timestamp_now(),
            role_sent: false,
            finished: false,
            done: false,
            token_usage: None,
            next_tool_index: 0,
            tool_index_by_block: HashMap::new(),
            tool_name_by_block: HashMap::new(),
            tool_args_by_block: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct ResponsesOutputItemState {
    kind: String,
    name: String,
    call_id: String,
    arguments: String,
    text: String,
    output_index: usize,
}

#[derive(Debug)]
struct OpenAiResponsesStreamState {
    id: String,
    model: String,
    created: u64,
    response_created: bool,
    done: bool,
    token_usage: Option<TokenUsagePayload>,
    next_output_index: usize,
    items_by_block: HashMap<i64, ResponsesOutputItemState>,
}

impl OpenAiResponsesStreamState {
    fn new(fallback_model: String) -> Self {
        Self {
            id: format!("resp_{}", Uuid::new_v4().simple()),
            model: if fallback_model.is_empty() {
                "unknown".into()
            } else {
                fallback_model
            },
            created: unix_timestamp_now(),
            response_created: false,
            done: false,
            token_usage: None,
            next_output_index: 0,
            items_by_block: HashMap::new(),
        }
    }

    fn next_output_index(&mut self) -> usize {
        let index = self.next_output_index;
        self.next_output_index += 1;
        index
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

fn merge_responses_stream_token_usage(state: &mut OpenAiResponsesStreamState, payload: &Value) {
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

#[derive(Debug, Default)]
pub struct AnthropicReadToolSseSanitizerState {
    read_tool_blocks: HashSet<i64>,
}

pub fn sanitize_anthropic_read_tool_sse_frame(
    frame: &str,
    state: &mut AnthropicReadToolSseSanitizerState,
) -> String {
    let (event_name, data) = parse_sse_frame(frame);
    if data.is_empty() {
        return format!("{frame}\n\n");
    }
    let Ok(mut payload) = serde_json::from_str::<Value>(&data) else {
        return format!("{frame}\n\n");
    };

    let index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
    let mut changed = false;

    if event_name == "content_block_start" {
        if let Some(block) = payload.get_mut("content_block") {
            if block.get("type").and_then(Value::as_str) == Some("tool_use")
                && block.get("name").and_then(Value::as_str) == Some("Read")
            {
                state.read_tool_blocks.insert(index);
                if let Some(input) = block.get_mut("input") {
                    if input.get("pages").and_then(Value::as_str) == Some("") {
                        if let Some(map) = input.as_object_mut() {
                            map.remove("pages");
                            changed = true;
                        }
                    }
                }
            }
        }
    } else if event_name == "content_block_delta" {
        if state.read_tool_blocks.contains(&index) {
            if let Some(delta) = payload.get_mut("delta") {
                if delta.get("type").and_then(Value::as_str) == Some("input_json_delta") {
                    if let Some(partial_json) = delta.get("partial_json").and_then(Value::as_str) {
                        if let Some(sanitized) =
                            sanitize_complete_read_arguments_string(partial_json)
                        {
                            delta["partial_json"] = Value::String(sanitized);
                            changed = true;
                        }
                    }
                }
            }
        }
    } else if event_name == "content_block_stop" {
        state.read_tool_blocks.remove(&index);
    }

    if changed {
        format!("event: {event_name}\ndata: {payload}\n\n")
    } else {
        format!("{frame}\n\n")
    }
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
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                output.push(write_openai_stream_chunk(
                    state,
                    json!({ "content": text }),
                    None,
                ));
            }
            return output;
        }

        if block.get("type").and_then(Value::as_str) == Some("tool_use") {
            let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
            let tool_call_index = state.next_tool_index;
            state.next_tool_index += 1;
            if block_index >= 0 {
                state
                    .tool_index_by_block
                    .insert(block_index, tool_call_index);
                state.tool_name_by_block.insert(
                    block_index,
                    block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string(),
                );
                state.tool_args_by_block.insert(block_index, String::new());
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
            if let Some(text) = delta
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                output.push(write_openai_stream_chunk(
                    state,
                    json!({ "content": text }),
                    None,
                ));
            }
            return output;
        }

        if delta.get("type").and_then(Value::as_str) == Some("input_json_delta") {
            let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
            if let Some(tool_call_index) = state.tool_index_by_block.get(&block_index).copied() {
                if let Some(partial_json) = delta
                    .get("partial_json")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    if state
                        .tool_name_by_block
                        .get(&block_index)
                        .map(|name| name == "Read")
                        .unwrap_or(false)
                    {
                        state
                            .tool_args_by_block
                            .entry(block_index)
                            .or_default()
                            .push_str(partial_json);
                    } else {
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
        }
        return output;
    }

    if event_name == "content_block_stop" {
        let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
        flush_read_tool_arguments(state, block_index, &mut output);
        return output;
    }

    if event_name == "message_delta" {
        flush_all_read_tool_arguments(state, &mut output);
        let finish_reason = map_anthropic_stop_reason_to_openai(
            payload
                .get("delta")
                .and_then(|value| value.get("stop_reason"))
                .and_then(Value::as_str),
            state.next_tool_index > 0,
        );
        if !state.finished {
            output.push(write_openai_stream_chunk(
                state,
                json!({}),
                Some(finish_reason),
            ));
            state.finished = true;
        }
        return output;
    }

    if event_name == "message_stop" {
        flush_all_read_tool_arguments(state, &mut output);
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

fn flush_all_read_tool_arguments(state: &mut OpenAiStreamState, output: &mut Vec<String>) {
    let blocks = state.tool_args_by_block.keys().copied().collect::<Vec<_>>();
    for block_index in blocks {
        flush_read_tool_arguments(state, block_index, output);
    }
}

fn flush_read_tool_arguments(
    state: &mut OpenAiStreamState,
    block_index: i64,
    output: &mut Vec<String>,
) {
    if state
        .tool_name_by_block
        .get(&block_index)
        .map(|name| name != "Read")
        .unwrap_or(true)
    {
        return;
    }
    let Some(tool_call_index) = state.tool_index_by_block.get(&block_index).copied() else {
        return;
    };
    let arguments = state
        .tool_args_by_block
        .remove(&block_index)
        .unwrap_or_default();
    let sanitized = sanitize_tool_arguments_string("Read", &arguments);
    if !sanitized.is_empty() {
        output.push(write_openai_stream_chunk(
            state,
            json!({
                "tool_calls": [{
                    "index": tool_call_index,
                    "function": { "arguments": sanitized }
                }]
            }),
            None,
        ));
    }
    state.tool_name_by_block.remove(&block_index);
}

fn process_responses_sse_frame(frame: &str, state: &mut OpenAiResponsesStreamState) -> Vec<String> {
    let (event_name, data) = parse_sse_frame(frame);
    if data.is_empty() {
        return Vec::new();
    }
    let Ok(payload) = serde_json::from_str::<Value>(&data) else {
        return Vec::new();
    };

    merge_responses_stream_token_usage(state, &payload);
    let mut output = Vec::new();

    if event_name == "message_start" {
        if let Some(message) = payload.get("message") {
            if let Some(id) = message
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                state.id = id.to_string();
            }
            if let Some(model) = message
                .get("model")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                state.model = model.to_string();
            }
        }
        ensure_responses_created(state, &mut output);
        return output;
    }

    if event_name == "content_block_start" {
        let Some(block) = payload.get("content_block") else {
            return output;
        };
        ensure_responses_created(state, &mut output);
        let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let output_index = state.next_output_index();

        if block.get("type").and_then(Value::as_str) == Some("text") {
            state.items_by_block.insert(
                block_index,
                ResponsesOutputItemState {
                    kind: "text".into(),
                    name: String::new(),
                    call_id: String::new(),
                    arguments: String::new(),
                    text: block
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    output_index,
                },
            );
            output.push(write_responses_stream_event(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": format!("msg_{}", Uuid::new_v4().simple()),
                        "type": "message",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": []
                    }
                }),
            ));
            output.push(write_responses_stream_event(
                "response.content_part.added",
                json!({
                    "type": "response.content_part.added",
                    "output_index": output_index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": "", "annotations": [] }
                }),
            ));
            if let Some(text) = block
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                output.push(write_responses_stream_event(
                    "response.output_text.delta",
                    json!({
                        "type": "response.output_text.delta",
                        "output_index": output_index,
                        "content_index": 0,
                        "delta": text
                    }),
                ));
            }
            return output;
        }

        if block.get("type").and_then(Value::as_str) == Some("tool_use") {
            let name = block
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool")
                .to_string();
            let call_id = block
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .map(to_responses_call_id)
                .unwrap_or_else(|| format!("fc_{}", Uuid::new_v4().simple()));
            state.items_by_block.insert(
                block_index,
                ResponsesOutputItemState {
                    kind: "tool_use".into(),
                    name: name.clone(),
                    call_id: call_id.clone(),
                    arguments: String::new(),
                    text: String::new(),
                    output_index,
                },
            );
            output.push(write_responses_stream_event(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "id": call_id,
                        "type": "function_call",
                        "status": "in_progress",
                        "call_id": call_id,
                        "name": name,
                        "arguments": ""
                    }
                }),
            ));
            return output;
        }

        return output;
    }

    if event_name == "content_block_delta" {
        ensure_responses_created(state, &mut output);
        let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let Some(item) = state.items_by_block.get_mut(&block_index) else {
            return output;
        };
        let Some(delta) = payload.get("delta") else {
            return output;
        };

        if delta.get("type").and_then(Value::as_str) == Some("text_delta") {
            if let Some(text) = delta
                .get("text")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                item.text.push_str(text);
                output.push(write_responses_stream_event(
                    "response.output_text.delta",
                    json!({
                        "type": "response.output_text.delta",
                        "output_index": item.output_index,
                        "content_index": 0,
                        "delta": text
                    }),
                ));
            }
            return output;
        }

        if delta.get("type").and_then(Value::as_str) == Some("input_json_delta") {
            if let Some(partial_json) = delta
                .get("partial_json")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
            {
                item.arguments.push_str(partial_json);
                if item.name != "Read" {
                    output.push(write_responses_stream_event(
                        "response.function_call_arguments.delta",
                        json!({
                            "type": "response.function_call_arguments.delta",
                            "output_index": item.output_index,
                            "delta": partial_json
                        }),
                    ));
                }
            }
        }
        return output;
    }

    if event_name == "content_block_stop" {
        ensure_responses_created(state, &mut output);
        let block_index = payload.get("index").and_then(Value::as_i64).unwrap_or(-1);
        let Some(item) = state.items_by_block.remove(&block_index) else {
            return output;
        };

        if item.kind == "tool_use" {
            let arguments = sanitize_tool_arguments_string(&item.name, &item.arguments);
            if item.name == "Read" && !arguments.is_empty() {
                output.push(write_responses_stream_event(
                    "response.function_call_arguments.delta",
                    json!({
                        "type": "response.function_call_arguments.delta",
                        "output_index": item.output_index,
                        "delta": arguments
                    }),
                ));
            }
            output.push(write_responses_stream_event(
                "response.function_call_arguments.done",
                json!({
                    "type": "response.function_call_arguments.done",
                    "output_index": item.output_index,
                    "arguments": arguments
                }),
            ));
            output.push(write_responses_stream_event(
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": item.output_index,
                    "item": {
                        "id": item.call_id,
                        "type": "function_call",
                        "status": "completed",
                        "call_id": item.call_id,
                        "name": item.name,
                        "arguments": arguments
                    }
                }),
            ));
        } else if item.kind == "text" {
            let text = item.text;
            output.push(write_responses_stream_event(
                "response.output_text.done",
                json!({
                    "type": "response.output_text.done",
                    "output_index": item.output_index,
                    "content_index": 0,
                    "text": text
                }),
            ));
            output.push(write_responses_stream_event(
                "response.content_part.done",
                json!({
                    "type": "response.content_part.done",
                    "output_index": item.output_index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": text, "annotations": [] }
                }),
            ));
            output.push(write_responses_stream_event(
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": item.output_index,
                    "item": {
                        "id": format!("msg_{}", Uuid::new_v4().simple()),
                        "type": "message",
                        "status": "completed",
                        "role": "assistant",
                        "content": [{ "type": "output_text", "text": text, "annotations": [] }]
                    }
                }),
            ));
        }
        return output;
    }

    if event_name == "message_stop" {
        output.extend(finalize_responses_stream(state));
    }

    output
}

fn ensure_responses_created(state: &mut OpenAiResponsesStreamState, output: &mut Vec<String>) {
    if state.response_created {
        return;
    }
    output.push(write_responses_stream_event(
        "response.created",
        json!({
            "type": "response.created",
            "response": response_stream_payload(state, "in_progress")
        }),
    ));
    state.response_created = true;
}

fn finalize_responses_stream(state: &mut OpenAiResponsesStreamState) -> Vec<String> {
    if state.done {
        return Vec::new();
    }
    let mut output = Vec::new();
    ensure_responses_created(state, &mut output);
    output.push(write_responses_stream_event(
        "response.completed",
        json!({
            "type": "response.completed",
            "response": response_stream_payload(state, "completed")
        }),
    ));
    output.push("data: [DONE]\n\n".to_string());
    state.done = true;
    output
}

fn response_stream_payload(state: &OpenAiResponsesStreamState, status: &str) -> Value {
    json!({
        "id": state.id,
        "object": "response",
        "created_at": state.created,
        "status": status,
        "model": state.model,
        "output": [],
        "usage": state.token_usage.as_ref().map(|usage| json!({
            "input_tokens": usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "total_tokens": usage.total_tokens
        })).unwrap_or(Value::Null)
    })
}

fn write_responses_stream_event(event_type: &str, payload: Value) -> String {
    format!("event: {event_type}\ndata: {payload}\n\n")
}

fn ensure_role_chunk(state: &mut OpenAiStreamState, output: &mut Vec<String>) {
    if state.role_sent {
        return;
    }
    output.push(write_openai_stream_chunk(
        state,
        json!({ "role": "assistant" }),
        None,
    ));
    state.role_sent = true;
}

fn write_openai_stream_chunk(
    state: &OpenAiStreamState,
    delta: Value,
    finish_reason: Option<&str>,
) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    use futures_util::{pin_mut, stream, StreamExt};
    use serde_json::json;

    #[test]
    fn converts_openai_request_to_anthropic_messages() {
        let body = json!({
            "model": "source-model",
            "messages": [
                { "role": "system", "content": "system A" },
                { "role": "system", "content": [{ "type": "text", "text": "system B" }] },
                {
                    "role": "user",
                    "content": [
                        { "type": "text", "text": "hello" },
                        { "type": "input_text", "text": "world" },
                        { "type": "image_url", "image_url": { "url": "https://example.invalid/image.png" } }
                    ]
                },
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "lookup", "arguments": "{\"q\":\"rust\"}" }
                    }]
                },
                { "role": "tool", "tool_call_id": "call_1", "content": "tool says ok" }
            ],
            "max_completion_tokens": 321,
            "temperature": 0.2,
            "top_p": 0.9,
            "top_k": 40,
            "stop": ["done", 7],
            "stream": true,
            "tools": [{
                "type": "function",
                "function": {
                    "name": "lookup",
                    "description": "search",
                    "parameters": { "type": "object", "properties": { "q": { "type": "string" } } }
                }
            }],
            "tool_choice": { "type": "function", "function": { "name": "lookup" } },
            "metadata": { "trace": "abc" }
        });

        let converted = convert_openai_chat_request_to_anthropic(&body, "forced-model");

        assert_eq!(converted["model"], "forced-model");
        assert_eq!(converted["system"], "system A\n\nsystem B");
        assert_eq!(converted["max_tokens"], 321);
        assert_eq!(converted["temperature"], 0.2);
        assert_eq!(converted["top_p"], 0.9);
        assert_eq!(converted["top_k"], 40);
        assert_eq!(converted["stream"], true);
        assert_eq!(converted["stop_sequences"], json!(["done"]));
        assert_eq!(converted["metadata"], json!({ "trace": "abc" }));
        assert_eq!(converted["tools"][0]["name"], "lookup");
        assert_eq!(
            converted["tool_choice"],
            json!({ "type": "tool", "name": "lookup" })
        );
        assert_eq!(converted["messages"][0]["role"], "user");
        assert_eq!(
            converted["messages"][0]["content"][0]["text"],
            "hello\nworld"
        );
        assert_eq!(converted["messages"][1]["content"][1]["type"], "tool_use");
        assert_eq!(
            converted["messages"][1]["content"][1]["input"],
            json!({ "q": "rust" })
        );
        assert_eq!(converted["messages"][2]["role"], "user");
        assert_eq!(
            converted["messages"][2]["content"][0]["type"],
            "tool_result"
        );
        assert_eq!(
            converted["messages"][2]["content"][0]["tool_use_id"],
            "call_1"
        );
        assert_eq!(
            converted["messages"][2]["content"][0]["content"],
            "tool says ok"
        );
    }

    #[test]
    fn converts_anthropic_message_to_openai_response() {
        let body = json!({
            "id": "msg_123",
            "model": "claude-test",
            "stop_reason": "tool_use",
            "content": [
                { "type": "text", "text": "Use tool" },
                { "type": "tool_use", "id": "toolu_1", "name": "lookup", "input": { "q": "rust" } }
            ],
            "usage": { "input_tokens": 10, "output_tokens": 7 }
        });

        let converted = convert_anthropic_message_to_openai_response(&body, "fallback-model");

        assert_eq!(converted["id"], "msg_123");
        assert_eq!(converted["object"], "chat.completion");
        assert_eq!(converted["model"], "claude-test");
        assert_eq!(converted["choices"][0]["message"]["role"], "assistant");
        assert_eq!(converted["choices"][0]["message"]["content"], "Use tool");
        assert_eq!(
            converted["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
            "lookup"
        );
        assert_eq!(
            converted["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
            "{\"q\":\"rust\"}"
        );
        assert_eq!(converted["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(
            converted["usage"],
            json!({
                "prompt_tokens": 10,
                "completion_tokens": 7,
                "total_tokens": 17
            })
        );
    }

    #[test]
    fn drops_empty_read_pages_in_responses_tool_output() {
        let body = json!({
            "id": "msg_read",
            "model": "gpt-5.5",
            "stop_reason": "tool_use",
            "content": [{
                "type": "tool_use",
                "id": "toolu_read",
                "name": "Read",
                "input": { "file_path": "/tmp/demo.py", "limit": 2000, "offset": 0, "pages": "" }
            }]
        });

        let converted =
            convert_anthropic_message_to_openai_responses_response(&body, "fallback-model");
        let args = converted["output"][0]["arguments"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(args).unwrap();

        assert_eq!(
            parsed,
            json!({ "file_path": "/tmp/demo.py", "limit": 2000, "offset": 0 })
        );
    }

    #[test]
    fn preserves_empty_strings_for_non_read_tools() {
        let body = json!({
            "content": [{
                "type": "tool_use",
                "id": "toolu_search",
                "name": "Search",
                "input": { "query": "" }
            }]
        });

        let converted =
            convert_anthropic_message_to_openai_responses_response(&body, "fallback-model");
        let args = converted["output"][0]["arguments"].as_str().unwrap();
        let parsed: Value = serde_json::from_str(args).unwrap();

        assert_eq!(parsed, json!({ "query": "" }));
    }

    #[test]
    fn sanitizes_anthropic_read_tool_json_body() {
        let mut body = json!({
            "content": [{
                "type": "tool_use",
                "name": "Read",
                "input": { "file_path": "/tmp/demo.py", "pages": "" }
            }]
        });

        assert!(sanitize_anthropic_read_tool_pages(&mut body));
        assert_eq!(
            body["content"][0]["input"],
            json!({ "file_path": "/tmp/demo.py" })
        );
    }

    #[test]
    fn sanitizes_anthropic_read_tool_sse_delta() {
        let mut state = AnthropicReadToolSseSanitizerState::default();
        let start = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_read\",\"name\":\"Read\",\"input\":{}}}";
        let delta = "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"file_path\\\":\\\"/tmp/demo.py\\\",\\\"pages\\\":\\\"\\\"}\"}}";

        let _ = sanitize_anthropic_read_tool_sse_frame(start, &mut state);
        let sanitized = sanitize_anthropic_read_tool_sse_frame(delta, &mut state);

        assert!(sanitized.contains("/tmp/demo.py"));
        assert!(!sanitized.contains("\\\"pages\\\":\\\"\\\""));
    }

    #[test]
    fn preserves_partial_read_tool_sse_delta() {
        let mut state = AnthropicReadToolSseSanitizerState::default();
        let start = "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_read\",\"name\":\"Read\",\"input\":{}}}";
        let delta = "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"file_path\\\":\\\"\"}}";

        let _ = sanitize_anthropic_read_tool_sse_frame(start, &mut state);
        let sanitized = sanitize_anthropic_read_tool_sse_frame(delta, &mut state);

        assert_eq!(sanitized, format!("{delta}\n\n"));
    }

    #[test]
    fn converts_upstream_error_payload_to_openai_error() {
        let payload = get_openai_error_payload(
            401,
            r#"{"error":{"message":"bad key","type":"authentication_error","code":"invalid_api_key"}}"#,
        );
        assert_eq!(payload["error"]["message"], "bad key");
        assert_eq!(payload["error"]["type"], "authentication_error");
        assert_eq!(payload["error"]["code"], "invalid_api_key");

        let fallback = get_openai_error_payload(502, "not json");
        assert_eq!(fallback["error"]["message"], "Upstream 502 error");
        assert_eq!(fallback["error"]["type"], "upstream_error");
    }

    #[tokio::test]
    async fn converts_anthropic_sse_to_openai_chunks_and_reports_usage() {
        let usage = Arc::new(Mutex::new(None));
        let usage_for_callback = usage.clone();
        let input = concat!(
            "event: message_start\n",
            "data: {\"message\":{\"id\":\"msg_1\",\"model\":\"claude-test\",\"usage\":{\"input_tokens\":3,\"output_tokens\":0}}}\n\n",
            "event: content_block_start\n",
            "data: {\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"Hi\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\" there\"}}\n\n",
            "event: message_delta\n",
            "data: {\"delta\":{\"stop_reason\":\"max_tokens\",\"usage\":{\"input_tokens\":3,\"output_tokens\":5}}}\n\n",
            "event: message_stop\n",
            "data: {}\n\n"
        );
        let upstream = stream::iter(vec![Ok::<Bytes, reqwest::Error>(Bytes::from(input))]);
        let output_stream = proxy_anthropic_stream_as_openai(
            upstream,
            "fallback-model".to_string(),
            Some(Arc::new(move |token_usage: TokenUsagePayload| {
                *usage_for_callback.lock().unwrap() = Some(token_usage);
            })),
            None,
        );
        pin_mut!(output_stream);

        let mut output = String::new();
        while let Some(item) = output_stream.next().await {
            output.push_str(&String::from_utf8_lossy(&item.unwrap()));
        }

        assert!(output.contains("\"role\":\"assistant\""));
        assert!(output.contains("\"content\":\"Hi\""));
        assert!(output.contains("\"content\":\" there\""));
        assert!(output.contains("\"finish_reason\":\"length\""));
        assert!(output.contains("data: [DONE]"));

        let token_usage = usage.lock().unwrap().clone().unwrap();
        assert_eq!(token_usage.input_tokens, 3);
        assert_eq!(token_usage.output_tokens, 5);
        assert_eq!(token_usage.total_tokens, 8);
    }

    #[tokio::test]
    async fn converts_stream_tool_use_finish_reason() {
        let input = concat!(
            "event: content_block_start\n",
            "data: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"lookup\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"q\\\":\\\"rust\\\"}\"}}\n\n",
            "event: message_delta\n",
            "data: {\"delta\":{\"stop_reason\":\"tool_use\"}}\n\n",
            "event: message_stop\n",
            "data: {}\n\n"
        );
        let upstream = stream::iter(vec![Ok::<Bytes, reqwest::Error>(Bytes::from(input))]);
        let output_stream =
            proxy_anthropic_stream_as_openai(upstream, "fallback-model".to_string(), None, None);
        pin_mut!(output_stream);

        let mut output = String::new();
        while let Some(item) = output_stream.next().await {
            output.push_str(&String::from_utf8_lossy(&item.unwrap()));
        }

        assert!(output.contains("\"tool_calls\""));
        assert!(output.contains("\"finish_reason\":\"tool_calls\""));
    }

    #[tokio::test]
    async fn strips_empty_read_pages_in_chat_stream_tool_arguments() {
        let input = concat!(
            "event: content_block_start\n",
            "data: {\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_read\",\"name\":\"Read\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"file_path\\\":\\\"/tmp/demo.py\\\",\\\"pages\\\":\\\"\\\"}\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"index\":0}\n\n",
            "event: message_delta\n",
            "data: {\"delta\":{\"stop_reason\":\"tool_use\"}}\n\n",
            "event: message_stop\n",
            "data: {}\n\n"
        );
        let upstream = stream::iter(vec![Ok::<Bytes, reqwest::Error>(Bytes::from(input))]);
        let output_stream =
            proxy_anthropic_stream_as_openai(upstream, "fallback-model".to_string(), None, None);
        pin_mut!(output_stream);

        let mut output = String::new();
        while let Some(item) = output_stream.next().await {
            output.push_str(&String::from_utf8_lossy(&item.unwrap()));
        }

        assert!(output.contains("/tmp/demo.py"));
        assert!(!output.contains("\\\"pages\\\":\\\"\\\""));
    }
}
