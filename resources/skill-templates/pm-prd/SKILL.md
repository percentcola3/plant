---
name: pm-prd
description: >-
  这个 skill 是写 / 润色 / 审阅 PRD 的（**已经走过 pm-brainstorm 拿到设计稿之后**），
  不是做需求澄清的（需求澄清走 pm-brainstorm）、不是做技术风险分析的（那个走 pm-prd-tech-analysis）、
  不是画 mockup 的（画图走 pm-ui-execute）。
  触发词：写 PRD、生成 PRD、产品方案、需求文档、审阅 PRD、润色 PRD、补充 PRD、产品评审、PRD review。
---

# pm-prd：PRD 写作与评审

<EXTREMELY_IMPORTANT>
**前置门禁**：进入本 skill 前必须先走 `pm-brainstorm` 拿到设计稿，或者用户已有 brainstorm spec / 已有当前编辑文档作为输入。

跳过 `pm-brainstorm` 直接写 PRD = 违规。即使用户说"很简单 / 直接写"，也必须先完成需求澄清和事实收集。

**后置门禁**：PRD 落地后**必须**调用 `pm-summary` 写 meta.json，并提供 `selfCheck.items[]`，否则任务没结束。
</EXTREMELY_IMPORTANT>

## 启动横幅（必出，否则视为未进入本 skill）

回复正文**第一行**：

```
------- 开始执行 pm-prd skill ------
```

第二行：`本轮模式：<写 PRD / 审阅 / 润色补充>（理由：...）`

未输出 = 未进入。

## 三种模式

| 模式 | 输入 | 产出 |
|---|---|---|
| **写 PRD** | brainstorm 设计稿 / 用户描述 + 知识库 | 写入 `docs/<topic-slug>/prd.md`（或用户当前编辑文档） |
| **审阅** | 已有 PRD / 当前编辑文档 | 审阅结论 + 建议改写片段，**不**自动改文档（除非用户允许） |
| **润色补充** | 已有 PRD + 用户改进诉求 | 直接 Edit 当前文档，附上修改说明 |

不要在一轮里跨多个模式。先决定模式，再走流程。

## 总原则

- **先收集事实，再写结论**——不用"应该 / 可能 / 通常"补空白
- **目标文件优先**：用户消息有 `## 当前编辑文档` / `目标文件：...` 标记 → 写入 / 修订那个文件，**不**另建 PRD
- **没目标文件**：默认落点 `docs/<topic-slug>/prd.md`（每个需求分支一份；不在路径里塞日期，日期写文件元信息）。仍不明确就先问用户。
- **必须引用** brainstorm spec 的 `.external/<alias>/` 知识库命中和工作区检索结论；脑暴时没检索 → 先回 `pm-brainstorm`
- **明确"做什么 / 不做什么 / 怎么验收 / 对谁有影响"**
- **兼容性必须覆盖**老数据、老流程、老入口、灰度 / 回滚
- **影响范围必须覆盖**用户、业务流程、数据、权限、通知、埋点、运营配置、客服、风控、财务、下游系统；无影响也写"无"
- **复杂需求至少 1 张 Mermaid 图**：流程优先 `flowchart`，需求结构优先 `mindmap`

## 写作风格

- 短句优先，每段一个意思
- 少黑话："赋能 / 闭环 / 抓手 / 链路打通 / 能力沉淀 / 精细化运营"——必须用就补一句普通话
- 业务术语必登记（PRD §1.1 术语说明），未确认的只能放"风险与待确认"或 TODO

## 模式 A：写 PRD

**步骤**：

1. 确认 brainstorm spec 已就绪：Read `docs/<topic-slug>/design.md` 或用户给的 spec 路径
2. 确认目标文件位置（用户给的当前编辑文档 vs 新建 `docs/<topic-slug>/prd.md`）
3. Read `../_shared/templates/prd-template.md` —— PRD 骨架 + 场景案例要求
4. Read brainstorm 产出，把术语表 / 影响面 / 知识库依据带进 PRD
5. 按模板写 / 重写
6. **每个抽象规则配至少 1 个场景案例**（见 prd-template.md §场景案例要求）
7. 自检（输出 `selfCheck.items[]`：模板每节都填了？术语都登记？影响面没漏？至少 1 张图？）
8. 调 `pm-summary`，传 selfCheck 数据

## 模式 B：审阅

审阅不是只给结论，**也要补充和润色**。

**步骤**：

1. Read 用户给的 PRD / 当前编辑文档
2. Read `../_shared/templates/prd-review-output.md` —— 审阅输出格式 + 三类检查清单
3. 按三类检查（风格 / 业务 / 流畅度）逐条过
4. 输出审阅结论（按 prd-review-output 的格式）
5. 调 `pm-summary`，selfCheck 标"本轮为审阅产出"

## 模式 C：润色补充

直接 Edit 当前编辑文档，**回复中说明改了哪些部分**：

- 风格修：哪些段重写、为什么
- 业务补：补了哪些之前没说清的链路 / 规则 / 案例
- 结构调：章节合并 / 拆分 / 重排

不要静默修改。最后调 `pm-summary` 记录变更。

## 收尾

完成后：

- **必做**：调 `pm-summary` 写 meta.json，落点 `docs/<topic-slug>/meta.json`，传 `selfCheck.items[]`
- 语义化 git：`docs(<topic-slug>): 新增 / 更新 <topic> PRD`
- 移交：用户要做研发评审 / 工期 / 接口分析 → 调 `pm-prd-tech-analysis`

## 触发后必做的第一条任务

```
1. 确认 brainstorm spec / 当前编辑文档在哪
2. 输出启动横幅 + 模式判定
3. Read ../_shared/templates/prd-template.md（模式 A）或 prd-review-output.md（模式 B）
4. TaskCreate × 7（按模式定制）
```
