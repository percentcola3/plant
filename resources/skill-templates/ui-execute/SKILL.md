---
name: ui-execute
description: >-
  这个 skill 是 UI 项目"按设计稿落地 HTML"的执行入口：生成新页面 / 迭代 / 调整组件 / 源组件引入 / 画布重置（5 模式）。
  **不是脑暴 / 设计的**（设计走 ui-brainstorm）、**不是组件沉淀的**（DOM 抽组件走 ui-distill）、
  **不是写 meta.json 的**（产物总结走 ui-summary）。
  触发词：生成页面、做一个页面、画个页面、画方案、create page、迭代修改、页面调整、调整组件、修改组件、引入组件、转换组件、convert component、画布固定、固定画布、reset canvas。
---

# ui-execute：UI 落地执行

<EXTREMELY_IMPORTANT>
**前置门禁**：进入本 skill 前必须先走 `ui-brainstorm` 拿到设计稿；用户已有 brainstorm spec 文档作为输入直接进的可以直接进。
**后置门禁**：每次执行结束**必须**调用 `ui-summary` 写 meta.json，并提供 `selfCheck.items[]`，否则任务没结束。
</EXTREMELY_IMPORTANT>

## 启动横幅（必出）

回复正文**第一行**：

```
------- 开始执行 ui-execute skill ------
```

第二行：`本轮模式：<生成 / 迭代 / 调整 / 源组件引入 / 画布重置>（理由：...）`

未输出 = 未进入。

## 必读

进入 skill 后**第一件事**：

1. Read `../_shared/ui-execute-core.md` —— 5 种模式 / 通用流程 / 自检清单
2. Read `../_shared/component-spec.md` —— UI 项目所有产出共用约束（CSS 变量映射 / 图标 / 防杜撰 R1-R5 / Atom 复用）

读完按 `../_shared/ui-execute-core.md` 的"通用流程"开始 TaskCreate + 模式判定。

## 触发后必做的第一条任务

```
1. Read ../_shared/ui-execute-core.md
2. Read ../_shared/component-spec.md
3. 输出启动横幅 + 模式判定
4. 按 ../_shared/ui-execute-core.md 给出的步骤执行
5. 收尾时调 ui-summary，传 selfCheck.items[]
```
