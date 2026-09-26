# PM 项目 skills 索引

本目录下的 5 个 `pm-*` skill 是 PM 项目里 AI 协作的核心入口。
新会话进来先看这份索引，再决定调哪个 skill。

## 我要做什么 → 用哪个 skill

| 场景 | skill |
|---|---|
| 想做新需求，从模糊想法 → 设计稿 | `pm-brainstorm` |
| 拿到设计稿后写正式 PRD | `pm-prd`（模式 A 写） |
| 已有 PRD 想审阅 / 找问题 | `pm-prd`（模式 B 审阅） |
| 已有 PRD 想润色 / 补充 | `pm-prd`（模式 C 润色） |
| 站研发角度做技术风险 / 工作量分析 | `pm-prd-tech-analysis` |
| 在 PRD 里加 mockup / 原型示意 | `pm-ui-execute` |
| 看图还原页面 / 按图设计 | `pm-brainstorm`（图片还原模式） |
| 产物落地后写 meta.json | `pm-summary`（被前面 skills 自动调用） |

## 协作关系

```
用户需求 / 想法
   ↓
[pm-brainstorm]  ← 必走入口（任何创造性工作前）
   ↓ 产出 docs/<topic-slug>/design.md
   ├─→ [pm-prd]                 → 写正式 PRD
   ├─→ [pm-prd-tech-analysis]   → 研发评审 / 工作量
   └─→ [pm-ui-execute]          → 画 mockup / 原型 HTML
       ↓
   [pm-summary]  ← 每次产出后必做，写 meta.json
       ↓
   git: docs(<topic-slug>): ...          ← 用户在 App "打版本" 写语义化 commit
```

## 共享约束（_shared/ 目录）

下游 skill 通过 Read 这些文件复用约束，**禁止**复述：

| 文件 | 谁用 | 内容 |
|---|---|---|
| `_shared/brainstorm-core.md` | pm-brainstorm | 9 步脑暴流程通用骨架 |
| `_shared/summary-core.md` | pm-summary | meta.json schema + selfCheck 协议 |
| `_shared/component-spec.md` | pm-ui-execute | UI 约束总集（仅 PM 画 mockup 时用） |
| `_shared/ui-execute-core.md` | pm-ui-execute | UI 5 种模式 + 自检清单 |
| `_shared/templates/prd-template.md` | pm-prd | PRD 骨架 |
| `_shared/templates/prd-review-output.md` | pm-prd | 审阅输出格式 |
| `_shared/templates/tech-analysis-template.md` | pm-prd-tech-analysis | 研发评审稿骨架 |
| `_shared/templates/pm-design-template.md` | pm-brainstorm | PRD 风格设计稿骨架 |
| `_shared/templates/visual-companion-html.md` | pm-brainstorm（视觉问题）| mockup HTML 协议 |

## 不在本项目里的 skill

`ui-*` 系列在 UI 项目（kind=ux）独享，PM 项目看不到。如果你的工作横跨 PM + UI，新建一个 UI 项目（kind=ux）专门做组件 / outputs，PM 项目里只走 `pm-ui-execute` 写 mockup 配 PRD。
