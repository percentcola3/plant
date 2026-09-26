---
name: ui-brainstorm
description: >-
  这个 skill 是 UI 项目"从视觉/布局/组件结构想法到设计稿"的脑暴入口（任何创造性工作前必走），含图片还原模式。
  **不是落地 HTML 的**（写 outputs 走 ui-execute）、**不是组件沉淀的**（DOM 抽组件走 ui-distill）、
  **不是写 meta.json 的**（产物总结走 ui-summary）。
  触发词：脑暴、需求澄清、想做、要做、做设计、做方案、画方案、看图还原、按这张图做、UI 设计、视觉方案。
---

# ui-brainstorm：UI 设计脑暴

> 通用流程骨架在 **`../_shared/brainstorm-core.md`**，本 SKILL.md 给出 UI 项目的差异点：spec 落点、视觉风格模板、图文设计 HTML 协议、图片还原。

## 启动横幅（必出）

回复正文**第一行**：

```
------- 开始执行 ui-brainstorm skill ------
```

第二行：`本轮模式：<从 0 设计 / 图片还原 / 跨项目复制改造>（理由：...）`

未输出 = 未进入。

## 必读

进入 skill 后**立即**：

1. Read `../_shared/brainstorm-core.md` —— HARD-GATE / 9 步清单 / 图文设计判定 / git 收尾
2. Read `../_shared/templates/ui-design-template.md` —— 视觉风格设计稿骨架
3. （视觉问题时）Read `../_shared/templates/visual-companion-html.md` —— mockup HTML 协议

本文件只补 UI 项目特有的差异。

## §UI 差异 1：spec 落点

设计文档落 **`ui/<topic-slug>/design.md`**（不是 PM 项目的 `docs/<topic-slug>/`——UI 项目以"领域"为中心，每个产物同目录下放 design.md + mockup HTML + outputs）。

`<topic-slug>` = kebab-case 短名，跟后续 `outputs/<slug>/` / `components/<scope>/<name>/` 对齐，方便研发查找。

## §UI 差异 2：图文设计

完整协议在 `../_shared/templates/visual-companion-html.md`。

文件落点：

```
ui/<topic-slug>/
  ├── .transient/
  │     ├── q-1-layout.html      # 决策伴侣（选完即废，不算最终产物）
  │     └── q-2-cta-style.html
  ├── m-1-final.html             # 最终视觉稿（M 系列）
  ├── m-2-detail.html
  └── design.md                  # 最终设计稿（脑暴产出）
```

**重要——产物边界**：
- 决策类 HTML（q-*.html）是为了帮用户做选择的临时工具，落到 `.transient/` 子目录，**不算 UI 产物**。
- 最终的视觉稿才是 UI 产物（命名 `m-*.html` 或 `final-*.html`），用户在 App 里看到的"UI 设计稿"索引页**只列 M 系列**，决策稿不进索引。
- summary 阶段（`ui-summary`）的 `deliverables[]` **不要**收录 q-*.html。

## §UI 差异 2.1：UI 脑暴必做的三类 discovery

`../_shared/brainstorm-core.md §1` 已要求 rg 工作区 + kbRefs；UI 项目在那基础上**补两类必做检查**：

| 检索目标 | 命令 | 用途 |
|---|---|---|
| 工作区既有 outputs / components | `rg -li "<关键词>" outputs/ components/ ui/` | 视觉一致性对齐基准 |
| **UI 资产库（uiAssets[] 非空时）** | `ls .external/<uikit-alias>/` + `rg -li "<组件名候选>" .external/<uikit-alias>/` | 颜色 / 组件 / 命名权威源 |
| 知识库代码（kbRefs[] 非空时） | `rg -li "<业务关键词>" .external/<kb-alias>/` | 已上线代码反推视觉意图 |

**资产库取用规则**不在这里展开 —— 见 `../_shared/component-spec.md` §UI 资产库优先级（同一份规则跨 PM/UI 复用）。

### 写入 design.md（脑暴是否完成的判定标准）

设计稿 §3（布局结构）/ §4（关键组件清单）/ §5（视觉风格）必须**显式引用**命中文件的相对路径：

> "参考工作区既有实现：`outputs/<slug>/index.html` §hero 区"
> "颜色 token 来自 `.external/<uikit-alias>/styles/palette.css`"
> "类似业务流程见 `.external/<kb-alias>/<path>.vue` 的 `<MethodSelector>`"

设计稿里**没有任何引用** = 脑暴没探索（除非确认 kbRefs / uiAssets / 工作区都是空的，明确告诉用户"裸奔生成"风险）。
## §UI 差异 3：图片还原子模式

参见 `../_shared/brainstorm-core.md` §10。补充 UI 特有：

- **图片入工作区** —— 让用户告诉路径或贴 base64；放 `ui/<topic-slug>/source.<ext>` 保留作设计参考
- **AI 画图 = ASCII 线框 + 文字描述**——不要用真 HTML 还原，第一轮先确认理解
- **用户确认后**才进入 `ui-execute` 模式 A（生成）跑实际 HTML 还原
- 在 `ui/<topic-slug>/design.md` 的"起源"段写 "源图：source.<ext>"

不要看图就直接 build outputs。

## §收尾

`../_shared/brainstorm-core.md` §9 git 收尾通用。语义化 commit message：

```
docs(ui-<topic-slug>): 新增 <topic> UI 设计稿
```

移交时调 `ui-execute`（默认）或 `ui-distill`（如果是组件沉淀场景）。

## 触发后必做的第一条任务

```
1. Read ../_shared/brainstorm-core.md
2. Read ../_shared/templates/ui-design-template.md
3. 输出启动横幅 + 模式判定
4. TaskCreate × 9（对应 §9 步清单）
5. 开始 §1 探索项目上下文
```
