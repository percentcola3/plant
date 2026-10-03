# UX 设计模板：让规则和样式一起成为上下文

Ant Design 和 HeroUI 作为默认 UI 资产直接填充在「知识库 → UX 资产库」列表中，随 v0.2.13 安装包一起提供。模板提供设计参考与使用流程，不是已安装的组件库，也不是 Plant UI 的主题。

应用首次读取资源池时，会将两套完整目录复制到应用数据目录并添加为 UX 资产；已有资源不会重复添加。它们与用户添加的资产使用同一列表，点击「查看文件」学习目录结构和写法，点击「关联项目」后可「打开」主题与组件预览，并在对话中用 `@` 选择。资产池里主动删除的条目不会在刷新或重启后自动添加。

在「查看文件」中点击「复制到本地」，将完整目录保存到自己的目录，修改主题、规范或增加示例后，通过「UX 资产库 → 添加 → 本地目录」接入；也可提交到团队 Git 仓库再连接。复制操作不会覆盖同名目录。按需单独安装 `SKILL.md`。

每个模板遵循 Plant 的 UI 资产库目录约定，并包含：

- `components/<资产库>/theme/`：`palette.css` 色板、`theme.css` 默认主题，HeroUI 另含暗色变体。
- `components/<资产库>/button/`：可直接预览的 HTML、CSS 和说明，用于展示组件写法；是 Plant 编写的视觉参考。
- `assets/`：放置团队图片与图标。

- `README.md`：模板结构、定制步骤和最小使用说明示例。
- `AI_USAGE.md`：资源入口、使用次序与边界，供 Plant 读取。
- `SKILL.md`：可安装的设计工作流程。
- `design-guide.md`：主题机制、组件规则和官方规范入口。
- `team-theme.*`：Plant 编写的团队定制示例，可在 Git 中修改、评审。
- `upstream/`：原样保留的官方 Token / CSS 源码及对应许可证（Ant Design：MIT；HeroUI：Apache-2.0）。

## 官方来源

| 模板 | 固定源码版本 | 本地保留的文件 | 官方说明 |
| --- | --- | --- | --- |
| Ant Design | 源码 package.json 6.6.5，commit `5a4a6aa9d4e54ac2ffa64fee8244005867d5ceee` | `components/theme/themes/seed.ts` | [主题定制](https://ant.design/docs/react/customize-theme)、[设计原则](https://ant.design/docs/spec/introduce)、[颜色](https://ant.design/docs/spec/colors) |
| HeroUI v3 | @heroui/styles 源码 3.2.6，commit `73000ea8d13ee8aba6a098c93d1d3b5946fa036f` | `packages/styles/themes/default/variables.css`、`packages/styles/components/button.css` | [主题](https://heroui.com/docs/react/getting-started/theming)、[按钮](https://heroui.com/docs/react/components/button) |

Ant Design 源码：https://github.com/ant-design/ant-design/tree/5a4a6aa9d4e54ac2ffa64fee8244005867d5ceee

HeroUI 源码：https://github.com/heroui-inc/heroui/tree/73000ea8d13ee8aba6a098c93d1d3b5946fa036f

资料核对日期：2026-10-02。版本是固定提交中的版本字段，不保证对应已发布的 npm 版本。升级时同时核对文档、源码和项目依赖版本，更新来源及许可证。

## 使用边界

Ant Design 的 Seed 源码存在相对 TypeScript 导入，是参考资产，不可直接复制到 HTML 执行；实际 React 项目通过 `ConfigProvider` 应用主题。HeroUI 的组件 CSS 包含 `@apply`，需要 Tailwind v4 与完整 `@heroui/styles` 构建环境，不能作为普通 CSS 直接塞进浏览器。

`team-theme.css` 可用于原生 HTML 的视觉参考，但不提供完整组件样式、行为或无障碍能力。HTML 原型不要宣称是官方组件实现。发布项目所需资产应复制到项目内并保留归属，不直接依赖 Plant 的 `.external/` 路径。
