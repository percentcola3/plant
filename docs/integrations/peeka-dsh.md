# Peeka / DeepSeek Harness

内置执行引擎使用官方 `@deepseek-ai/dsh-agent-loop` 核心，固定版本 `0.1.5-rc.1`。
上游：https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.5-rc.1
核对日期：2026-09-10。这是候选版本，对应核心包 npm `next`；`latest` 仍为 `0.1.0-rc.6`，升级时不要直接采用 latest。

- V4.1 Flash 官方模型 ID 为 `deepseek-flash`，同时支持文本和图片。官方预设与模型建议已更新；已有自定义配置不覆盖，内网代理保留网关自己的模型 ID。来源：https://api-docs.deepseek.com/quick_start/pricing
- 0.1.5 接口适配：等待异步 `agentLoop.create()` 完成后再注册取消与发送消息；移除已废弃的 `SystemPrompt.persona` 配置，系统提示词仍由 Peeka 的请求适配器提供。

- 官方核心负责当前回合的循环、工具派发、取消和结束；每个回合创建独立 Cordis context，结束后释放。
- Peeka 保留已有加密 Key、会话 JSONL、图片、技能上下文和受限文件工具。历史按原格式恢复，不迁移用户文件；模型请求由 Peeka 的适配器投影，避免历史重复。
- zg 检索以 Claude 兼容 MCP 工具名 `mcp__zvec-grep__zvec_grep_search` 注入 Peeka 工具表，执行仍走本地 zg query（不另起 stdio MCP 子进程）。知识库问题应先 zg 定位候选文件，再 Read 原文件核实；Grep/Glob 只在 zg 未命中或需要精确正则时补充，检索摘要不能当事实。
- 不加载官方 CLI/Web UI、shell 或任意插件。内置文件工具仍强制校验读写目录；第三方模型不会获得额外权限。
- 官方、内网代理共用一个当前连接配置。更换地址必须重新输入对应 Key，防止将原 Key 自动发到新地址。每个回合固定连接与 Key，修改设置从下一条消息生效。
- 支持 Chat Completions、Anthropic Messages、Responses。代理预设地址来自需求截图；Responses 路径为 `/responses`，Messages 为 `/v1/messages`。模型名和视觉模型可编辑。
- 生产依赖随 electron-builder 打包，无额外二进制下载或用户本地 dsh 安装。升级时应保持官方核心包版本一致，更新两份锁文件，并运行 `official-loop.test.ts` 及 Electron Node 模式冒烟测试。

验证：模拟 API 下覆盖官方循环、历史、工具返回、取消；协议测试覆盖图片和工具调用。真实内网代理/账号尚未验证。
