# Flower

一个面向 UI 设计师与产品经理的 macOS 桌面工作台（Electron + Vue 3），围绕 git 组织协作产物：

- **项目与需求**：导入本地或 git 仓库，需求即分支，产物统一在一个分支上沉淀
- **知识库 / UI 资产**：支持 git 知识库（只读）与本地知识库，跨需求共享
- **产物编辑与预览**：Markdown 文档、UI 产物（HTML 页面）的编辑、预览与发布
- **AI 助手**：内置 DeepSeek harness（官方 dsh-agent 回路）与 Claude Code / 自定义 CLI 接入，可在项目上下文中对话、执行任务
- **项目浏览器**：内置多标签网页浏览，可抓取网页转 markdown 剪页

## 技术栈

Electron · Vue 3 · Pinia · TypeScript · Tailwind CSS · CodeMirror · xterm · node-pty · dugite (git)

## 开发

```bash
npm install          # 安装依赖（postinstall 会为 node-pty 做 electron-rebuild）
npm run dev          # 启动开发
npm test             # 运行测试 (vitest)
npm run typecheck    # 类型检查
npm run pack:dir     # 本地打包（不签名）
```

## License

MIT
