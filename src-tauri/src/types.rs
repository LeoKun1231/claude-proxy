use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigData {
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub bin_path: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub config_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderData {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub provider: ProviderConfigData,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    pub id: String,
    pub enabled: bool,
    pub source_model: String,
    pub target_model: String,
    pub provider_id: String,
    pub provider_label: String,
    pub base_url: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyMapping {
    pub main: String,
    pub haiku: String,
}

impl Default for LegacyMapping {
    fn default() -> Self {
        Self {
            main: "pass".into(),
            haiku: "pass".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Providers {
    pub anthropic: ProviderConfigData,
    pub glm: ProviderConfigData,
    pub kimi: ProviderConfigData,
    pub minimax: ProviderConfigData,
    pub deepseek: ProviderConfigData,
    pub litellm: ProviderConfigData,
    pub cliproxyapi: ProviderConfigData,
    #[serde(default)]
    pub custom_providers: Vec<CustomProviderData>,
}

impl Default for Providers {
    fn default() -> Self {
        Self {
            anthropic: ProviderConfigData::default(),
            glm: ProviderConfigData::default(),
            kimi: ProviderConfigData::default(),
            minimax: ProviderConfigData::default(),
            deepseek: ProviderConfigData::default(),
            litellm: ProviderConfigData::default(),
            cliproxyapi: ProviderConfigData::default(),
            custom_providers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub auto_launch: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { auto_launch: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub config_version: u32,
    pub mapping: LegacyMapping,
    #[serde(default)]
    pub global_models: Vec<String>,
    #[serde(default)]
    pub model_routes: Vec<ModelRoute>,
    pub providers: Providers,
    pub settings: Settings,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            config_version: 3,
            mapping: LegacyMapping::default(),
            global_models: Vec::new(),
            model_routes: Vec::new(),
            providers: Providers::default(),
            settings: Settings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyCommandResult {
    pub success: bool,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub already_running: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatusPayload {
    pub running: bool,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsagePayload {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageRecord {
    pub request_id: String,
    pub provider_id: String,
    pub provider_label: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    pub timestamp: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyLogPayload {
    pub message: String,
    pub r#type: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsagePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdatedPayload {
    pub key: String,
    pub updated_at: i64,
}
