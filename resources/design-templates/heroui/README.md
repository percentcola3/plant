# HeroUI 设计资产模板

这份示例展示一套设计资产如何同时保存「使用说明、设计规范、主题样式和官方来源」。这套资产默认填充在 Plant 的「知识库 → UX 资产库」列表中。点击「查看文件」学习写法；点击「关联项目」后，可以「打开」查看主题与组件，对话中用 `@` 选择它。

## 模板目录怎么写

```text
heroui-design-template/
├── components/
│   └── heroui/             # 一个二级目录对应一个 UI 资产库
│       ├── theme/        # palette.css、theme.css、theme-dark.css
│       └── button/       # index.html、style.css、README.md
├── assets/               # 团队图片与图标
├── README.md             # 给团队成员看的结构与维护说明
├── AI_USAGE.md           # AI 的入口：阅读次序、优先级、使用边界
├── design-guide.md       # 组件规则、主题机制与官方文档
├── team-theme.css        # 团队品牌色及亮暗主题覆盖
├── SKILL.md              # 可选：单独安装的设计工作流程
└── upstream/             # 官方参考样式及许可证
    ├── variables.css
    ├── button.css
    └── LICENSE
```

## 做成自己的模板

1. 在「查看文件」中点击「复制到本地」，得到完整目录；修改副本不会影响内置示例。
2. 修改 `team-theme.css` 的品牌变量，同时维护亮色、暗色主题；主题覆盖在官方样式之后导入。
3. 在 `design-guide.md` 写清你的间距、字号、组件变体和交互状态；可以增加 `components/`、`examples/`、`images/` 等目录。
4. 在 `AI_USAGE.md` 指向新增资料，写清资料阅读顺序和团队规范优先级。
5. 新增组件放在 `components/heroui/组件名/`，提供 `index.html` 和相对引用的样式；主题放在 `theme/`，图片放在根目录 `assets/`。
6. 在知识库的「UX 资产库 → 添加 → 本地目录」选择副本，或提交到团队 Git 仓库后添加 Git 资源包。
7. 在项目内关联这套资产，对话中选择它，再生成页面并检查实际效果。

## 最小的 AI_USAGE.md 示例

```markdown
# 团队设计资产使用说明
先读 design-guide.md 和 team-theme.css，再查 components/ 与 examples/。
团队主题优先；统一组件变体、圆角和间距，覆盖亮暗主题及必要状态。
React 使用已安装版本的 HeroUI v3 API；HTML 原型仅参考视觉 Token。
交付时列出引用资料，将需要发布的样式复制到项目中。
```

添加资源包会提供设计上下文，不会安装 HeroUI 依赖或自动安装 `SKILL.md`。官方组件 CSS 包含 `@apply`，需要完整 Tailwind v4 / `@heroui/styles` 构建环境。复制和使用官方源码时保留 `upstream/LICENSE`。

`components/` 中的按钮和主题是 Plant 编写的独立 HTML 视觉示例，用于展示资产目录、相对引用与交互状态；真实 React 组件仍需使用官方组件库 API。
