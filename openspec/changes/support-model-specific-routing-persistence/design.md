## Context

当前系统使用 `server/config-store.js` 将配置持久化到 `DATA_DIR/config.json`，并在 `server/proxy-server.js` 中通过全局 `mapping.main` 解析唯一目标 `provider:model`。可选目标列表由 `providers.*.models` 与 `providers.customProviders[*].models` 组合得出，因此路由粒度被固定在“全局映射到某个 Provider 下的某个模型”。

这套结构无法表达以下场景：

- 同一个上游供应商下，不同模型使用不同 API Key 或不同网关地址
- 同一个源模型根据业务需要切换到不同上游目标模型
- 运行时维护多条模型路由，而不是仅维护 `main/haiku` 两个全局入口

Docker 部署已经通过 `./data:/app/data` 绑定了数据目录，但当前配置文件没有版本号和迁移策略。要引入模型级路由，必须同时定义新的配置结构、兼容旧结构并约束持久化位置，否则升级后容易出现配置丢失或无法恢复。

## Goals / Non-Goals

**Goals:**

- 引入模型级路由配置，使代理能够按入站请求中的模型名命中独立路由
- 允许每条路由保存自己的上游 provider、base URL、API Key、目标模型和启用状态
- 保持现有 Provider 配置和全局映射可继续工作，并提供向新结构的兼容读取或迁移
- 继续使用当前基于文件的持久化方案，但增强为可迁移、可恢复、适配 Docker 卷挂载的配置机制

**Non-Goals:**

- 不实现加密存储、KMS 或密钥托管；API Key 仍按当前模式以明文保存在本地配置文件中
- 不实现按权重、按租户、按健康检查的动态路由策略
- 不改变现有代理协议转换能力（Anthropic/OpenAI 兼容转换仍沿用现有实现）

## Decisions

### Decision: 新增独立的 `modelRoutes` 配置集合，而不是继续扩展 Provider 级模型列表

配置中新增版本化字段，例如：

- `configVersion`
- `modelRoutes: ModelRoute[]`

每条 `ModelRoute` 至少包含：

- `id`
- `enabled`
- `sourceModel`
- `targetModel`
- `providerId`
- `providerLabel`
- `baseUrl`
- `apiKey`

其中 `providerId` 用于复用现有内置 provider 类型和显示逻辑，`providerLabel/baseUrl/apiKey` 允许该路由脱离共享 Provider 配置单独保存。

Rationale:

- 模型级配置是这次改动的核心，继续把 `apiKey/baseUrl` 塞进 `providers.*.models` 会导致模型列表承担过多职责，结构难以维护
- 独立路由数组更适合前端做表格式增删改，也更容易在代理层做“按模型精确命中”

Alternatives considered:

- 扩展 `providers.*.models` 为对象数组：会让内置 provider 与自定义 provider 的结构更加分裂，且不利于兼容当前 `targets` 生成逻辑
- 完全删除旧 `providers/mapping`：升级风险高，会立即破坏现有用户配置

### Decision: 代理优先按 `modelRoutes` 命中，未命中时回退到旧映射

代理在读取请求体后解析入站 `model` 字段。若存在启用状态的 `modelRoutes` 精确匹配 `sourceModel`，则使用该路由的 `baseUrl/apiKey/targetModel` 进行转发；若未命中，则回退到旧的 `mapping.main/haiku` 逻辑。若两者都不可用，则返回 400 并记录可诊断日志。

Rationale:

- 允许新旧配置共存，避免一次性迁移失败导致代理不可用
- 可以先上线新能力，再逐步把老用户迁移到模型路由

Alternatives considered:

- 启用新能力后完全禁用旧映射：迁移窗口过于激进
- 沿用 `main/haiku` 推断路由：无法满足“多个模型分别路由”的目标

### Decision: 持久化继续使用 `DATA_DIR/config.json`，但写入改为版本化 + 原子落盘

配置仍保存在 `DATA_DIR/config.json`，这是当前 Web 服务和 Docker 部署已经使用的路径。为降低升级风险：

- `readConfig()` 在读取旧结构时生成内存态兼容对象
- `writeConfig()` 按新结构回写，并采用临时文件 + rename 的原子写入方式
- 仅依赖 `DATA_DIR`，不把配置写入镜像内部其他临时路径

Rationale:

- 复用现有部署方式，避免额外引入数据库或 Electron 专属存储
- 原子写入可以减少容器异常退出或并发保存时的损坏风险

Alternatives considered:

- 引入 SQLite / LowDB：增加依赖和迁移成本，不符合当前仓库的轻量定位
- 改用纯前端本地存储：Docker 重建后无法保留

### Decision: 前端新增“模型路由”编辑视图，Provider 配置保留为兼容层

前端保持现有 Provider 配置区域，但新增单独的模型路由编辑区域，用于维护：

- 源模型
- 目标 provider
- 目标模型
- base URL
- API Key
- 启用/禁用

现有 `ModelMapping` 从“单一下拉映射”调整为“路由总览/默认回退说明”，避免用户继续误以为系统只能选择一个目标。

Rationale:

- 用户需求已经变成“按模型分别配置”，继续强化单下拉只会制造歧义
- 保留 Provider 配置可减少对现有界面的破坏，并为兼容迁移提供读取入口

Alternatives considered:

- 直接复用 `ProviderConfig` 承载所有模型路由：字段语义混杂，用户很难理解“共享 Provider”和“单模型路由”之间的关系

## Risks / Trade-offs

- [旧配置与新配置并存，逻辑复杂度上升] → 通过明确的优先级（`modelRoutes` 优先，legacy fallback 次之）和配置版本字段限制分支蔓延
- [模型名精确匹配可能导致未命中] → UI 提示源模型需与请求 `model` 完全一致；代理日志记录未命中的模型名
- [API Key 仍是明文持久化] → 本次保持与现状一致，在文档中提示 `data/` 目录权限与备份策略；加密存储留作后续增强
- [未挂载数据卷时无法跨容器保留] → 在文档和 compose 示例中明确“跨容器恢复”的前提是 `DATA_DIR` 映射到宿主机或命名卷

## Migration Plan

1. 为配置文件引入版本号与 `modelRoutes` 字段，读取时兼容旧格式。
2. 前端发布后允许用户手动录入模型路由；旧 Provider 配置继续可见且可工作。
3. 代理层上线模型优先命中逻辑，并在日志中区分“route hit / legacy fallback / no route”。
4. 更新 Docker 与 README 文档，明确 `DATA_DIR` 的持久化要求。
5. 若发布后出现问题，可临时禁用 `modelRoutes` 读取，仅保留 legacy fallback，旧配置不需要回滚文件格式即可继续工作。

## Open Questions

None.
