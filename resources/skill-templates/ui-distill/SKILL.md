---
name: ui-distill
description: >-
  这个 skill 是 UI 项目"把 outputs 已有 DOM / 框选区域抽取为 components/ 单文件包"的组件沉淀入口。
  **不是从 0 设计组件的**（新组件走 ui-execute 模式 A）、**不是源组件库引入的**（源转换走 ui-execute 模式 D）、
  **不是改已有组件的**（调整走 ui-execute 模式 C）、**不是写 meta.json 的**（产物总结走 ui-summary）。
  触发词：沉淀组件、抽成组件、提取组件、distill。
---

# ui-distill：组件沉淀

<EXTREMELY_IMPORTANT>
**前置**：用户已经在 `outputs/<SLUG>/index.html` 框出一段 DOM 准备沉淀；或 HTML 里有 `<!-- DISTILL-START: <comp-name> --> ... <!-- DISTILL-END -->` 标记。
**后置门禁**：完成后**必须**调用 `ui-summary` 写 meta.json，并提供 `selfCheck.items[]`。
</EXTREMELY_IMPORTANT>

## 启动横幅（必出）

```
------- 开始执行 ui-distill skill ------
```

未输出 = 未进入。

## 必读

进入 skill 后**立即** Read `../_shared/component-spec.md`。CSS 变量映射 / 图标处理 / 防杜撰 R1-R5 / Atom 复用 / 单文件包形态 / 自检清单全在那里。**禁止**在本 SKILL.md 复述。

## 流程

### 步骤 1：识别边界

来源有两条路：

- **A 路：标记法** —— outputs HTML 里有：
  ```html
  <!-- DISTILL-START: pix-cta-card -->
  <div class="...">...</div>
  <!-- DISTILL-END -->
  ```
  → 直接拿 START / END 之间的 DOM
  
- **B 路：用户用 inspector 拾取了根元素** —— 通过 brainstorm / 图文设计 / inspector 已确认：
  - 根 DOM = `@A`（cssPath 已知）
  - 边界包含哪些子元素（用户已确认）

不要用其它方式猜边界（"我觉得这块是个按钮"——不是，问用户）。

### 步骤 2：决定 scope + 命名

- scope = `components/scopes.json` 中选定项的 `dir`（见 `../_shared/component-spec.md` §Scope 管理）
- 组件名：kebab-case，前缀视 scope 而定
  - 通用 atom / 业务无关 → `sp-<name>`
  - 业务专属 → `biz-<name>` 或不带前缀（看 scope 约定）

不确定的去问用户，**禁止**自己拍。

### 步骤 3：产出单文件包

落点：`components/<scope>/<comp-name>/<comp-name>.html`

单文件包形态见 `../_shared/component-spec.md` §单文件包形态。

### 步骤 4：替换 outputs 里的副本

回到原 `outputs/<SLUG>/index.html`：

- 把刚抽出来的 DOM 段替换为 `<link rel="import" href="../../components/<scope>/<comp-name>/<comp-name>.html">`（或本仓库实际复用机制）
- 移除 DISTILL-START / DISTILL-END 标记
- 视觉自检：复用后的 outputs 渲染应该跟之前**完全一样**（CSS 变量映射对，图标在场，间距没变）

### 步骤 5：自检

按 `../_shared/component-spec.md` §自检清单逐条过。生成 `selfCheck.items[]` 数组（每项 id / passed / note）：

- [ ] CSS 变量都在 component-spec 允许列表里
- [ ] 图标按规则处理
- [ ] 防杜撰 R1-R5 全过
- [ ] 单文件包独立可预览（直接 open 浏览器能看）
- [ ] outputs 替换后视觉不变

### 步骤 6：调 `ui-summary`

**必做**：写 `ui/<topic>/meta.json`，重点字段：

- `deliverables` 加 `components/<scope>/<comp-name>/<comp-name>.html`
- `decisions` 写为什么选这个 scope / 这个命名
- `diff.from` 填 "outputs/<SLUG>/index.html"，`diff.highlights` 写"抽组件 → 替换为 import"
- `selfCheck.items[]`：步骤 5 的结果

不写 meta = 任务没完成。

## 何时**不要**用本 skill

- 全新组件从零设计 → `ui-execute` 模式 A
- 改已存在组件 → `ui-execute` 模式 C
- 源组件库引入 → `ui-execute` 模式 D

ui-distill 只处理 **outputs 已有 DOM → 提炼为 reusable component** 这一种场景。

## 触发后必做的第一条任务

```
1. Read ../_shared/component-spec.md
2. 输出启动横幅
3. TaskCreate × 6（对应步骤 1-6）
4. 步骤 1：识别边界
```
