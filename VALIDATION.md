# 验证记录

日期：2026-11-01，Windows x64，版本 0.1.1。

已完成：

- TypeScript 检查：`npx tsc --noEmit`。
- 生产构建：`npm run build`。
- 自动化测试：`npm test`，3 组测试全部通过。覆盖 HTTP / HTTPS、IPv4 / IPv6 与域名地址、旧服务设置迁移、禁止重定向、模型列表、分析摘要、内容缓存、取消保护、删除文件后的图谱更新、源码读取权限及无模型的 Python 静态解析。
- Windows NSIS 安装包生成成功。
- 打包后的实际程序：`node scripts/smoke.mjs --packaged`。通过非回环 IP 连接模拟的 OpenAI Compatible 服务，操作窗口完成设置、模型列表读取、连接测试、项目选择、静态解析、模型分析、问答、文件树和源码查看。4 个图谱节点；4 次模型调用；界面运行异常 0 次。
- 模型测试流程中，界面未请求外部资源；主进程所有 fetch 均指向所配置的 `/models` 或 `/chat/completions`。额外主动尝试访问无关网络地址，被界面策略阻止。未使用操作系统级抓包验证 Electron / Windows 的全部底层网络流量。
- 界面截图：`release/preview-home.png`、`release/preview-project.png` 和 `release/preview-settings.png`，截图使用临时测试项目及模拟服务。

验证边界：

- 模型调用使用通过 IP 访问的模拟兼容服务，尚未验证真实推理后端的模型质量、上下文限制和耗时。
- 未自动执行安装、卸载流程；已直接启动并验证打包目录中的最终可执行程序。
- 安装包未签名。校验和见 `release/SHA256SUMS.txt`。

第一版的功能范围和限制见 README.md。
