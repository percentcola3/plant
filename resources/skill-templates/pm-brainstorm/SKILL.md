---
name: pm-brainstorm
description: >-
  这个 skill 是 PM 项目"从模糊需求到设计稿"的脑暴入口（任何创造性工作前必走），含图片还原模式。
  **不是写正式 PRD 的**（写 PRD 走 pm-prd）、**不是做技术分析的**（走 pm-prd-tech-analysis）、
  **不是画 HTML mockup 的**（设计稿确认后走 pm-ui-execute）。
  触发词：脑暴、需求澄清、想做、要做、做设计、做方案、看图还原、按这张图做、UI 设计、视觉方案。
---

# pm-brainstorm：PM 需求脑暴

> 通用流程骨架在 **`../_shared/brainstorm-core.md`**，本 SKILL.md 给出 PM 项目的差异点：spec 落点、PRD 风格、知识库优先级、图片还原。

## 启动横幅（必出）

回复正文**第一行**：

```
------- 开始执行 pm-brainstorm skill ------
```

第二行：`本轮模式：<从需求 0 到 1 / 已有需求改造 / 图片还原>（理由：...）`

未输出 = 未进入。

## 必读

进入 skill 后**立即**：

1. Read `../_shared/brainstorm-core.md` —— HARD-GATE / 9 步清单 / 图文设计判定 / git 收尾
2. Read `../_shared/templates/pm-design-template.md` —— PRD 风格设计稿骨架
3. （视觉问题时）Read `../_shared/templates/visual-companion-html.md` —— mockup HTML 协议
4. （`uiAssets[]` 非空时）Read `../_shared/component-spec.md` §UI 资产库优先级 —— **图文设计的 mockup 也按资产库画**，不是凭想象，是用资产库拼出研发能照搬的样子

本文件只补 PM 项目特有的差异。

## §PM 差异 1：spec 落点

设计文档落 **`docs/<topic-slug>/design.md`**（**不是** `ui/<topic>/design.md`，PM 项目以"需求"为中心）。

每个需求分支（`req/<id>-<slug>`）下一份 `docs/<topic-slug>/`，里面放本次需求的全部产出（design.md / prd.md / tech-analysis.md / meta.json / mockup-*.html）。**不要在路径里塞日期**——日期写在文档头部元信息（比如 `> 日期：YYYY-MM-DD`）。

**注意**：spec 是脑暴产物，不是最终 PRD。最终 PRD 走 `pm-prd` skill，落点 `docs/<topic-slug>/prd.md`。

## §PM 差异 2：知识库优先级

PM 项目对**知识库**依赖度比 UI 项目高很多。脑暴 §1 探索阶段：

1. `kbRefs[].paths` 里搜需求关键词、业务名、模块名、角色名
2. 命中文档**全 Read**（最相关 3-5 份）
3. 在设计稿 §4.1 / §5 / §6 显式标出依据路径："参考 `.external/<alias>/<path>.md`"

未做知识库检索就写方案 = 违规。如果 `kbRefs` 为空，明确告诉用户："本工作区未绑定知识库，方案基于通用经验，建议绑定知识库后再次脑暴"。

## §PM 差异 3：图片还原子模式

参见 `../_shared/brainstorm-core.md` §10。补充 PM 特有：

- **AI 画图 = ASCII 流程图 / 用户画像 / 业务对照表**（不是 wireframe；PRD 关心流程而非视觉）
- 图片入库放 `docs/<topic-slug>/source.<ext>`
- 用户确认后，spec 文档 §1 起源段写 "源图：source.<ext>"
- 移交后续 skill：通常 `pm-prd`（写 PRD）或 `pm-ui-execute`（PM 自己做 UI）

## §收尾

`../_shared/brainstorm-core.md` §9 git 收尾通用。语义化 commit message：

```
docs(<topic-slug>): 新增 <topic> 需求设计稿
```

移交：
- `pm-prd` —— 用户要写正式 PRD
- `pm-ui-execute` —— PM 同时要做 UI 产出
- `pm-prd-tech-analysis` —— 用户要做研发评审 / 技术分析

## 触发后必做的第一条任务

```
1. Read ../_shared/brainstorm-core.md
2. Read ../_shared/templates/pm-design-template.md
3. 输出启动横幅 + 模式判定
4. TaskCreate × 9（对应 §9 步清单）
5. 开始 §1 探索（PM 重点：知识库检索）
```
