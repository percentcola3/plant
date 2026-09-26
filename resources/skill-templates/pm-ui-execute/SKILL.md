---
name: pm-ui-execute
description: >-
  这个 skill 是 PM 项目里"为 PRD 配 mockup / 原型示意 HTML"的入口（套壳 ui-execute）。
  **不是写 PRD 主体的**（写 PRD 走 pm-prd）、**不是脑暴的**（设计走 pm-brainstorm）、
  **不是技术分析的**（评审走 pm-prd-tech-analysis）。UI 项目里直接走 ui-execute，本 skill 只在 PM 项目里出现。
  触发词：做 mockup、画原型、UI 原型、视觉稿、PRD 配图、需求里要画页面。
---

# pm-ui-execute：PM 视角下的 UI 落地执行

<EXTREMELY_IMPORTANT>
**本 skill 完全继承 `../_shared/ui-execute-core.md`**——所有 §模式 / §约束 / §自检规则不复述，避免漂移。
**前置门禁**：必须先有 `pm-brainstorm` 设计稿或 PRD 提到的 UI 模块说明。
**后置门禁**：完成后**必须**调用 `pm-summary` 写 meta.json，并提供 `selfCheck.items[]`。
</EXTREMELY_IMPORTANT>

## 启动横幅（必出）

```
------- 开始执行 pm-ui-execute skill ------
```

第二行：`本轮模式：<生成 / 迭代 / 调整 / 源组件引入 / 画布重置>（理由：...）`

未输出 = 未进入。

## 必读

进入 skill 后**第一件事**：

1. Read `../_shared/ui-execute-core.md` —— 5 种模式 / 通用流程 / 自检清单
2. Read `../_shared/component-spec.md` —— UI 约束总集

按那两份文档的"通用流程"开始 TaskCreate。**模式判定 / 约束 / 自检全部按那两份走**，本 SKILL.md 只补 PM 项目的几个差异点。

## §PM 项目特有差异

### 0. UI 资产库优先（绝对权威）

`uiAssets[]` 非空时，**mockup 必须以资产库为中心**复用主题 / 组件 / 产物。
取用规则见 `../_shared/component-spec.md` §UI 资产库优先级（PM/UI 共用一份规则，
本 SKILL 不复述）。

PM 特有提醒：mockup 不是"概念示意图"，是研发照搬时直接对应组件的真实样子。
用 `var(--brand-primary)` 而不是写 hex 色——这是 PM 跟研发反复返工的根源。

### 1. 落点

UI 项目：`outputs/<slug>/index.html`（产物为中心）
PM 项目：通常是 PRD 的**配图 / 原型示意**，建议落 `docs/<topic-slug>/mockup-<n>.html`，跟 PRD 同目录方便引用（每个需求分支只有一份 `docs/<topic-slug>/`，不要再分 topic-slug 子目录）。

如果是要走完整 UI 落地（最终团队也用这套 HTML 做参考），仍按 ui-execute-core 的 `outputs/<slug>/index.html`，但**告诉用户路径**——PM 项目的研发可能不知道 outputs/ 在哪。

### 2. 协作关系

PM 项目里 UI 不是终态产物——UI 给 PRD 提供视觉支撑：

- PRD §4.2 / §4.3（页面 / 状态 / 交互）应该**显式引用** mockup 路径："详见 `docs/<topic-slug>/mockup-1.html`"
- 调 `pm-summary` 时把 mockup 也算进 `deliverables[]`，让下游研发能从 PRD 跳到 mockup

### 3. PM 项目的 scope 处理

`components/scopes.json` 在 PM 项目里**通常不存在**。这种情况下：

- 优先复用 PM 项目知识库（`kbRefs[].paths`）里提到的设计 token / 组件库
- 用最朴素的内联样式，不要自创变量名
- 在 mockup HTML 头部加：`<!-- TODO: 移到 UI 项目后接入 components/scopes.json -->` 标记

ui-execute-core 里 `$DIR / $THEME / $BRAND / $THEME_REL` 等 scope 术语在 PM 项目下可能不适用，按上面兜底方案处理。

## §收尾

完成后：

- **必做**：调 `pm-summary` 写 meta.json，把 mockup HTML 加进 `deliverables[]`（kind = `mockup`），传 `selfCheck.items[]`
- 在 `decisions[]` 写"为什么这个布局"等关键决策
- 语义化 git：`docs(<topic-slug>): 新增 / 更新 <topic> mockup`

## 触发后必做的第一条任务

```
1. Read ../_shared/ui-execute-core.md
2. Read ../_shared/component-spec.md
3. 输出启动横幅 + 模式判定
4. 按 ui-execute-core 给出的步骤执行（注意 §PM 项目特有差异覆盖项）
5. 收尾时调 pm-summary，传 selfCheck.items[]
```
