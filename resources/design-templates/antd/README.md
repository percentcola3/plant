# Ant Design 设计资产模板

这份示例展示一套设计资产如何同时保存「使用说明、设计规范、主题样式和官方来源」。这套资产默认填充在 Plant 的「知识库 → UX 资产库」列表中。点击「查看文件」学习写法；点击「关联项目」后，可以「打开」查看主题与组件，对话中用 `@` 选择它。

## 模板目录怎么写

```text
antd-design-template/
├── components/
│   └── antd/             # 一个二级目录对应一个 UI 资产库
│       ├── theme/        # palette.css、theme.css
│       └── button/       # index.html、style.css、README.md
├── assets/               # 团队图片与图标
├── README.md             # 给团队成员看的结构与维护说明
├── AI_USAGE.md           # AI 的入口：阅读次序、优先级、使用边界
├── design-guide.md       # 布局、组件、状态、规范与官方文档
├── team-theme.json       # React 项目的品牌主题
├── team-theme.css        # HTML 原型的视觉 Token 示例
├── SKILL.md              # 可选：单独安装的设计工作流程
└── upstream/             # 官方参考源码及许可证
    ├── seed.ts
    └── LICENSE
```

## 做成自己的模板

1. 在「查看文件」中点击「复制到本地」，得到完整目录；修改副本不会影响内置示例。
2. 先修改 `team-theme.json` 的品牌色、字体与尺寸；HTML 原型同步维护 `team-theme.css`。
3. 在 `design-guide.md` 写清你的表格、表单、布局和状态规则；可以增加 `components/`、`examples/`、`images/` 等目录。
4. 在 `AI_USAGE.md` 指向新增资料，说明团队主题优先于官方默认值，列出需要遵守的规则。
5. 新增组件放在 `components/antd/组件名/`，提供 `index.html` 和相对引用的样式；主题放在 `theme/`，图片放在根目录 `assets/`。
6. 在知识库的「UX 资产库 → 添加 → 本地目录」选择副本，或提交到团队 Git 仓库后添加 Git 资源包。
7. 在项目内关联这套资产，对话中选择它，再生成页面并检查实际效果。

## 最小的 AI_USAGE.md 示例

```markdown
# 团队设计资产使用说明
先读 design-guide.md 和 team-theme.json，再查 components/ 与 examples/。
团队主题优先；表格与表单按规范实现，覆盖空、加载、错误和禁用状态。
React 使用已安装版本的真实组件 API；HTML 原型仅参考视觉 Token。
交付时列出引用资料，将需要发布的样式复制到项目中。
```

添加资源包会提供设计上下文，不会安装 Ant Design 依赖或自动安装 `SKILL.md`。官方 Seed 源码仅供参考，React 主题需通过 `ConfigProvider` 应用。复制和使用官方源码时保留 `upstream/LICENSE`。

`components/` 中的按钮和主题是 Plant 编写的独立 HTML 视觉示例，用于展示资产目录、相对引用与交互状态；真实 React 组件仍需使用官方组件库 API。
