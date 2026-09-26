---
name: ui-summary
description: >-
  这个 skill 是 UI 项目"把本次产出 / 关键决策 / selfCheck / 跨版本 diff 写入 meta.json"的入口。
  **不是脑暴 / 设计的**（走 ui-brainstorm）、**不是落地 HTML 的**（走 ui-execute）、
  **不是组件沉淀的**（走 ui-distill）。
  ui-execute / ui-distill 完成后必须调用本 skill，传入 selfCheck.items[]。
---

# ui-summary：UI 产物 meta.json

> 通用协议在 **`../_shared/summary-core.md`**，本 SKILL.md 给出 UI 项目特有的：落点 / diff 字段填法 / 跨项目复制场景。

## 启动横幅（必出）

```
------- 开始执行 ui-summary skill ------
```

## 必读

进入 skill 后**立即** Read `../_shared/summary-core.md`。schema / 字段说明 / 自动调用约束 / 自检规则全在那里。

## §UI 差异 1：落点

```
ui/<topic-slug>/
  ├── design.md             # ui-brainstorm 产出
  ├── meta.json             # 本 skill 产出 ← 关键
  ├── source.<ext>          # 图片还原模式的源图（可选）
  ├── m-<n>-*.html          # 最终视觉稿（M 系列）—— 算 UI 产物
  └── .transient/           # 决策伴侣（Q 系列），用完即废，**不算 UI 产物**
        ├── q-1-layout.html
        └── q-2-cta-style.html
```

跟 design.md **同目录**。**不要**写到 `outputs/<slug>/meta.json`——那个目录是产物层，由别的工具维护。

**重要——产物范围**：UI 产物只包含**最终视觉稿**（M 系列）+ design.md。决策伴侣（Q 系列）是脑暴期工具，落 `.transient/`，summary 不收录。如果脑暴期遗留了 q-*.html 在主目录，summary 阶段顺便迁到 `.transient/`。

## §UI 差异 2：kind 字段

固定写：

```json
{ "kind": "ui" }
```

下游工具按这个区分这是个 UI 产物 meta（vs PM 的 PRD meta）。

## §UI 差异 3：deliverables

UI 项目的 deliverables 通常包括：

```json
"deliverables": [
  { "path": "ui/<topic-slug>/design.md", "kind": "design", "summary": "..." },
  { "path": "ui/<topic-slug>/m-1-final.html", "kind": "mockup", "summary": "..." },
  { "path": "outputs/<slug>/index.html", "kind": "html", "summary": "..." },
  { "path": "components/<scope>/<comp-name>/<comp-name>.html", "kind": "component", "summary": "..." }
]
```

`kind` 取值约定：`design` / `html` / `component` / `mockup` / `asset`。

**禁止收录**：`q-*.html`、`.transient/**` —— 决策伴侣不是产物。

## §UI 差异 4：diff（重点）

UI 经常**从其它项目 / 旧版本复制过来再改**。下游研发只看到合并后的 HTML，不知道改了什么。`diff` 段必须**显式列出**变更：

```json
"diff": {
  "from": "项目 saas-ui-v1 commit abc1234 / outputs/login-pix-old.html",
  "highlights": [
    "顶部 hero 高度 600 → 480",
    "主按钮颜色从蓝改成 pix 品牌橙 #f26b2f",
    "新增底部 CTA fixed 区"
  ]
}
```

**不要**写"改了一些样式"这种没信息量的话。

### 来源类型

- `from = "initial"` — 全新设计，没参考别的（diff.highlights 可以空数组）
- `from = "<source-path>"` — 复制自本仓库其它路径
- `from = "<repo-name> commit <sha>"` — 跨仓库参考
- `from = "图片：source.<ext>"` — 图片还原模式，diff.highlights 写跟原图的差异

## §UI 差异 5：testNotes

UI 产物的验收要点举例：

```json
"testNotes": [
  "1440×900 视口下：顶部 hero 占 ½ 屏",
  "缩放到 1280：主按钮不换行",
  "替换 theme = saas → didi 后，主色应跟随变化",
  "components/scopes.json 中的 scope 切换不影响本 outputs"
]
```

## 步骤

1. Read `../_shared/summary-core.md` 拿到 schema 模板
2. Read 本次产出的所有文件，逐个写 `summary` 字段
3. 跟 ui-execute / ui-distill 的执行轨迹对照，提取 2-3 条关键 `decisions`
4. 决定 `diff.from`（从 ui-execute 的输入 / brainstorm spec 里看出来）
5. 写 `meta.json`（位置 `ui/<topic-slug>/meta.json`）
6. 自检（见 `../_shared/summary-core.md` §自检）
7. 通知用户："meta.json 已写入 `ui/<topic-slug>/meta.json`，下游研发可读"

## 更新而非新建

如果 `meta.json` 已存在：

- Read 当前 meta，保留旧字段
- **追加**新 deliverables / decisions
- 更新 `lastUpdatedAt`
- 在 `diff.highlights` 里加这次的关键变更（不擦旧的，保留历史）

详见 `../_shared/summary-core.md` §更新而非新建。

## 触发后必做的第一条任务

```
1. Read ../_shared/summary-core.md
2. 输出启动横幅
3. TaskCreate × 7（对应步骤 1-7）
4. 步骤 1：Read schema
```
