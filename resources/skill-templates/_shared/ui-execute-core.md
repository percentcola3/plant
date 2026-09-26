---
name: ui-execute
description: >-
  UI 项目落地执行：生成新页面 / 迭代修改 / 元素调整 / 源组件引入 / 画布重置，全部走同一份 §UI 约束。
  触发词：生成页面、做一个页面、画个页面、画方案、interaction、create page、迭代修改、页面调整、调整组件、修改组件、引入组件、转换组件、convert component、画布固定、固定画布、reset canvas。
  注意：组件沉淀（DOM / 区域抽组件）不在本 skill，走 ui-distill。
---

# ui-execute：UI 落地执行

> **前置门禁**：进入本 skill 前必须先走 `ui-brainstorm` 拿到设计稿；用户已有 brainstorm spec 文档作为输入直接进的可以直接进。
> **后置门禁**：每次执行结束**必须**调用 `ui-summary` 写 meta.json，否则任务没结束。

## 启动横幅（必出，否则视为未进入本 skill）

回复正文**第一行**输出：

```
------- 开始执行 ui-execute skill ------
```

第二行输出：`本轮模式：<生成 / 迭代 / 调整 / 源组件引入 / 画布重置>（理由：...）`

未输出 = 未进入；禁止任何 Read / Edit / Write / Bash 后续动作。

## 五种模式

| 模式 | 触发条件 | 输入 | 产出 |
|---|---|---|---|
| **生成** | 全新页面 / 全新组件 / outputs 还没东西 | brainstorm spec → 实施 | `outputs/<slug>/index.html` 或 `components/<scope>/<name>/<name>.html` |
| **迭代** | 已有 `outputs/<slug>/index.html`，做"页面级"调整 | 当前 HTML + 用户指令 | 改 HTML，原文件就地保存 |
| **调整** | 改 `components/**` 下已存在组件 | 组件路径 + 修改诉求 | 改 HTML（**先查依赖再决定是否同步影响项**）|
| **源组件引入** | `~/Downloads/design-asset/components/<name>/` 有源组件想转进本仓库 | 源目录 | `components/<scope>/<name>/<name>.html` 单文件包 |
| **画布重置** | outputs 杂乱了想从空白画布重新画 | `outputs/<slug>/index.html` | 重置为标准 1440×900 空白画布（不与任何 checkpoint 链耦合）|

不要在一轮里跨多个模式。**先决定模式，再走流程**。

## 共用约束

UI 项目所有产出（生成 / 迭代 / 调整 / 源组件转换 / 沉淀）都遵循同一份**约束总集**：

> **见 `_shared/component-spec.md`**——CSS 变量映射 / 图标处理 / 防杜撰 R1-R5 / Atom 复用 / 自检清单。

跨模式的术语和 scope 管理规则也在该文件 §Scope 管理 / §术语 段。**禁止**在本 SKILL.md 复述，避免跟 `_shared/component-spec.md` 漂移。

## 模式 A：生成

**输入**：brainstorm 已写好 `ui/<topic>/design.md`。

**步骤**：

1. Read `ui/<topic>/design.md` 拿到选定方案、视觉风格、布局结构、关键组件清单
2. Read `../_shared/component-spec.md` 全文（约束 + scope + 防杜撰）
3. **对齐既有实现（必做，不可跳过）**——动笔前确认有哪些可用基准：

   ```bash
   ls outputs/                                          # 看现有 SLUG 列表
   rg -li "<业务关键词>" outputs/ components/            # 工作区相似页面 / 组件
   rg -li "<组件名候选>" .external/<uikit-alias>/         # UI 资产库（uiAssets[] 非空时）
   rg -li "<业务关键词>" .external/<kb-alias>/            # 业务知识库（kbRefs[] 非空时）
   ```

   命中即取：工作区 outputs/components 取视觉风格 / 间距 / atom 复用；资产库取颜色 token / 组件命名 / 产物模板；kbRefs 反推业务交互细节。**取用优先级 + 禁止自创规则**见 `../_shared/component-spec.md` §UI 资产库优先级（不在这里复述）。

   设计稿 §3 / §4 已有引用 → 按引用读取并对齐；没有引用且本步搜不到东西 → 跟用户讲"裸奔生成"风险，让用户决定是继续还是回 ui-brainstorm 补 discovery。

4. 决定 SLUG（kebab-case，如 `pos-order-page`）
5. 决定 scope（从 `components/scopes.json` 选；不存在的 scope 先和用户确认是否新增）
6. 写 `outputs/<SLUG>/index.html`：
   - DOCTYPE + html lang + meta viewport
   - `<link rel="stylesheet" href="../../styles/$THEME_REL">`（路径来自 `../_shared/component-spec.md` §术语）
   - body 内按 design.md 的布局拼装；可复用的 atom / 组件直接 `<link>` 现有 components/
   - 颜色 / 间距 / 圆角 / 阴影按 §UI 资产库优先级链取值
7. 自检（见 `../_shared/component-spec.md` §自检清单）
8. 调 `ui-summary` 写 meta.json，`decisions[]` 必须列出**本次引用了哪些既有文件**（outputs / components / external 路径）

## 模式 B：迭代

**输入**：用户指着已有 `outputs/<SLUG>/index.html` 提改动诉求。

**步骤**：

1. Read 当前 HTML
2. Read `_shared/component-spec.md` §防杜撰 R1-R5（迭代时最容易"擅自加 class / 删 class / 改变量"）
3. 改动**只**在用户指出的范围内（"@A 卡片底部加按钮"——只改 @A 内部，别动外面）
4. 不知道要不要联动改的地方，先**问一句**再动
5. 自检
6. 调 `ui-summary`

**禁止**：迭代里"顺手"重命名变量、重排 class、调整未提及的间距等。

## 模式 C：调整组件

**输入**：用户指着已存在 `components/<scope>/<name>/<name>.html`。

**先查依赖再改**：

1. `rg "<name>" outputs/ components/ -l` 看哪些产物 / 其它组件引用了这个
2. **明确**告诉用户："改这里会影响 outputs/X / outputs/Y / components/Z"
3. 用户确认 "全部跟着改" 或 "只改组件本身，产物保留旧版" → 决策
4. 按决策改组件 + 必要的同步项
5. 自检
6. 调 `ui-summary`

未做依赖检索就改 = 违规。

## 模式 D：源组件引入

**输入**：`~/Downloads/design-asset/components/<name>/` 下有源组件目录，含 HTML / CSS / 图标资源等。

**步骤**：

1. 读源目录全文件，理解结构
2. Read `_shared/component-spec.md` §转换规则（CSS 变量映射 / 图标处理 / 单文件包形态）
3. 决定 scope（同模式 A）
4. 产出**单文件包** `components/<scope>/<name>/<name>.html`：
   - CSS 内联到 `<style>` 段，外部变量替换为 `_shared/component-spec.md` 规定的 CSS 变量
   - 图标按 §图标处理 处理（base64 / SVG inline）
   - 防杜撰 R1-R5：源里没有的 class 不要加；源里有的语义化 attr / aria-* 保留
5. 在 `outputs/_temp-preview-<name>/index.html` 单独产出一个独立预览页（不放主 outputs 列表）
6. 自检
7. 调 `ui-summary`（在 meta.json 的 `diff.from` 写 "源：~/Downloads/design-asset/components/<name>"）

## 模式 E：画布重置

**输入**：用户说"画布固定 / 固定画布 / 回到初始画布 / canvas lock"。

**步骤**：

1. 重写 `outputs/<SLUG>/index.html` 为标准 1440×900 空白画布：
   ```html
   <!DOCTYPE html>
   <html lang="zh-CN"><head>
     <meta charset="utf-8">
     <title><SLUG> · 画布</title>
     <link rel="stylesheet" href="../../styles/$THEME_REL">
     <style> body { margin: 0; min-width: 1440px; min-height: 900px; } </style>
   </head><body></body></html>
   ```
2. 不要保留任何之前的内容
3. **不调** `ui-summary`（画布重置不是一次完整产出）

## 通用流程（所有模式）

进入 skill 后**用 TaskCreate 建任务**：

1. 模式判定 → 输出启动横幅第二行
2. 探索：Read `_shared/component-spec.md`，按模式 Read 输入文件 / 依赖文件
3. 执行：Edit / Write 产出
4. 自检：见 `_shared/component-spec.md` §自检清单
5. 调 `ui-summary`：见下面"收尾"

## 收尾（必做）

**完成后立即用 Skill 工具调用 `ui-summary`**，把本次产出写入 `ui/<topic>/meta.json`。**不写 meta = 任务没完成**。

调用前需要准备的信息：

- topic / title
- 本次产出文件清单（路径 + 一句话摘要）
- 关键决策 2-3 条（为什么用 scope X、为什么这个布局、为什么这个组件）
- 待确认问题（如有）
- 跨版本 diff（模式 D 必填；其它模式视情况）

## 触发后必做的第一条任务

```
TaskCreate × 5（按模式定制具体步骤名）
```

然后 Read `_shared/component-spec.md`，开始模式判定。
