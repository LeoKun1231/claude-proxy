# Claude Proxy

一个基于 Electron 的 Claude API 本地代理工具，支持模型映射和多 Provider 配置。

## 功能特性

- 本地 HTTP 代理服务，拦截并转发 Claude API 请求
- 支持模型映射，将 Claude 模型请求转发到其他 API 服务
- 可视化配置界面，支持多个 Provider 管理
- 支持自定义 API 端点和密钥配置
- 一键设置系统环境变量
- 开机自启动选项
- 实时请求日志查看

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

### 3. 配置 Provider

在"Provider 配置"区域添加你的 API 服务：

- 名称：自定义名称
- Base URL：API 端点地址
- API Key：你的密钥
- 模型列表：支持的模型 ID

### 4. 模型映射

在"模型映射"区域选择目标模型，所有 Claude API 请求将被转发到选定的模型。

## 技术栈

- Electron 28
- React 18
- TypeScript
- Ant Design 5
- Vite 5

## 项目结构

```
claude-proxy/
├── electron/          # Electron 主进程和预加载脚本
├── src/              # React 前端源码
│   ├── components/   # UI 组件
│   ├── hooks/        # 自定义 Hooks
│   └── styles/       # 样式文件
├── public/           # 静态资源
└── package.json      # 项目配置
```

## 开发说明

### 编译 Electron 文件

```bash
npx tsc electron/main.ts --outDir dist-electron --module commonjs --target es2020 --esModuleInterop --skipLibCheck
npx tsc electron/preload.ts --outDir dist-electron --module commonjs --target es2020 --esModuleInterop --skipLibCheck
```

### 构建前端

```bash
npx vite build
```

## 许可证

MIT License
