# UI 项目 skills 索引

本目录下的 4 个 `ui-*` skill 是 UI 项目里 AI 协作的核心入口。
新会话进来先看这份索引，再决定调哪个 skill。

## 我要做什么 → 用哪个 skill

| 场景 | skill |
|---|---|
| 想做新页面 / 新组件，从想法 → 设计稿 | `ui-brainstorm` |
| 看图还原页面 / 按图设计 | `ui-brainstorm`（图片还原模式） |
| 拿到设计稿后生成 outputs HTML | `ui-execute`（模式 A 生成） |
| 已有 outputs 想做页面级调整 | `ui-execute`（模式 B 迭代） |
| 改 components/ 下已存在组件 | `ui-execute`（模式 C 调整，先查依赖） |
| 把 ~/Downloads/ 源组件转进本仓库 | `ui-execute`（模式 D 源组件引入） |
| 重置画布到 1440×900 空白 | `ui-execute`（模式 E 画布重置） |
| 把 outputs 里框选的 DOM 抽成可复用组件 | `ui-distill` |
| 产物落地后写 meta.json | `ui-summary`（被前面 skills 自动调用） |

## 协作关系

```
用户需求 / 想法 / 图片
   ↓
[ui-brainstorm]  ← 必走入口（任何创造性工作前）
   ↓ 产出 ui/<topic>/design.md
   ├─→ [ui-execute] 5 模式：生成 / 迭代 / 调整 / 源转换 / 重置
   │       ↓ 产出 outputs/<slug>/index.html 或 components/<scope>/<name>/
   │       └─→ [ui-distill]  ← 把 outputs DOM 抽成 components/ 单文件包
   │
   └─→ [ui-summary]  ← 每次产出后必做，写 meta.json
           ↓
       git: docs(<topic>): ...  ← 用户在 App "打版本" 写语义化 commit
```

## 共享约束（_shared/ 目录）

下游 skill 通过 Read 这些文件复用约束，**禁止**复述：

| 文件 | 谁用 | 内容 |
|---|---|---|
| `_shared/brainstorm-core.md` | ui-brainstorm | 9 步脑暴流程通用骨架 |
| `_shared/summary-core.md` | ui-summary | meta.json schema + selfCheck 协议 |
| `_shared/component-spec.md` | ui-execute / ui-distill | **UI 约束总集**：CSS 变量 / 图标处理 / 防杜撰 R1-R5 / Atom 复用 / 自检清单 |
| `_shared/ui-execute-core.md` | ui-execute | 5 种模式 + 通用流程 |
| `_shared/templates/ui-design-template.md` | ui-brainstorm | 视觉风格设计稿骨架 |
| `_shared/templates/visual-companion-html.md` | ui-brainstorm（视觉问题）| mockup HTML 协议 |

## 关键约束（绝不破例）

`_shared/component-spec.md` 里的 **§Scope 管理** / **§防杜撰 R1-R5** / **§自检清单** 是 UI 所有产出的硬约束：

- CSS 变量必须用 component-spec 允许列表里的，不自创
- 源里没有的 class / aria-* / data-* 不加，源里有的不删
- 单文件包形态：CSS 内联到 `<style>`，外部引用替换为 component-spec 规定的变量
- 每次产出 selfCheck.items[] 必须逐条上报（即便 passed=true）

## 不在本项目里的 skill

`pm-*` 系列在 PM 项目（kind=project）独享，UI 项目看不到。需求澄清 / PRD 写作 / 技术评审都在 PM 项目完成。UI 项目专注 outputs 和 components。
