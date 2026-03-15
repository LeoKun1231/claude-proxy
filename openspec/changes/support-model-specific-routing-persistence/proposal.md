## Why

当前代理只支持将全部 Claude 请求映射到单一目标 `provider:model`，无法根据请求中的不同模型分别路由到不同上游，也无法为同一上游下的不同模型配置独立的 base URL 和 API Key。这使得混合接入多个模型供应商、多账号、多网关或按成本分流的场景无法落地。

虽然现有服务已经将配置写入 `data/config.json`，但配置模型仍然围绕 Provider 级别设计，不能满足模型级路由与凭据管理；同时 Docker 场景下也缺少明确的数据持久化契约与迁移方案。需要补齐这套能力，确保容器删除或重建后配置仍可恢复。

## What Changes

- 新增模型级路由配置能力，允许为每个源模型配置独立的目标上游信息，而不是仅使用全局 `mapping.main/haiku`。
- 新增模型级凭据与连接信息配置，支持按模型保存目标 provider、base URL、API Key、上游模型名及启用状态。
- 调整代理转发逻辑，根据入站请求中的模型标识解析并命中对应路由；未命中时按定义好的回退规则处理。
- 调整前端配置界面，支持新增、编辑、删除多条模型路由，并区分“源模型”和“目标模型/凭据”。
- 强化配置持久化，明确配置文件结构、版本迁移和 Docker 数据目录约束，保证容器删除重建后仍可恢复配置。
- 保留现有 Provider 配置和全局映射作为兼容过渡路径，支持旧配置自动迁移或回退读取，避免立即破坏现有使用方式。

## Capabilities

### New Capabilities
- `model-specific-routing`: 支持为不同源模型定义独立的上游路由、目标模型、API Key 和 base URL，并在代理请求时按模型命中。
- `runtime-config-persistence`: 支持运行时配置的稳定持久化、旧配置迁移以及 Docker 数据卷恢复。

### Modified Capabilities

None.

## Impact

- Affected code: `server/config-store.js`, `server/index.js`, `server/proxy-server.js`, `src/components/ProviderConfig.tsx`, `src/components/ModelMapping.tsx`, `src/vite-env.d.ts`, `README.md`, `docker-compose.yml`
- Affected APIs: `/api/config`, `/api/config/all`, `/api/targets`, `/api/mapping/:type`
- Systems: 浏览器配置界面、Node 代理服务、Docker 部署与数据目录
- Dependencies: 无新增外部依赖为前提，优先复用现有 JSON 配置持久化机制
