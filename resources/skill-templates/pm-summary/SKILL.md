---
name: pm-summary
description: >-
  这个 skill 是 PM 项目"把本次产出（PRD / 技术评审稿 / mockup）+ 关键决策 + selfCheck 写入 meta.json"的入口。
  **不是脑暴的**（走 pm-brainstorm）、**不是写 PRD 的**（走 pm-prd）、
  **不是技术分析的**（走 pm-prd-tech-analysis）、**不是画 mockup 的**（走 pm-ui-execute）。
  pm-prd / pm-prd-tech-analysis / pm-ui-execute 完成后必须调用本 skill，传入 selfCheck.items[]。
---

# pm-summary：PM 产物 meta.json

> 通用协议在 **`../_shared/summary-core.md`**，本 SKILL.md 给出 PM 项目特有的：落点 / kind 字段 / deliverables 类型 / PRD vs 评审 vs mockup 的区分。

## 启动横幅（必出）

```
------- 开始执行 pm-summary skill ------
```

## 必读

进入 skill 后**立即** Read `../_shared/summary-core.md`。schema / 字段说明 / 自动调用约束 / 自检规则全在那里。

## §PM 差异 1：落点

```
docs/<topic-slug>/
  ├── design.md           # pm-brainstorm 产出（脑暴设计稿）
  ├── prd.md              # pm-prd 产出（正式 PRD）—— 或用户当前编辑文档
  ├── tech-analysis.md    # pm-prd-tech-analysis 产出
  ├── mockup-1.html       # pm-ui-execute 产出（可选）
  └── meta.json           # 本 skill 产出 ← 关键
```

每个需求分支（`req/<id>-<slug>`）下一份 `docs/<topic-slug>/`，全部本次需求产出都放这里。**不要**在路径里塞日期或 topic-slug——日期作为文档元信息（如 `> 日期：YYYY-MM-DD`），topic 由分支名表达。

**注意**：如果用户的 PRD 已经在其它路径（老仓库迁过来 / 用户 explicitly 指定了别的位置），`meta.json` 仍然写在 `docs/<topic-slug>/meta.json`，`deliverables[].path` 如实写真实路径。meta 是"索引"，不必跟产物同目录。

## §PM 差异 2：kind 字段

固定写：

```json
{ "kind": "pm" }
```

如果是 pm-prd-tech-analysis 单独产出（没有 PRD 主体）：

```json
{ "kind": "pm-tech-analysis" }
```

下游工具按这个区分文档类型。

## §PM 差异 3：deliverables 类型

PM 项目的 deliverables 通常包括：

```json
"deliverables": [
  { "path": "docs/<topic-slug>/design.md", "kind": "design", "summary": "..." },
  { "path": "docs/<topic-slug>/prd.md", "kind": "prd", "summary": "..." },
  { "path": "docs/<topic-slug>/tech-analysis.md", "kind": "tech-analysis", "summary": "..." },
  { "path": "docs/<topic-slug>/mockup-1.html", "kind": "mockup", "summary": "..." }
]
```

`kind` 取值约定：`design` / `prd` / `tech-analysis` / `mockup` / `asset`。

## §PM 差异 4：decisions 重点

PM 项目 decisions 里要重点记**业务取舍**，研发评审时常被反过来问的点：

```json
"decisions": [
  {
    "id": "D1",
    "decision": "Pix 线下支付不走在线支付回调",
    "rationale": "门店收银员个人收款码，避免与平台分账系统耦合；订单确认逻辑沿用现金支付",
    "alternatives": ["走在线支付回调（被否：平台需要重写收款码鉴权流程）"]
  }
]
```

不是把 PRD §3 范围 / §5 影响面再抄一遍。**只列下游研发会反过来问"为什么这样"的点**。

## §PM 差异 5：testNotes

PM 产物的 testNotes ≈ PRD §7 验收标准的精简版，给 QA 用：

```json
"testNotes": [
  "门店开启桌台点餐 + 收银员配置 Pix 收款码 → 选 Pix 线下支付 → 订单状态与现金一致",
  "未开启桌台点餐时，Pix 线下支付选项应不可见",
  "重复确认收款 → 提示已收款，不重复推进订单状态",
  "退款 / 取消规则与现金支付完全一致"
]
```

## §PM 差异 6：openQuestions

PM 项目里的 openQuestions 常涉及**外部依赖**：

```json
"openQuestions": [
  "需要法务确认 Pix 个人收款码在 B 端商户场景的合规性（已发邮件给 @lily）",
  "财务对账系统是否需要新增数据源？待 @bob 反馈",
  "客服系统是否需要新增工单类型？待客服 lead 评估"
]
```

每条尽量写**建议跟进人 + 当前状态**，不是空泛的"待确认"。

## 步骤

1. Read `../_shared/summary-core.md` 拿到 schema 模板
2. Read 本次产出的所有文件，逐个写 `summary` 字段
3. 跟 pm-prd / pm-prd-tech-analysis / pm-ui-execute 的执行轨迹对照，提取 2-3 条关键 `decisions`
4. 决定 `diff.from`（如果是修订已有 PRD 而非新建）
5. 写 `meta.json`（位置见 §PM 差异 1）
6. 自检（见 `../_shared/summary-core.md` §自检）
7. 通知用户："meta.json 已写入 `<path>`，下游研发可读"

## §更新而非新建

如果 `meta.json` 已存在（PRD 经过多轮迭代）：

- Read 当前 meta，保留旧字段
- **追加**新 deliverables / decisions（旧 decision 不动；除非用户明确说"撤回 D2"）
- 更新 `lastUpdatedAt`
- 在 `diff.highlights` 里加这次的关键变更（保留历史，不擦旧的）

详见 `../_shared/summary-core.md` §更新而非新建。

## 触发后必做的第一条任务

```
1. Read ../_shared/summary-core.md
2. 输出启动横幅
3. TaskCreate × 7（对应步骤 1-7）
4. 步骤 1：Read schema
```
