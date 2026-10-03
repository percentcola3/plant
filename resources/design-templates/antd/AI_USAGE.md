# Ant Design UX 资产使用说明

先读 `design-guide.md` 和 `team-theme.json`，再按任务检索 `upstream/`。`SKILL.md` 提供设计流程；这些资源不会自动安装运行时依赖。

团队定制主题优先于官方默认值，但不可将定制示例称为官方规范。确认目标项目使用的框架及依赖版本。React 实现采用真实组件 API；原生 HTML 原型仅参考视觉 Token，明确其实现边界。

修改前确认业务目标、布局与必要状态；复用实际颜色、字号、间距和组件模式。交付时说明引用文件、主题改动和未完成状态。资源只读，将需要发布的样式复制到项目内，保留官方许可证。来源版本见上级 README 或 `design-guide.md`。


Plant 资产库结构：`components/antd/theme/` 存放色板与主题，`components/antd/button/` 是可预览的 HTML 视觉示例，`assets/` 存放图片与图标。先查看示例的 README，再阅读 HTML、CSS；它们是 Plant 编写的目录与视觉参考，不是官方 React 组件实现。
