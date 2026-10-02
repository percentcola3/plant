# UX 设计模板：让规则和样式一起成为上下文

这些是随源码提供的知识库起步模板，不是已安装的组件库，也不是 Plant UI 的主题。v0.2.12 安装包不包含本次新增模板；从仓库取得后可手动接入。

在 Plant「知识库」中添加本地目录，分别选择本仓库的 `resources/design-templates/antd` 或 `resources/design-templates/heroui`，归类为 UX 资产并关联项目。也可以将其中一个目录复制到团队自己的 Git 仓库，再连接该仓库。对话时用 `@` 选择该知识库；按需安装其中的 `SKILL.md`，不要假设添加知识库就会自动安装 Skill。

每个模板包含：

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
