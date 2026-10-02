# Ant Design：从 Token 到组件

来源：Ant Design 源码 6.6.5，固定提交 [5a4a6aa](https://github.com/ant-design/ant-design/tree/5a4a6aa9d4e54ac2ffa64fee8244005867d5ceee)。下文是依据官方资料编写的使用摘要，不是官方文档全文。

## 设计依据

阅读官方[设计原则](https://ant.design/docs/spec/introduce)、[布局](https://ant.design/docs/spec/layout)、[颜色](https://ant.design/docs/spec/colors)、[字体](https://ant.design/docs/spec/font)与[主题定制](https://ant.design/docs/react/customize-theme)。业务表格、表单与操作使用对应组件规范；颜色需要表达操作、状态和层级，不能只作为装饰。

`upstream/seed.ts` 是完整官方 Seed 快照，包括主色 `#1677ff`、成功色 `#52c41a`、警告色 `#faad14`、错误色 `#ff4d4f`、字号 14、基础圆角 6、控件高度 32 和间距单位 4。

Token 存在 Seed → Map → Alias 的派生关系，组件还有自己的 Token。不要手写一组 CSS 变量就声称复现了完整算法；明暗及紧凑主题应使用官方算法。

## 团队定制示例

`team-theme.json` 覆盖主色及少数尺寸，属于 Plant 示例，不是官方默认值。在已有 Ant Design React 项目中将该对象传给 `ConfigProvider` 的 `theme` 属性；可使用 `theme.darkAlgorithm` / `theme.compactAlgorithm`。实际字段以目标版本为准。

原生 HTML 原型可参考 `team-theme.css`，它只映射部分 Seed 值，不包含 Map / Alias 派生值或完整组件样式。不要直接执行 `upstream/seed.ts` 的相对导入。

## 验收

表单用明确的标签与校验反馈；表格操作保持固定位置；页面突出一个主要任务，危险操作有明确后果。检查正常、空、加载、错误、禁用与焦点状态。组件细节查阅 [Button](https://ant.design/components/button)、[Form](https://ant.design/components/form)、[Table](https://ant.design/components/table)，不要凭记忆跨版本拼接 API。
