# HeroUI v3：主题变量与组件样式共同约束设计

来源：@heroui/styles 源码 3.2.6，固定提交 [73000ea](https://github.com/heroui-inc/heroui/tree/73000ea8d13ee8aba6a098c93d1d3b5946fa036f)。下文是依据官方资料编写的使用摘要。

官方[主题文档](https://heroui.com/docs/react/getting-started/theming)说明 CSS 变量、BEM 类名、Tailwind v4 与亮暗主题；[按钮文档](https://heroui.com/docs/react/components/button)包含尺寸、变体、状态及 API。

`upstream/variables.css` 保留完整默认主题变量：`--accent`、`--accent-foreground`、`--background`、`--foreground`、表面、边框、焦点及状态色。默认 accent 为 `oklch(0.6204 0.195 253.83)`，全局基础 radius 为 `0.5rem`；组件可有独立圆角规则，不能假设所有组件都直接沿用基础 radius。

`upstream/button.css` 保留真实组件样式和状态规则。它包含 `@apply` 与自定义 utilities，必须放在完整 Tailwind v4 / @heroui/styles 环境中，不能直接作为独立浏览器 CSS 使用。

## 团队定制与实现

`team-theme.css` 是 Plant 编写的绿色主题覆盖示例，放在官方样式之后。主题切换使用 `.light` / `.dark` 或 `data-theme`。原生 HTML 可以引用这些 CSS 变量，但仍需自己实现组件样式和行为。

React 实现使用 `@heroui/react` 与 `@heroui/styles`，先导入 Tailwind，再导入 HeroUI，最后导入团队覆盖。确认实际依赖版本。v3 使用组合组件和 `onPress`；不要套用 v2 的 `HeroUIProvider` 与 `@heroui/theme`。Button 使用 `primary`、`secondary`、`tertiary`、`ghost`、`outline` 等语义变体，减少随意硬编码颜色。

检查正常、按下、悬停、加载、禁用、键盘焦点和窄屏。参考 CSS 不等于继承了 React Aria 的无障碍交互。
