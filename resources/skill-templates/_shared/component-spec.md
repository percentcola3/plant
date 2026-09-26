# 组件 / 产物共享规范

> 本文件是**组件和产物共用的结构规范**，适用于所有来源：外部转换（convert-component）、组件沉淀（distill）、AI 生成（build）、迭代修改（iterate）、组件调整（adjust-component）。
>
> 各 skill 文件通过 `§章节名` 引用本文件，不再独立复述规则。

---

## §UI 资产库优先级（颜色 / 组件 / 命名的来源顺序）

> **适用范围**：本规则不分 PM 项目 / UI 项目。**只要 `uiAssets[]` 非空，所有产出**——
> UI 项目的 outputs / components 自不必说，PM 项目里 pm-ui-execute 画的 mockup、
> pm-brainstorm 的图文设计 mockup、甚至 PRD 里嵌的视觉示意——**全部以资产库为中心**
> 复用主题、组件、产物，禁止任何"自由发挥"。

任何产出（生成 / 迭代 / 调整 / 转换 / mockup）选颜色 / 组件 / 命名时按以下优先级，**禁止跳级**：

1. **`uiAssets[]`（设计系统绝对权威）** —— `.workspace/project-context.json` 的 `uiAssets` 非空时，资产库就是**唯一事实源**：
   - **主题 / 颜色**：`rg -E "^\s*--" .external/<uikit-alias>/styles/*.css` 看暴露 token，按语义匹配。**禁止**自定义颜色值，**禁止**改 token 名。
   - **组件**：`ls .external/<uikit-alias>/components/` 看可用组件，**优先 `<link rel="import">` 复用**，不行再照着 DOM 结构 / 类名 1:1 抄。**禁止**重新发明已存在的组件。
   - **产物 / 模板**：资产库里有完整页面 / 区块模板（`.external/<uikit-alias>/outputs/` 或类似）就直接套用，调整数据，不重写视觉。
   - **命名**：组件名前缀（如 `dt-`、`sp-`）跟资产库一致，**禁止**自定义新前缀。

   **PM 项目同样适用**：PRD 配图 / mockup 不是"想象图"，是**用资产库拼出来的真实样子**。下游研发拿过去能直接对应组件，而不是"看个意思"。

2. **`$THEME` 主题 CSS 变量** —— 资产库没有匹配项才退回到本仓库 `<$THEME>` 暴露的变量（颜色 / spacing / 字体 / 阴影 / 圆角）。详见 §Scope 管理 §变量清单获取。

3. **组件自有变量 `--sp-<name>-*`** —— 控件特有尺寸（高度 / icon 尺寸 / 内 padding），且必须以 `--sp-<组件名>-` 前缀避免污染。

4. **占位 / TODO（兜底）** —— 上面三层都没匹配项，按 §防杜撰规则：标 `⚠️ 自定义` / `/* TODO-DS-GAP */` 注释 / 停下来问用户，**绝不**用 "通常 / 一般 / 默认就是" 之类措辞编造。

> **规则一句话**：先看 `uiAssets[]`、再看 theme、再看组件自有、最后才标 TODO 问。

### 何时该 fallback

- `uiAssets[]` 为空 → 直接从 step 2 开始（theme）
- 命中 `uiAssets` 但找不到匹配的 token / 组件 → 标 TODO，**禁止**直接套 theme 同义变量（设计系统的色阶 / 命名往往跟 theme 不一致）

### PM 项目特别提醒

PM 项目历史上把 mockup 当"概念示意图"，常出现"我用 #f26b2f 拍脑袋调一下"的情况。
**这一条彻底禁止**：

- 资产库定义了 brand 主色 → 用 brand 主色变量名，不写十六进制
- 资产库有 `<MethodSelector>` 组件 → mockup 直接 `<link rel="import">` 复用
- 资产库的 outputs 里有相似页面 → 复制改写，不重画

mockup 的可信度直接来自"研发能照搬"。研发看到 `var(--brand-primary)` 知道改哪、看到 hex 色就知道得重画——后者就是 PM 跟研发反复返工的根源。

---

## §Scope 管理

`components/scopes.json`（数组 `scopes[]`，每项含 `dir` / `label` / `theme`）是 scope 的**唯一权威源**。

- **禁止**硬编码 scope 名字（如 "common = B 端"）
- **禁止**在 skill / 组件文件里写出 scope 的具体名字作为判断条件
- 新增 / 重命名 scope → 改 JSON，skill 自动跟随

### 术语

```
$DIR       = scopes.json 中选定项的 dir（组件源目录名）
$THEME     = scopes.json 中选定项的 theme（仓库根相对路径，如 styles/saas/theme-g-one-b.css）
$BRAND     = $THEME 路径中 styles/ 后第一段（如 saas）
$THEME_REL = $THEME 去掉 styles/ 前缀（如 saas/theme-g-one-b.css）—— outputs/<slug>/index.html 的 <link href> 用这个
```

### theme 引用规则

- 组件 html（深度 = `components/<scope>/<name>/<name>.html`）写成 `../../../<$THEME>`（前补三层 `../`）
- 主题 CSS 自身已 `@import "./palette.css"`，组件**不要**再单独引 palette
- **禁止**写 `link styles/theme.css` 或 `link theme-light.css` 等已废弃路径

### 变量清单获取（必做）

scope 对应的主题暴露的变量名**大体一致**但部分阶梯数值不同，甚至个别 token 只在某一端存在。**禁止凭记忆套用**：

```bash
# 列出该 scope 主题真实暴露的全部 CSS 变量名
grep -E "^\s*--" styles/<brand>/palette.css <$THEME> | awk -F: '{print $2}' | sort -u
```

每写一个 `var(--xxx)` 之前，必须确认 `--xxx` 在此清单里出现过。

---

## §防杜撰规则（R1–R5）

> 转换 / 沉淀 / 生成都不是创作，是**忠实搬运或基于证据的组装**。源是唯一权威，产出不得新增、删减、修改源中明确存在或明确缺失的内容。

- **R1 — 不增 CSS 规则**：源中没有的 CSS 选择器、属性、声明，产出**禁止**新增。例外：① 把硬编码值替换为语义变量（等价改写，不算新增）；② 因自包含而必须 inline 的外部样式（须在文件顶部注释写明理由）。**禁止**「我觉得这里需要 hover 态」这类自由发挥。
- **R2 — 不增 DOM 属性**：源 DOM 节点上没有的 `aria-*` / `role` / `tabindex` / `data-*` / `type` / inline `style`，**禁止**自作主张补上。认为源漏了 a11y → 写到顶部注释的 Do/Don't 里，**不要**默默补上。
- **R3 — 不增不删 demo / section**：源有几个 section / demo 实例，产出必须**完全相同数量**。**禁止**为了"页面更丰富"加 demo，也**禁止**因"看起来重复"删 demo。
- **R4 — JS 行为 1:1**：源的每个事件绑定 / 状态切换 / DOM 操作 / aria 属性变化 / focus 处理，产出必须有等价实现。**禁止**漏 `aria-hidden` / `aria-expanded` 切换、focus 还原等细节。**禁止**新增源没有的行为。
- **R5 — 文案 / 标签逐字抄**：`<h2>` 文案、label、`aria-label`、按钮文字、tooltip 文字、占位文字必须**逐字与源一致**。例外只有 placeholder 段填实质 demo 时——填入语义化文字是允许的，但 section 标题、label、变体名仍按源照抄。

### 证据不足时的处理

任何引用必须来自以下证据：

1. 当前对话已 Read 的源文件（带具体路径）
2. `components/scopes.json` 中实际存在的项
3. `ls` 命令结果中确实存在的文件
4. `.workspace/project-context.json` 中配置的只读知识库命中内容

证据不足时只能：

- 标 `⚠️ 自定义` 或 `❌ 缺组件`
- 加 `/* TODO-DS-GAP */` 或 `/* NO-LIB: <语义> */`
- 保留 `<!-- ILLUS-SLOT: <场景> — 待填充 -->` 或 `<!-- ICON-SLOT: <语义> — 待填充 -->` 占位
- 停下来向用户提问

**禁止**使用 "通常""一般""应该""可能""推测""默认就是" 等措辞填补未知。

---

## §组件文件结构

### HTML 骨架

```html
<!--
  <name> — <一句话描述用途>

  变体：<variant1> / <variant2> / ...
  尺寸（如有）：<size scale>
  状态：<state list>

  ─── 必填 a11y ───
  • <来自源的 a11y 要点；无凭据时留 — 或 TODO，不编造>

  ─── Do / Don't ───
  • <核心使用规约（不超过 5 条）；无凭据时留 TODO，不编造>
-->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><name></title>
  <!-- 路径取自 scopes.json 中本 scope 的 theme，前补三层 ../  -->
  <link rel="stylesheet" href="../../../<$THEME>">

  <style data-bundle="component">
    /* ======================================================================
     * <name> — 组件样式（AI 复制此整个块到生成页面）
     *
     * 变量使用规则：
     *  1. 颜色 / 文字 / 边框 / 阴影 / 圆角 / 字体    → theme 语义变量
     *  2. 元素之间的布局间距（在 spacing 阶梯内）   → theme 语义变量（--space-*）
     *  3. 控件自有尺寸（高度 / 图标尺寸 / 内 padding）→ 组件自有变量 --sp-<name>-*
     *  4. 禁止 var(--x, <fallback>) 带兜底；禁止直接引用 palette 原子
     * ====================================================================== */

    /* 组件 CSS — 全部 sp-<name>-* 类 */
  </style>

  <style data-bundle="preview-chrome">
    /* 仅本预览页 chrome，AI 跳过此块 */
    /* 模板见 §Preview chrome 模板 */
  </style>
</head>
<body>

<!-- SVG sprite（如用到图标）— 紧挨 <body> 开头 -->
<svg class="preview-svg-defs" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <symbol id="<语义 id>" viewBox="0 0 48 48"><!-- 内联自 assets/icons/source/<file>.svg --></symbol>
  </defs>
</svg>

<!-- ① 主复制源（AI 通过 [MARKUP-VARIANT: <variant>] 边界提取） -->
<section class="preview-section">
  <h2 class="preview-section__title">Default · 主复制源</h2>
  <div class="preview-stack">
    <p class="preview-variant-label"><variant1></p>
    <!-- [MARKUP-VARIANT: <variant1>] -->
    <!-- DOM 放这里 -->
    <!-- [/MARKUP-VARIANT: <variant1>] -->
  </div>
</section>

<!-- ② 其他维度的演示 sections（按需） -->

<script data-bundle="component">
  /* 组件级 JS（如无交互则整块省略） */
</script>

<script data-bundle="preview-demo">
  /* 预览页演示用 JS，AI 跳过此块 */
</script>

</body>
</html>
```

### data-bundle 块职责

| 块 | 用途 | AI 复制行为 |
|---|---|---|
| `data-bundle="component"` | 组件 CSS | 整块内联到 outputs |
| `data-bundle="preview-chrome"` | 预览页 chrome 样式 | **跳过** |
| `data-bundle="component"`（script） | 组件 JS 行为 | 整块内联到 outputs |
| `data-bundle="preview-demo"` | 预览页 demo 联动 | **跳过** |

### MARKUP-VARIANT 规则

- 每个变体必须有完整边界对：`<!-- [MARKUP-VARIANT: <variant>] -->` ... `<!-- [/MARKUP-VARIANT: <variant>] -->`
- **禁止嵌套** MARKUP-VARIANT（会导致提取歧义）
- AI 生成页面时从 `[MARKUP-VARIANT]` 边界提取 DOM，不从其他位置复制

---

## §CSS 变量映射规则

### 三级映射

**第 1 级：直接通用的 theme token（保留不动）**

| 变量类别 | 示例 |
|---|---|
| 文字色 | `--text-primary / secondary / tertiary / disabled / on-dark` |
| 品牌色 | `--text-brand-default / hover / active`、`--color-brand-XX` |
| 语义色 | `--color-danger-XX / success-XX / warning-XX / info-XX` |
| 表面色 | `--color-surface / bg-muted / border-control / border-default / border-hover / border-strong / divider-default` |
| 字重 | `--font-weight-regular / medium / bold / extrabold / button-bold` |
| 字体 | `--sp-font-family-sans` |
| 阴影 | `--shadow-card / dropdown / float / focus-brand` |
| 层级 | `--z-*` |

**第 2 级：字面量 → theme 语义变量**

| 字面量 | 替换为 | 适用场景 |
|---|---|---|
| `4px` | `var(--space-component-inner-xs)` | 紧邻图标 / 徽标偏移 |
| `8px` | `var(--space-component-inner-sm)` | icon ↔ 文本、行内分隔 |
| `12px` | `var(--space-component-inner-md)` | 同组控件中等分隔 |
| `16px` | `var(--space-module-inner)` | 模块内子元素间距、控件 padding-x |
| `20px` | `var(--space-title-to-content)` | 标题→内容 |
| `24px` | `var(--space-region-pad)` | 区域 / 模块间距 |
| `font-size: 12/14/16/18/20/24/32px` + 对应 line-height | `var(--text-{caption/body-default/body-large/title-sm/title-md/title-lg/title-display}-{size,line})` | 按字号阶梯映射 |
| `border-radius: 4/8/16px` | `var(--radius-{sm/control/s/container/l})` | 圆角阶梯 |

> **决策原则**：数值在 spacing / typography 阶梯内 → 用 theme 语义变量；不在阶梯内（如 `6px` 图标-文本紧贴）→ 留作组件自有变量。

**第 3 级：组件级变量 `--sp-<comp>-*`**

- **控件自有尺寸**（高度 / 图标尺寸 / 内边距）→ 声明为 `--sp-<comp>-XXX`
- **变量声明位置必须与使用范围一致**：
  - 仅 `.sp-<comp>` 容器内部使用 → 声明在 `.sp-<comp> { ... }` 头部
  - 子元素单独使用 → 声明在该子元素自己的规则头部，让 svg / 内嵌元素通过继承拿到

### 硬禁令

- **禁止 `var(--x, <fallback>)` 兜底写法**：每个变量必须在文件内可查到来源
- **禁止直接引用 palette 原子**：`--orange-6` / `--grey-3` 等
- **禁止裸色值**：`#xxx` / `rgb()` / `rgba()` / `hsl()` / `hsla()` / 命名色
- **禁止**「望文生义」的变量名（如 `--radius-control` / `--text-md`），必须用 §Scope 管理中 grep 出的实际变量名
- 命名规范：变量前缀与组件类前缀完全一致（如 `--sp-btn-*` → `--sp-button-*`）

### 变量核销命令

```bash
# 列出产出文件引用的所有变量
grep -oE "var\(--[a-z0-9-]+\)" <文件> | sort -u
# 逐个比对 §Scope 管理中 grep 出的主题变量清单
# 任一在清单外的变量名（除组件自有 --sp-<name>-* 外）都是 bug
```

---

## §图标处理规则

> **唯一权威源：`assets/icons/`**。所有组件用到的 SVG 必须从这里取。

```
assets/icons/
├── source/                      # .svg 原文件（视觉真理）
├── registry/icon-registry.json  # { id, name, aliases, designName, path, category }
└── usage-rules.md               # 命名规范 + 复用优先级
```

### 选图：按语义查 registry

不要根据 inline SVG 路径去猜文件名——那些 path 是字体生成的几何，跟设计师起的名字无关联。

1. 用 `aliases` / `name` / `category` 在 `icon-registry.json` 里找最贴切的 id
2. `-01-filled`：单色填充，整张图标用 `currentColor` 着色
3. `-02-filled`：双色填充（白底圆 + 主题色 glyph），用于浅底 alert / toast 等需要"白底圆 + 彩色符号"组合的场景
4. `-outlined`：线条态，多用于操作按钮内的 16/20px 小图标

### 内联：sprite + `<use>` 模式

把选中的 SVG 内容（去掉外层 `<svg>` 标签，只保留内部 `<g>` / `<path>` / `<rect>` / `<ellipse>`）作为 `<symbol>` 放进 body 顶部的 sprite 块，DOM 引用 `<use href="#<id>" />`。

- 所有 `<symbol>` 必须带 `viewBox="0 0 48 48"`（design-asset 标准画布）
- sprite 块**必须紧挨 `<body>` 开头**
- CSS `.preview-svg-defs { position: absolute; width: 0; height: 0; overflow: hidden; }` 隐藏

### 颜色：currentColor 化

**单色图标**：把唯一的 `fill="#XXXXXX"` **全部**替换成 `fill="currentColor"`，组件 CSS 用 `color:` 控制：

```css
.sp-<name>__icon { color: var(--text-secondary); }
.sp-<name>--success .sp-<name>__icon { color: var(--color-success-6); }
```

**双色图标**：`#FFFFFF`（白底圆）保持不变，glyph 主色（`#26BF66` / `#FF8C19` 等）保留原值——不要改成 currentColor，否则两层会同色塌陷。

提取命令：

```bash
perl -0777 -ne 'if(/<svg[^>]*>(.*)<\/svg>/s){$c=$1; $c=~s/fill="#8A8A91"/fill="currentColor"/g; print $c}' \
  assets/icons/source/<file>.svg
```

### 命名：sprite id 用语义名

文件叫 `action-close-01-outlined.svg`，sprite id 起 `alert-close` / `drawer-close` / `select-clear` 等"组件 + 用途"语义名。换图标实现时只需改 sprite，不动 DOM。

---

## §跨组件 mirror

当组件预览页通过 `<link>` 引入别的组件 CSS（如 sp-drawer 用到 sp-button）时，要把**整个**依赖组件的 `<style data-bundle="component">` 块**原文 mirror** 到本组件 `<style data-bundle="preview-chrome">` 块里，并加同步注释：

```css
/* ====== 协同样式 mirror：<dep> data-bundle="component" 完整块 ======
 * 整段镜像自 components/<scope>/<dep>/<dep>.html 的
 * <style data-bundle="component"> 块。
 *
 * <dep> 升级时，重新执行：
 *   awk '/<style data-bundle="component">/{f=1; next} /<\/style>/&&f{exit} f' \
 *     components/<scope>/<dep>/<dep>.html
 * 把输出粘贴回这里替换。
 * ============================================================ */
```

**不要写 stub**（手写最小子集）—— stub 总会漏边角细节，且与上游不同步时无法察觉。整段 mirror 体积大但保真，AI 生成真实页面时这块完全跳过，零成本。

---

## §Atom 复用

复合组件（sp-form / sp-modal / sp-table / sp-drawer / sp-popconfirm 等）内嵌按钮、输入、复选、tag、分页这些已有 atom 时：

- DOM 里**直接写** `<button class="sp-button sp-button--primary">` / `<input class="sp-input">` 等已有 atom 类名
- **禁止**自造 `.sp-<name>__btn` / `.sp-<name>__input` 等"包装"类
- 样式来源：靠 §跨组件 mirror 拉到 atom 的整段 CSS
- JS 行为：靠 mirror 拉到 atom 的 `<script data-bundle="component">`，事件代理自动接管
- 复合组件**自有 class**只负责本组件特有的容器 / 布局 / 间距，**严禁覆写 atom 视觉**
- **例外**：组件本质上是该 atom 的特例化封装且有充分理由不复用（如 sp-pagination 的页码按钮跟 sp-button 视觉规则就是不同），须在顶部 Do/Don't 里明确说明"为什么不用 atom"

---

## §Preview chrome 模板

可直接拷入新组件的 `<style data-bundle="preview-chrome">` 块：

```css
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  padding: var(--space-32);
  font-family: var(--sp-font-family-sans);
  font-size: var(--text-body-default-size);
  line-height: var(--text-body-default-line);
  background: var(--color-bg-muted);
  color: var(--text-primary);
}
h1.preview-title {
  margin: 0 0 var(--space-region-pad);
  font-size: var(--text-title-lg-size);
  font-weight: var(--font-weight-bold);
  line-height: var(--text-title-lg-line);
}
section.preview-section {
  background: var(--color-surface);
  border-radius: var(--radius-l);
  padding: var(--space-region-pad);
  margin-bottom: var(--space-module-inner);
}
h2.preview-section__title {
  margin: 0 0 var(--space-module-inner);
  font-size: 13px;
  font-weight: var(--font-weight-bold);
  line-height: 18px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}
.preview-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-component-inner-md);
  max-width: 720px;
}
.preview-variant-label {
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  line-height: 16px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  margin: 0 0 var(--space-component-inner-xs);
}
.preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-module-inner);
  align-items: flex-end;
}
.preview-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-component-inner-xs);
  min-width: 0;
}
.preview-item__label {
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  line-height: 16px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
}
.preview-states-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-region-pad) var(--space-32);
  align-items: flex-end;
}
.preview-state {
  display: flex;
  flex-direction: column;
  gap: var(--space-component-inner-xs);
  align-items: flex-start;
}
.preview-state__label {
  font-size: 11px;
  font-weight: var(--font-weight-medium);
  line-height: 16px;
  color: var(--text-tertiary);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.preview-demo {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-component-inner-md);
  align-items: flex-start;
  padding: var(--space-region-pad);
  background: var(--color-surface);
  border-radius: var(--radius-l);
}
.preview-svg-defs {
  display: none;
  width: 0;
  height: 0;
  position: absolute;
  overflow: hidden;
}
```

> 如源组件 demo 用了别的 `preview-*` 子类（如 `.preview-group`），按相同风格补一行即可。

---

## §自检清单

### A. 防杜撰核销（最高优先级）

> 输出前必须逐条核销，差异必须有 R1–R5 之外的明确理由。

- [ ] **CSS 规则数核销 (R1)**：逐条对照源，确认产出**没有源里不存在的选择器或属性**
- [ ] **DOM 属性核销 (R2)**：抽样 3 个 demo 实例，逐字段对比 `aria-*` / `role` / `tabindex` / `data-*` / `type` / inline `style`
- [ ] **demo / section 计数核销 (R3)**：源有 N section / K demo，产出 N / K 必须完全相等
- [ ] **JS 函数 / 行为核销 (R4)**：源的每个事件绑定 / aria 切换 / focus 还原都有等价实现
- [ ] **文案逐字核销 (R5)**：抽 5 处源文案与产出逐字对比

### B. 实现层自检

- [ ] **变量名核销**：`grep -oE "var\(--[a-z0-9-]+\)" <文件> | sort -u` 的每个变量名都能在主题清单里找到（除组件自有 `--sp-<name>-*`）
- [ ] **图标核销**：`grep -oE 'href="#[^"]+"' <文件> | sort -u` 的每个 `#xxx` 都能在 sprite 块里找到 `<symbol id="xxx">`，且 symbol 来自 `assets/icons/source/`
- [ ] **文件路径正确**：`components/<scope>/<name>/<name>.html`，`<scope>` 来自 `scopes.json`
- [ ] **`<link>` 仅一行**：`<link rel="stylesheet" href="../../../<$THEME>">`；无废弃路径残留、无外部 CDN、无单独引 palette
- [ ] **顶部注释完整**：变体清单 + a11y + Do/Don't
- [ ] **component 块规范**：
  - 无 `var(--x, <fallback>)` 写法
  - 无 palette 原子直引
  - 无裸色值
  - 颜色 / 文字 / 圆角 / 阴影 / 字体 用 theme 变量
  - spacing 阶梯内的间距用 `--space-*`
  - 控件自有尺寸在 `.sp-<name> { ... }` 头部声明
  - 只用 `sp-<name>*` 选择器（**禁止** `preview-*` 出现在此块）
- [ ] **preview-chrome 块规范**：只用 `preview-*` 前缀类（**禁止** `sp-*` 出现在此块）
- [ ] **MARKUP-VARIANT**：每个变体有完整边界对；**无嵌套**
- [ ] **atom 复用**：复合组件内的按钮 / 输入 / 复选等直接用已有 atom 类名
- [ ] **无残留**：无 `--sp-variables` / `tokens-compiled` / `<comp>.bundle.css` / `theme-light.css` / `styles/theme.css` 等源仓库路径或已废弃文件名

### C. 自检命令（build / deliver 共用）

```bash
# [V1] 字号阶梯（期望：每个值都 ∈ {12,14,16,18,20,24,32}）
grep -oE 'font-size:\s*[0-9]+px' outputs/<SLUG>/index.html | sort -u

# [V2] 图标保真（期望：无输出）
grep -nE 'class="[^"]*sp-[a-z-]+__icon[^"]*"[^>]*>[^<]+<' outputs/<SLUG>/index.html

# [V3] 无外部 CDN（期望：仅返回注释或 SVG xmlns）
grep -nE 'https?://' outputs/<SLUG>/index.html

# [V4] 无裸色值（期望：仅在 canvas-lock 模板里出现，业务 outputs 应无输出）
grep -nE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' outputs/<SLUG>/index.html

# [V5] 无 palette 原子直引（期望：无输出）
grep -nE 'var\(--(orange|grey|gray|red|blue|green|yellow|purple|cyan)-[0-9]+' outputs/<SLUG>/index.html

# [V6] 无 var() fallback 兜底（期望：无输出）
grep -nE 'var\(--[a-z0-9-]+\s*,' outputs/<SLUG>/index.html

# [V7] sp-* class 已使用，但 components/$DIR 中无对应目录（期望：无输出）
for c in $(grep -oE 'sp-[a-z-]+' outputs/<SLUG>/index.html | sort -u); do
  [ ! -d "components/$DIR/$c" ] && [ ! -d "components/business/$c" ] && echo "MISSING: $c"
done
```

### D. 保真核销报告模板

完成后必须按此格式回报：

```
保真核销：
- 源 N section / M demo / K CSS规则 / J JS 函数
- 产出 N section / M demo / K' CSS规则 / J' JS 函数
- 差异（每处都标注理由 R1–R5 / 等价语义化 / 自包含 inline / placeholder 实质化）：
  · [处1] ...（理由：...）
  · ...无差异则写"无"

自检：
- vars: ✓ / ✗ + 缺失项
- placeholder: ✓ / ✗ + 残留数
- sprite: ✓ / ✗
- chrome 命名: ✓ / ✗
- atom 复用: ✓ / ✗
```
