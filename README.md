# Claude Proxy

一个本地 Claude API 代理工具，支持多 Provider、多模型路由、模型级 API/Key 配置，以及基于数据目录的持久化恢复。

## 功能特性

- 本地 HTTP 代理服务，拦截并转发 Claude API 请求
- 支持按请求模型精确命中不同上游路由
- 支持模型级 Base URL、API Key、目标模型配置
- 可视化配置界面，支持多个 Provider 管理和默认回退映射
- 支持自定义 API 端点和密钥配置
- 一键设置系统环境变量
- 开机自启动选项
- 实时请求日志查看
- 支持通过 `DATA_DIR` 持久化配置，容器删除重建后可恢复

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建打包

```bash
# 使用 electron-packager 打包
npm run package

# 使用 electron-builder 打包
npm run build
```

## 使用说明

### 1. 启动代理服务

打开应用后，点击"启动服务"按钮，代理服务将在本地 5055 端口启动。

### 2. 配置客户端

#### Claude CLI

在应用中点击"一键配置代理"按钮，或手动设置环境变量：

```bash
# Windows PowerShell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:5055"

# Linux/Mac
export ANTHROPIC_BASE_URL="http://127.0.0.1:5055"
```

#### Python SDK

```python
import os
os.environ["ANTHROPIC_BASE_URL"] = "http://127.0.0.1:5055"
```

### 3. 配置模型路由

在"模型路由配置"区域为不同的源模型分别配置目标上游：

- 源模型：客户端请求中的 `model`
- 目标 Provider：命中后使用的上游服务
- 目标模型：转发到上游时实际写入的模型名
- Base URL：该模型路由专用网关地址
- API Key：该模型路由专用密钥

代理会优先按源模型精确命中这些路由；未命中时才使用默认回退映射。

### 4. 配置 Provider（共享 / 兼容层）

在"Provider 配置（共享 / 兼容）"区域维护共享 Provider 信息和 legacy fallback 可选目标：

- 名称：自定义名称
- Base URL：API 端点地址
- API Key：你的密钥
- 模型列表：支持的模型 ID

### 5. 默认回退映射

在"模型路由 / 默认回退"区域选择未命中任何模型路由时的默认目标。该设置会同步写入 legacy `main/haiku` 映射。

## Docker 持久化

服务默认把运行时配置写到 `DATA_DIR/config.json`。在 `docker-compose.yml` 中，`DATA_DIR` 被设置为 `/app/data`，并通过卷挂载到宿主机的 `./data`：

```yaml
environment:
  DATA_DIR: "/app/data"
volumes:
  - ./data:/app/data
```

只要这个宿主机目录或命名卷还在，即使 Docker 容器被删除并重新创建，模型路由、Provider 和默认回退配置也会自动恢复。

## 技术栈

- React 18
- TypeScript
- Ant Design 5
- Vite 5
- Express 4

## 项目结构

```
claude-proxy/
├── server/           # Web API、配置持久化、代理转发
├── src/              # React 前端源码
│   ├── components/   # UI 组件
│   ├── hooks/        # 自定义 Hooks
│   ├── services/     # Web 端 electronAPI 兼容层
│   └── styles/       # 样式文件
├── data/             # 默认配置持久化目录
├── public/           # 静态资源
└── package.json      # 项目配置
```

## 开发说明

### 构建前端

```bash
npx vite build
```

## 许可证

MIT License
