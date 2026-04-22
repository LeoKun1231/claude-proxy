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
    #[serde(default)]
    pub strip_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderData {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub custom_headers: Vec<CustomHeader>,
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

// 路由分类目标：按请求特征分派到不同 provider / model
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RouterTarget {
    pub enabled: bool,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub provider_label: String,
    #[serde(default)]
    pub target_model: String,
}

pub const DEFAULT_LONG_CONTEXT_THRESHOLD: u32 = 60_000;
pub const DEFAULT_PROXY_PORT: u16 = 5055;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterConfig {
    #[serde(default)]
    pub default: RouterTarget,
    #[serde(default)]
    pub background: RouterTarget,
    #[serde(default)]
    pub think: RouterTarget,
    #[serde(default)]
    pub long_context: RouterTarget,
    #[serde(default = "default_long_context_threshold")]
    pub long_context_threshold: u32,
    #[serde(default)]
    pub web_search: RouterTarget,
    #[serde(default)]
    pub image: RouterTarget,
}

fn default_long_context_threshold() -> u32 {
    DEFAULT_LONG_CONTEXT_THRESHOLD
}

fn default_proxy_port() -> u16 {
    DEFAULT_PROXY_PORT
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            default: RouterTarget::default(),
            background: RouterTarget::default(),
            think: RouterTarget::default(),
            long_context: RouterTarget::default(),
            long_context_threshold: DEFAULT_LONG_CONTEXT_THRESHOLD,
            web_search: RouterTarget::default(),
            image: RouterTarget::default(),
        }
    }
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
    #[serde(default = "default_proxy_port")]
    pub proxy_port: u16,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_launch: true,
            proxy_port: DEFAULT_PROXY_PORT,
        }
    }
}

// 路由模式：gateway = 仅使用 modelRoutes（活跃网关）；routes = 仅使用 router 分类（路由规则）
pub const ROUTING_MODE_GATEWAY: &str = "gateway";
pub const ROUTING_MODE_ROUTES: &str = "routes";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub config_version: u32,
    pub mapping: LegacyMapping,
    #[serde(default)]
    pub router: RouterConfig,
    #[serde(default = "default_routing_mode")]
    pub routing_mode: String,
    #[serde(default)]
    pub global_models: Vec<String>,
    #[serde(default)]
    pub model_routes: Vec<ModelRoute>,
    pub providers: Providers,
    pub settings: Settings,
}

fn default_routing_mode() -> String {
    ROUTING_MODE_GATEWAY.to_string()
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            config_version: 5,
            mapping: LegacyMapping::default(),
            router: RouterConfig::default(),
            routing_mode: default_routing_mode(),
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
    pub route_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_usage: Option<TokenUsagePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigUpdatedPayload {
    pub key: String,
    pub updated_at: i64,
}
