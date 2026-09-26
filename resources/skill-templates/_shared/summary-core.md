# 产物总结 / meta.json 协议

> 本文件是 PM 与 UI 项目里 `pm-summary` / `ui-summary` 共用的协议。
> 各 skill 通过 `§章节名` 引用本文件。

## §职责

execute 类 skill **必须在落地完成后立即调用本目录的 summary skill**，把"本次产出 / 变更"写成结构化 `meta.json`。

`meta.json` 是给**下游研发 / 评审者**看的：他们不一定参与脑暴，但要能从 meta 里快速理解"这版改了什么、为什么改、要测什么"。

## §位置

PM：`docs/<topic-slug>/meta.json`（每个需求分支一份，跟 design.md / prd.md 同目录）
UI：`ui/<topic>/meta.json`（同 design.md 同目录）

跟 spec / design 文档**同目录**，不要散到 `outputs/<topic>/meta.json` —— 那个由 build skill 在 outputs/ 下另写一份产物层 meta。

## §schema

```json
{
  "schemaVersion": 2,
  "topic": "<topic-slug>",
  "title": "<人类可读标题>",
  "createdAt": "<ISO8601>",
  "lastUpdatedAt": "<ISO8601>",
  "kind": "pm" | "ui" | "pm-tech-analysis",
  "scope": {
    "included": ["..."],
    "excluded": ["..."]
  },
  "deliverables": [
    { "path": "ui/<topic>/index.html", "kind": "html", "summary": "..." },
    { "path": "docs/<topic-slug>/prd.md", "kind": "spec", "summary": "..." }
  ],
  "decisions": [
    { "id": "D1", "decision": "...", "rationale": "...", "alternatives": [...] }
  ],
  "openQuestions": ["..."],
  "diff": {
    "from": "<上一版 commit-sha 或 \"initial\">",
    "highlights": ["...", "..."]
  },
  "testNotes": ["..."],
  "selfCheck": {
    "passed": true,
    "items": [
      { "id": "css-vars", "passed": true, "note": "全部用 component-spec 允许的变量名" },
      { "id": "anti-fabrication-r1", "passed": true, "note": "无新增源里没有的 class" },
      { "id": "icon-handling", "passed": false, "note": "购物车 icon 缺图源，先用占位 SVG" }
    ]
  }
}
```

`schemaVersion: 2` 起强制写 `selfCheck`。旧版本 `schemaVersion: 1` 的 meta（没有 selfCheck）下游消费方应做向后兼容，把它当作"未自检"处理。

## §字段说明

- `topic` — kebab-case 短名，跟 spec 文档保持一致
- `kind` — `pm` / `ui` / `pm-tech-analysis`，下游工具按这个区分文档类型
- `scope.included / excluded` — 包含与排除明确写出来。研发评审最常用
- `deliverables[]` — 本次产出的所有文件相对路径 + 一句话摘要
- `decisions[]` — 设计中做出的关键决定（**不**重复 spec 里的内容，只列下游研发会反过来问"为什么这样"的点）
- `openQuestions[]` — 有意留下的、待 PM/研发确认的问题（区别于 spec 的 TODO，这里是"需要别人输入"的）
- `diff` — 跨项目 / 跨版本对比的关键变更。**UI 项目从其它项目复制过来时这里必填**
- `testNotes[]` — 验收要点（功能验收清单）
- `selfCheck` — 调用方 skill（ui-execute / ui-distill / pm-prd / 等）执行完自检后回填的结构化结果

## §selfCheck 详细约定

`passed` = 所有 items 都 passed=true；否则 false。

`items[]` 每项三字段：
- `id`：自检项的稳定标识（kebab-case），同一类约束跨产物用同一个 id 方便聚合统计
- `passed`：boolean
- `note`：一句话描述（通过时可空；失败时必须写为什么失败 / 临时怎么处理 / 何时跟进）

约定的 id 命名空间：
- UI 项目：`css-vars` / `anti-fabrication-r1` / `anti-fabrication-r2` / ... / `icon-handling` / `atom-reuse` / `single-file-package` / `visual-parity`（详见 `_shared/component-spec.md` §自检清单）
- PM 项目：`prd-template-complete` / `terminology-registered` / `impact-coverage` / `mermaid-present` / `scenario-cases` / `kb-citation`（每个调用 skill 自己定义子集）

调用方 skill 必须**逐条上报**（即使 passed=true 也写一项），不要只报失败的。下游消费方需要能聚合"过了几条 / 跳过几条 / 失败几条"。

## §如何写 diff（UI 关键场景）

UI 项目里 outputs / components 经常从 **其它项目 / 旧版本**复制过来再改。下游研发只看到合并后的 HTML，不知道改了什么。所以 `diff` 段要**显式列出**：

- 来源：`from: "项目 X commit abc1234"` 或 `from: "ui/login-pix-v1"`
- 高亮：用 `git diff --stat` 或对比来源后人类可读地写：
  - "顶部 hero 高度 600 → 480"
  - "主按钮颜色从蓝改成 pix 品牌橙 #f26b2f"
  - "新增底部 CTA fixed 区"

不要写"改了一些样式"这种没信息量的话。

## §自动调用约束（关键）

**execute 类 skill 必须在 SKILL.md 末尾包部 / 流程图终点显式写：**

> "完成后立即用 Skill 工具调用 `pm-summary` / `ui-summary`，把本次产出写入 meta.json 后才算结束。不写 meta = 任务没完成。"

不依赖 hook、不依赖 App 自动触发。**靠每个 execute skill 在自己的强约束里包部这一条**保证被调到。

## §更新而非新建

如果 `meta.json` 已存在（之前已生成过）：

1. Read 当前 meta
2. 比对本次新增 / 修改 / 删除的 deliverables
3. **追加**新 decisions（旧 decision 不动；除非用户明确说"撤回 D2"）
4. 更新 `lastUpdatedAt`
5. 在 `diff.highlights` 里加这次的关键变更（保留历史，不擦）

## §自检

写完 meta.json 后：

1. 所有 `deliverables[].path` 文件实际存在 → `ls -la` 确认
2. `topic` 跟 spec / design 文件名匹配
3. `scope.included` 不与 `excluded` 冲突
4. `diff.highlights` 至少有一条（除非 from = "initial"）
5. JSON 严格合法（没尾逗号 / 引号闭合）

不通过就修；不要交一份"先这样后面补"的草稿。
