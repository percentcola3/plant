---
name: pm-prd-tech-analysis
description: >-
  这个 skill 是站在前后端研发视角分析 PRD 的技术风险 / 影响面 / 工作量的，
  必要时读源码确认。**不是写 PRD 主体的**（写 PRD 走 pm-prd）、
  **不是做产品评审的**（产品评审走 pm-prd 模式 B）、
  **不是画 mockup 的**（画图走 pm-ui-execute）。
  触发词：研发评审、技术分析、工期拆分、影响范围、兼容性分析、技术风险、PRD 技术评审。
---

# pm-prd-tech-analysis：PRD 技术分析

<EXTREMELY_IMPORTANT>
**前置门禁**：进入本 skill 前必须有 PRD 或当前编辑文档作为输入。没 PRD 先去 `pm-prd`。
**后置门禁**：分析结论落地后**必须**调用 `pm-summary` 写 meta.json，并提供 `selfCheck.items[]`。
</EXTREMELY_IMPORTANT>

## 启动横幅（必出）

```
------- 开始执行 pm-prd-tech-analysis skill ------
```

第二行：`本轮焦点：<前端 / 后端 / 全栈 / 数据迁移>（理由：...）`

未输出 = 未进入。

## 目标

让研发**一眼看清楚**：

- 本次业务改动点是什么
- 涉及哪些**模块 / 接口 / 数据**
- 怎么**拆任务**
- 工作量级别（S/M/L）和**风险**在哪

不替研发承诺精确排期。

## 硬动作（缺一不可）

1. **PRD 必读**：Read 用户给的 PRD 文件 / 当前编辑文档
2. **Read 模板**：`../_shared/templates/tech-analysis-template.md`——评审稿骨架 + 评审口径 + 代码探查准则
3. **知识库检索**：`.workspace/project-context.json` 中 `kbRefs` 非空 → 先在 `kbRefs[].paths` 搜接口名、模块名、数据表 / 字段、状态枚举、配置项、埋点名
4. **代码探查（必要时）**：
   - PRD 提到的接口在 kbRefs 中没找到 → `rg "<接口名>" --type ts --type java --type python`
   - 涉及前端组件 → 检查 `components/<scope>/<name>/` 是否已有
   - 涉及后端配置 → 检查 `kbRefs` 配置文件 / 字段定义
5. **证据不足标"待研发确认"**——不臆造接口名 / 表字段
6. **先讲业务改动点 → 再映射到技术改动范围**——不要一上来就列接口和表
7. **多系统 / 前后端交互必须配 Mermaid 图**：`sequenceDiagram` 或 `flowchart`
8. **PM 暂时答不上的问题写 TODO**，标建议跟进人，不要写成确定结论

## 收尾

完成后：

- **必做**：调 `pm-summary`，传 `selfCheck.items[]`，加 `kind = "pm-tech-analysis"` 区分（或在 `decisions[]` 加 "本次为技术分析产出"）
- 语义化 git：`docs(<topic-slug>): 新增 / 更新 <topic> 研发评审稿`

## 触发后必做的第一条任务

```
1. Read 用户给的 PRD / 当前编辑文档
2. Read ../_shared/templates/tech-analysis-template.md
3. 输出启动横幅 + 焦点判定
4. TaskCreate × 8（对应模板各节）
5. 步骤 1：知识库检索 + 必要时 rg 探查代码
```
