# Understand Anything Desktop

将本地代码仓库转成可探索的知识图谱：查看文件、函数、类与依赖关系，结合模型摘要和问答理解项目。

这是基于 [Understand Anything](https://github.com/Egonex-AI/Understand-Anything) 核心解析器与可视化界面构建的独立 Windows 桌面版本，无需 Claude Code 或其他插件宿主。当前打包目标为 **Windows x64**，其他平台尚未验证。

## 功能

- **本地结构解析**：不配置模型也能生成文件、函数、类和可解析的相对导入关系。
- **模型辅助理解**：连接 OpenAI Compatible 服务，生成代码摘要、标签和复杂度信息。
- **图谱探索**：结合搜索、文件树、源码预览、架构层和学习导览浏览项目。
- **项目问答**：根据相关图谱节点摘要回答问题。
- **缓存与导出**：复用已分析文件的摘要，支持取消任务和导出知识图谱 JSON。

## 安装与使用

### 使用安装包

如果本仓库已发布 GitHub Release，请从仓库的 **Releases** 下载 `Understand-Anything-Desktop-<版本>-Setup.exe`，运行后按提示安装。安装包未签名，Windows 可能显示发布者或 SmartScreen 提示。

安装后无需另行安装 Node.js。安装包不包含模型，也不会自动下载模型；需要 AI 功能时，请自行准备可访问的 OpenAI Compatible 服务。没有已发布的安装包时，可按下文从源码运行或自行打包。

### 第一次打开项目

1. 打开应用，选择要分析的项目目录。
2. 不使用模型时，选择“仅解析结构”即可生成图谱。
3. 使用 AI 功能时，打开“模型设置”，填写服务基础地址、模型名称和可选的 API Key。
4. 读取模型列表，选择模型，测试连接并保存。如果服务不支持模型列表，可手动填写模型名称。
5. 选择“模型分析”，完成后探索图谱、查看源码、搜索、使用学习导览，或在右侧提问。

### 模型服务配置

服务可以部署在本机、局域网或远程服务器。地址应填写 **API 基础地址**，例如：

```text
http://127.0.0.1:11434/v1
http://192.168.1.100:8000/v1
https://your-server.example/v1
```

应用会在基础地址后追加以下路径，请勿填写完整的 `/chat/completions` 地址：

| 用途 | 请求 |
| --- | --- |
| 读取模型列表 | `GET <基础地址>/models` |
| 连接测试、代码分析、问答 | `POST <基础地址>/chat/completions` |

支持 HTTP / HTTPS、IPv4 / IPv6 和域名；API Key 按需作为 Bearer 认证发送。聊天使用非流式响应，服务需返回兼容的 `choices[].message.content` 文本。旧版 Ollama / LM Studio 设置会沿用已有地址、模型和密钥。

## 本地数据与隐私

项目扫描、静态解析、图谱查看、搜索、源码预览、缓存和导出在本机完成。应用的模型相关请求发送到用户配置的 API 地址，不跟随重定向；界面使用随应用打包的资源，并限制访问其他网络地址。应用未实现在线更新、模型下载或遥测上报。

**连接远程模型时，分析所需的源文件片段和问答上下文会发送到该服务。** 使用已准备好的本机模型可离线运行。模型服务自身的联网行为不由本应用控制；网络验证的范围见 [验证记录](VALIDATION.md)。

分析结果默认保存在被分析项目的 `.ua/` 中。如果项目已有 `.understand-anything/`，则沿用该目录：

| 文件 | 内容 |
| --- | --- |
| `knowledge-graph.json` | 知识图谱与摘要 |
| `desktop-cache.json` | 按文件内容和分析配置复用的摘要缓存 |
| `desktop-report.json` | 分析完成后的失败、跳过和截断记录 |

缓存每处理 5 个文件保存一次。取消或失败不会覆盖原图谱；重新分析可复用已保存缓存，最近未保存的少量文件需要重跑。修改或删除文件后，重新分析会重建图谱。

应用设置保存在 Electron 的用户数据目录，API Key 通过 Electron `safeStorage` 使用 Windows 加密能力保存，加密不可用时拒绝保存密钥。卸载时不会自动删除应用数据。

图谱、摘要、缓存和导出文件可能包含敏感信息。上传被分析项目时，请检查其 `.gitignore`，按需排除 `.ua/` 和 `.understand-anything/`；本仓库已包含这些规则。

## 从源码开发

### 环境要求

- Windows x64。
- Node.js 22 或更高版本，以及随附的 npm。
- 安装依赖和首次准备打包工具需要网络连接。

在本仓库根目录执行：

```powershell
npm ci
npm run build
npm start
```

`vendor/` 已包含所需的上游源码和 Dart / Swift WASM 语法文件，无需克隆旁边的上游项目，也无需在 `vendor/` 下分别安装依赖。请保留根目录的 `package-lock.json`，以便按锁文件安装依赖。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run build` | 构建分析引擎和图谱界面 |
| `npm start` | 启动应用，需要先完成构建 |
| `npm run dev` | 构建后启动；不包含自动热更新 |
| `npm test` | 运行自动化测试，需要先完成构建 |
| `npx tsc --noEmit` | 检查 TypeScript 类型 |
| `node scripts/smoke.mjs` | 使用模拟模型服务运行桌面冒烟检查，需要先构建，会打开应用窗口 |
| `npm run pack:dir` | 构建 Windows x64 免安装程序目录 |
| `npm run pack:win` | 构建 Windows x64 NSIS 安装包 |
| `node scripts/smoke.mjs --packaged` | 检查 `release/win-unpacked/` 中已打包的程序 |

构建输出分别位于 `dist-desktop/`、`dist-viewer/`；安装包和程序目录位于 `release/`。这些目录均不纳入 Git。

### 目录结构

```text
desktop/                       Electron 主进程、模型调用、分析引擎及桌面 UI
scripts/                       构建与桌面冒烟检查
tests/                         自动化测试
vendor/core/                   上游核心解析与图谱逻辑
vendor/dashboard/              上游图谱可视化界面
vendor/tree-sitter-dart-wasm/   Dart 语法及构建来源说明
vendor/tree-sitter-swift-wasm/  Swift 语法、许可及构建来源说明
vendor/LICENSE                 上游 MIT 许可证
THIRD_PARTY_NOTICES.md          第三方来源与许可说明
VALIDATION.md                  已有验证记录与验证边界
```

## 当前范围与限制

- 默认每文件最多发送前 12,000 个字符给模型，可在设置中调整到 2,000–48,000。超过 1 MiB 的文件及二进制文件跳过。
- 单次扫描最多接受 20,000 个可分析文件；大型仓库可选择子目录分析。
- 扫描会排除常见依赖、构建输出、符号链接、`.env` 和部分密钥文件，并支持项目中的 `.understandignore` 规则。处理敏感项目时仍需自行检查排除范围。
- 导入解析覆盖常见相对路径，不完整解析路径别名、跨语言调用或所有语言的包语义。
- 问答基于最多 40 个相关图谱节点摘要，并非对完整代码的检索；模型摘要和回答可能不准确，应结合源码确认。
- 学习路径和架构层使用上游启发式生成器。
- 当前版本不包含上游插件的全部领域分析、知识库专用分析、Figma、变更影响分析或自动监控功能。

## 常见问题

**模型列表为空或读取失败？** 确认基础地址和服务状态；部分兼容服务没有 `/models` 接口，可以手动填写模型名称后测试。

**连接失败或响应超时？** 检查服务是否已启动、模型是否加载、地址与端口是否可达，以及密钥是否有效。模型较慢时，可尝试较小模型或降低每文件字符上限。

**运行源码时提示缺少 `dist-desktop/engine.mjs` 或图谱界面？** 先在仓库根目录执行 `npm run build`，再启动应用。

**取消后如何继续？** 等待任务结束后重新分析，应用会复用已保存的缓存。更换模型、服务地址、字符上限或分析模式会使旧配置缓存失效。

## 贡献与发布

欢迎通过 Issue 报告问题或通过 Pull Request 提交改进。报告时请附应用版本、操作系统、复现步骤与脱敏后的错误信息；模型兼容问题可补充服务类型和模型名称，请勿提交密钥或私有代码。

发布安装包时，先更新 `package.json` 和 `package-lock.json` 中的版本信息，完成构建、检查与打包，再将 `release/` 中的安装包作为 GitHub Release 附件上传。安装包不应提交到源码仓库。已有验证情况见 [VALIDATION.md](VALIDATION.md)，发布新版本时应更新验证记录。

## 来源与许可

本项目的 `package.json` 声明使用 MIT 许可证。上游 Understand Anything 的核心与界面代码及其原始版权声明保留在 `vendor/`，许可证见 [vendor/LICENSE](vendor/LICENSE)。其他依赖保留各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
