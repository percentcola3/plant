# 图文设计 HTML 模板

> `pm-brainstorm` / `ui-brainstorm` 在视觉问题节点写 mockup HTML 用这个模板。
> 落点：`ui/<topic-slug>/.transient/q-<n>-<question>.html`（PM 项目同样落 ui/，方便预览）。
>
> 决策伴侣放 `.transient/` 子目录——它们不算 UI 产物，summary 阶段不收录。

## 单选模板

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>登录页布局选择</title>
<style>
  body { margin: 0; padding: 24px; font-family: -apple-system, "Helvetica Neue", sans-serif; background: #f8fafc; }
  h2 { margin: 0 0 6px; font-size: 18px; }
  .hint { margin: 0 0 18px; color: #64748b; font-size: 13px; }
  .options { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
  .option {
    background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
    padding: 16px; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  }
  .option h3 { margin: 0 0 8px; font-size: 15px; }
  .option .desc { margin: 0 0 12px; color: #64748b; font-size: 12px; line-height: 1.5; }
  .wireframe {
    background: #f1f5f9; border-radius: 6px;
    aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center;
    color: #94a3b8; font-size: 11px;
  }
</style>
</head>
<body>
  <h2>登录页布局更倾向哪种？</h2>
  <p class="hint">在 App 右侧预览面板里点选项确认；想看更多细节就点 "@" 拾取元素继续追问。</p>

  <div class="options">
    <div class="option" data-uikit-choice="a" data-uikit-choice-text="单列居中，简洁">
      <h3>A. 单列居中</h3>
      <p class="desc">表单居中，背景留白，最聚焦的方案。</p>
      <div class="wireframe">[wireframe: 单列]</div>
    </div>
    <div class="option" data-uikit-choice="b" data-uikit-choice-text="左图右表，营销性">
      <h3>B. 左图右表</h3>
      <p class="desc">左侧大图 / 营销文案，右侧表单，适合需要内容引流的页面。</p>
      <div class="wireframe">[wireframe: 左图右表]</div>
    </div>
    <div class="option" data-uikit-choice="c" data-uikit-choice-text="顶部 hero + 下方表单">
      <h3>C. 顶部 hero</h3>
      <p class="desc">上半屏 hero banner，下半屏表单，强势表达品牌。</p>
      <div class="wireframe">[wireframe: hero + 表单]</div>
    </div>
  </div>
</body>
</html>
```

## 多选

容器加 `data-uikit-multiselect`：

```html
<div class="options" data-uikit-multiselect>
  <div class="option" data-uikit-choice="a" data-uikit-choice-text="...">...</div>
  ...
</div>
```

行为：点选项变 toggle（蓝色 outline + ✓），第一次 toggle 后容器底部自动注入"确认选择（N 项）"按钮，点确认 → 一次性 paste "我选 A、C：xxx / yyy" 到 Claude Code。

**何时用多选**：用户可能同时倾向多个方向（"喜欢 A 的简洁 + C 的视觉冲击"）。问"做什么风格"互斥的题不要用多选。

## 数据约定

- `data-uikit-choice="<key>"`：选项标识，约定 `a/b/c/d`（点击后变大写："我选 A：xxx"）
- `data-uikit-choice-text="<label>"`：选项摘要文本（可选，会兜底用 `<h1-h6>` textContent 或 textContent 截 60 字）
- 元素本身可以是任意结构——卡片、按钮、缩略图都行；inspector 用 `closest('[data-uikit-choice]')` 解析祖先冒泡

## 文件管理

- **每个问题一个文件**：不要在一个 HTML 里堆多道题，否则用户点完一题后整体就消失了
- **选项 2-4 个为佳**：超过 4 个用户决策疲劳；少于 2 个直接走 AskUserQuestion 文字版即可
- **当前问题问完进入下一步**：写一个 `.transient/q-<n>-waiting.html` 占位（一段文案 + 空白）盖掉旧选项，避免用户对着已结束的问题继续点（占位文件跟 q 系列一起放 `.transient/`，不算最终产物）
