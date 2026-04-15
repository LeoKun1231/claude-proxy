use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::RwLock,
};

use serde_json::{json, Map, Value};

use crate::types::{
    AppConfig, CustomProviderData, LegacyMapping, ModelRoute, ProviderConfigData, Providers, Settings,
};

const CURRENT_CONFIG_VERSION: u32 = 3;
pub const BUILTIN_PROVIDER_KEYS: [&str; 7] = [
    "anthropic",
    "glm",
    "kimi",
    "minimax",
    "deepseek",
    "litellm",
    "cliproxyapi",
];

pub struct ConfigStore {
    path: PathBuf,
    config: RwLock<AppConfig>,
}

impl ConfigStore {
    pub fn new(base_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&base_dir).map_err(|err| err.to_string())?;
        let path = base_dir.join("config.json");
        let config = read_or_default(&path)?;
        Ok(Self {
            path,
            config: RwLock::new(config),
        })
    }

    pub fn get_config(&self) -> AppConfig {
        self.config
            .read()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }

    pub fn get_value(&self, key: &str) -> Value {
        let value = serde_json::to_value(self.get_config()).unwrap_or_else(|_| json!({}));
        if key.trim().is_empty() {
            return value;
        }
        get_by_path(&value, key).unwrap_or(Value::Null)
    }

    pub fn set_value(&self, key: &str, value: Value) -> Result<AppConfig, String> {
        let current = serde_json::to_value(self.get_config()).map_err(|err| err.to_string())?;
        let mut next = current;
        set_by_path(&mut next, key, value);
        self.replace_from_value(next)
    }

    pub fn replace_from_value(&self, value: Value) -> Result<AppConfig, String> {
        let normalized = normalize_config_value(&value);
        write_config_file(&self.path, &normalized)?;
        if let Ok(mut guard) = self.config.write() {
            *guard = normalized.clone();
        }
        Ok(normalized)
    }
}

pub fn resolve_data_dir(app_data_dir: PathBuf) -> PathBuf {
    std::env::var("DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(app_data_dir)
}

pub fn get_available_targets(config: &AppConfig) -> Vec<String> {
    let mut targets = Vec::from(["pass".to_string()]);

    add_target(&mut targets, &config.mapping.main);
    add_target(&mut targets, &config.mapping.haiku);

    for provider_key in BUILTIN_PROVIDER_KEYS {
        let provider = get_builtin_provider(&config.providers, provider_key);
        if provider.enabled {
            for model in &provider.models {
                add_target(&mut targets, &format!("{provider_key}:{model}"));
            }
        }
    }

    for provider in &config.providers.custom_providers {
        if provider.provider.enabled {
            for model in &provider.provider.models {
                add_target(&mut targets, &format!("{}:{model}", provider.id));
            }
        }
    }

    targets
}

fn default_config() -> AppConfig {
    AppConfig::default()
}

fn read_or_default(path: &Path) -> Result<AppConfig, String> {
    if !path.exists() {
        let default = default_config();
        write_config_file(path, &default)?;
        return Ok(default);
    }

    let raw = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let value = serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| json!({}));
    let normalized = normalize_config_value(&value);
    write_config_file(path, &normalized)?;
    Ok(normalized)
}

fn write_config_file(path: &Path, config: &AppConfig) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(config).map_err(|err| err.to_string())?;
    fs::write(path, raw).map_err(|err| err.to_string())
}

fn normalize_config_value(value: &Value) -> AppConfig {
    let mut merged = serde_json::to_value(default_config()).unwrap_or_else(|_| json!({}));
    deep_merge(&mut merged, value);

    let providers_value = merged.get("providers");
    let mapping_value = merged.get("mapping");
    let model_routes = merged
        .get("modelRoutes")
        .and_then(|value| value.as_array())
        .map(|items| {
            items.iter()
                .enumerate()
                .map(|(index, item)| normalize_model_route(item, index))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let providers = Providers {
        anthropic: normalize_provider_data(providers_value.and_then(|value| value.get("anthropic"))),
        glm: normalize_provider_data(providers_value.and_then(|value| value.get("glm"))),
        kimi: normalize_provider_data(providers_value.and_then(|value| value.get("kimi"))),
        minimax: normalize_provider_data(providers_value.and_then(|value| value.get("minimax"))),
        deepseek: normalize_provider_data(providers_value.and_then(|value| value.get("deepseek"))),
        litellm: normalize_provider_data(providers_value.and_then(|value| value.get("litellm"))),
        cliproxyapi: normalize_provider_data(providers_value.and_then(|value| value.get("cliproxyapi"))),
        custom_providers: providers_value
            .and_then(|value| value.get("customProviders"))
            .and_then(|value| value.as_array())
            .map(|items| {
                items.iter()
                    .enumerate()
                    .map(|(index, item)| normalize_custom_provider(item, index))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
    };

    let mapping = LegacyMapping {
        main: normalize_string(mapping_value.and_then(|value| value.get("main")), "pass"),
        haiku: normalize_string(mapping_value.and_then(|value| value.get("haiku")), "pass"),
    };

    let global_models = collect_global_models(
        merged.get("globalModels"),
        &model_routes,
        &providers,
        &mapping,
    );

    AppConfig {
        config_version: CURRENT_CONFIG_VERSION,
        mapping,
        global_models,
        model_routes,
        providers,
        settings: Settings {
            auto_launch: merged
                .get("settings")
                .and_then(|value| value.get("autoLaunch"))
                .and_then(|value| value.as_bool())
                .unwrap_or(true),
        },
    }
}

fn deep_merge(base: &mut Value, extra: &Value) {
    match extra {
        Value::Object(extra_map) if base.is_object() => {
            let base_map = base.as_object_mut().expect("base object checked");
            for (key, extra_value) in extra_map {
                match base_map.get_mut(key) {
                    Some(base_value) => deep_merge(base_value, extra_value),
                    None => {
                        base_map.insert(key.clone(), extra_value.clone());
                    }
                }
            }
        }
        Value::Array(extra_items) => {
            *base = Value::Array(extra_items.clone());
        }
        other => *base = other.clone(),
    }
}

fn normalize_string(value: Option<&Value>, fallback: &str) -> String {
    value
        .and_then(|item| item.as_str().map(str::trim))
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| fallback.to_string())
}

fn normalize_string_array(value: Option<&Value>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    value
        .and_then(|item| item.as_array())
        .map(|items| {
            items.iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .filter(|item| seen.insert(item.to_string()))
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn normalize_u16(value: Option<&Value>) -> Option<u16> {
    value
        .and_then(|item| {
            item.as_u64()
                .or_else(|| item.as_str().and_then(|v| v.parse::<u64>().ok()))
        })
        .and_then(|value| u16::try_from(value).ok())
        .filter(|value| *value > 0)
}

fn normalize_provider_data(value: Option<&Value>) -> ProviderConfigData {
    ProviderConfigData {
        enabled: value
            .and_then(|item| item.get("enabled"))
            .and_then(|item| item.as_bool())
            .unwrap_or(false),
        api_key: normalize_string(value.and_then(|item| item.get("apiKey")), ""),
        models: normalize_string_array(value.and_then(|item| item.get("models"))),
        base_url: optional_string(value.and_then(|item| item.get("baseUrl"))),
        bin_path: optional_string(value.and_then(|item| item.get("binPath"))),
        port: normalize_u16(value.and_then(|item| item.get("port"))),
        config_path: optional_string(value.and_then(|item| item.get("configPath"))),
    }
}

fn normalize_custom_provider(value: &Value, index: usize) -> CustomProviderData {
    let provider = normalize_provider_data(Some(value));
    CustomProviderData {
        id: normalize_string(value.get("id"), &format!("custom_{}", index + 1)),
        name: normalize_string(value.get("name"), &format!("自定义 {}", index + 1)),
        provider: ProviderConfigData {
            base_url: Some(normalize_string(value.get("baseUrl"), "")),
            ..provider
        },
    }
}

fn normalize_model_route(value: &Value, index: usize) -> ModelRoute {
    ModelRoute {
        id: normalize_string(value.get("id"), &format!("route_{}", index + 1)),
        enabled: value
            .get("enabled")
            .and_then(|item| item.as_bool())
            .unwrap_or(true),
        source_model: normalize_string(value.get("sourceModel"), ""),
        target_model: normalize_string(value.get("targetModel"), ""),
        provider_id: normalize_string(value.get("providerId"), ""),
        provider_label: normalize_string(value.get("providerLabel"), ""),
        base_url: normalize_string(value.get("baseUrl"), ""),
        api_key: normalize_string(value.get("apiKey"), ""),
    }
}

fn optional_string(value: Option<&Value>) -> Option<String> {
    let normalized = normalize_string(value, "");
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn extract_model_from_mapping_target(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed == "pass" {
        return String::new();
    }
    trimmed
        .split_once(':')
        .map(|(_, model)| model.trim().to_string())
        .unwrap_or_default()
}

fn collect_global_models(
    configured_models: Option<&Value>,
    routes: &[ModelRoute],
    providers: &Providers,
    mapping: &LegacyMapping,
) -> Vec<String> {
    let mut collected = BTreeSet::new();

    for model in normalize_string_array(configured_models) {
        collected.insert(model);
    }

    for model in [
        extract_model_from_mapping_target(&mapping.main),
        extract_model_from_mapping_target(&mapping.haiku),
    ] {
        if !model.is_empty() {
            collected.insert(model);
        }
    }

    for route in routes {
        if !route.source_model.is_empty() {
            collected.insert(route.source_model.clone());
        }
        if !route.target_model.is_empty() {
            collected.insert(route.target_model.clone());
        }
    }

    for provider_key in BUILTIN_PROVIDER_KEYS {
        for model in &get_builtin_provider(providers, provider_key).models {
            if !model.is_empty() {
                collected.insert(model.clone());
            }
        }
    }

    for provider in &providers.custom_providers {
        for model in &provider.provider.models {
            if !model.is_empty() {
                collected.insert(model.clone());
            }
        }
    }

    collected.into_iter().collect()
}

fn add_target(targets: &mut Vec<String>, target: &str) {
    let normalized = target.trim();
    if normalized.is_empty() || targets.iter().any(|item| item == normalized) {
        return;
    }
    targets.push(normalized.to_string());
}

fn get_builtin_provider<'a>(providers: &'a Providers, key: &str) -> &'a ProviderConfigData {
    match key {
        "anthropic" => &providers.anthropic,
        "glm" => &providers.glm,
        "kimi" => &providers.kimi,
        "minimax" => &providers.minimax,
        "deepseek" => &providers.deepseek,
        "litellm" => &providers.litellm,
        "cliproxyapi" => &providers.cliproxyapi,
        _ => &providers.anthropic,
    }
}

/// Public accessor for tray menu building
pub fn get_builtin_provider_pub<'a>(providers: &'a Providers, key: &str) -> &'a ProviderConfigData {
    get_builtin_provider(providers, key)
}

fn get_by_path(root: &Value, key: &str) -> Option<Value> {
    let mut current = root;
    for segment in key.split('.') {
        current = current.get(segment)?;
    }
    Some(current.clone())
}

fn set_by_path(root: &mut Value, key: &str, value: Value) {
    let segments = key.split('.').collect::<Vec<_>>();
    if segments.is_empty() {
        return;
    }

    let mut current = root;
    for segment in &segments[..segments.len() - 1] {
        if !current.is_object() {
            *current = Value::Object(Map::new());
        }
        let object = current.as_object_mut().expect("object checked above");
        current = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
    }

    let last = segments.last().expect("non-empty segments");
    if !current.is_object() {
        *current = Value::Object(Map::new());
    }
    if let Some(object) = current.as_object_mut() {
        object.insert((*last).to_string(), value);
    }
}
