export const MARKDOWN_CHART_LABEL = '图表'

export const MARKDOWN_MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  themeVariables: {
    background: 'transparent',
    mainBkg: '#f8fbff',
    secondBkg: '#fff7ed',
    tertiaryColor: '#eef2ff',
    primaryColor: '#e6fffb',
    primaryTextColor: '#1f2937',
    primaryBorderColor: '#0f766e',
    lineColor: '#64748b',
    secondaryColor: '#fff7ed',
    secondaryTextColor: '#1f2937',
    secondaryBorderColor: '#f59e0b',
    tertiaryTextColor: '#1f2937',
    tertiaryBorderColor: '#6366f1',
    noteBkgColor: '#fffbeb',
    noteTextColor: '#1f2937',
    noteBorderColor: '#f59e0b',
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  },
  flowchart: {
    curve: 'basis',
    htmlLabels: true,
    padding: 18
  },
  sequence: {
    mirrorActors: false
  }
} as const

export const MARKDOWN_DOCUMENT_CSS = `
  :root {
    color-scheme: light;
    --md-bg: #f6f8fb;
    --md-panel: #ffffff;
    --md-panel-soft: #f8fafc;
    --md-text: #1f2937;
    --md-muted: #64748b;
    --md-border: #e2e8f0;
    --md-border-strong: #cbd5e1;
    --md-accent: #0f766e;
    --md-accent-soft: #e6fffb;
    --md-warm: #f59e0b;
    --md-warm-soft: #fff7ed;
    --md-indigo-soft: #eef2ff;
    --md-code-bg: #111827;
    --md-code-inline: #eef2f7;
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --md-bg: #121212;
    --md-panel: #121212;
    --md-panel-soft: #1a1a1a;
    --md-text: #d4d4d4;
    --md-muted: #a3a3a3;
    --md-border: #333333;
    --md-border-strong: #404040;
    --md-accent: #7dd3fc;
    --md-accent-soft: rgba(125, 211, 252, 0.12);
    --md-warm: #fbbf24;
    --md-warm-soft: rgba(251, 191, 36, 0.1);
    --md-indigo-soft: rgba(196, 181, 253, 0.12);
    --md-code-bg: #0a0a0a;
    --md-code-inline: #262626;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px;
    background: var(--md-bg);
    color: var(--md-text);
    font: 15px/1.86 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .markdown {
    max-width: 960px;
    margin: 0 auto;
    background: var(--md-panel);
    border: 1px solid var(--md-border);
    border-radius: 8px;
    padding: 34px 40px 48px;
    box-shadow: 0 18px 45px rgba(15, 23, 42, 0.06);
  }
  .markdown > :first-child { margin-top: 0; }
  .markdown > :last-child { margin-bottom: 0; }
  .markdown h1,
  .markdown h2,
  .markdown h3,
  .markdown h4 {
    color: #111827;
    line-height: 1.28;
    letter-spacing: 0;
  }
  .markdown h1 {
    margin: 0 0 1.1em;
    padding-bottom: 0.55em;
    border-bottom: 1px solid var(--md-border);
    font-size: 2.05rem;
    font-weight: 760;
  }
  .markdown h2 {
    margin: 1.9em 0 0.7em;
    padding-left: 12px;
    border-left: 4px solid var(--md-accent);
    font-size: 1.45rem;
    font-weight: 720;
  }
  .markdown h3 {
    margin: 1.5em 0 0.55em;
    font-size: 1.15rem;
    font-weight: 700;
  }
  .markdown h4 {
    margin: 1.3em 0 0.45em;
    font-size: 1rem;
    font-weight: 700;
  }
  .markdown p,
  .markdown ul,
  .markdown ol,
  .markdown blockquote,
  .markdown table,
  .markdown pre,
  .markdown .md-chart {
    margin: 1.08em 0;
  }
  .markdown ul,
  .markdown ol {
    padding-left: 1.45em;
  }
  .markdown li + li { margin-top: 0.34em; }
  .markdown a {
    color: var(--md-accent);
    font-weight: 600;
    text-decoration: none;
  }
  .markdown a:hover { text-decoration: underline; }
  .markdown strong { color: #111827; font-weight: 760; }
  .markdown mark {
    border-radius: 5px;
    background: #fef3c7;
    box-shadow: inset 0 -0.36em 0 rgba(245, 158, 11, 0.2);
    color: inherit;
    padding: 0.04em 0.25em;
  }
  .markdown img {
    display: block;
    max-width: 100%;
    height: auto;
    border: 1px solid var(--md-border);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
  }
  .markdown pre:not(.mermaid) {
    overflow: auto;
    background: var(--md-code-bg);
    color: #f8fafc;
    border-radius: 8px;
    padding: 16px 18px;
  }
  .markdown code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.92em;
    background: var(--md-code-inline);
    border-radius: 5px;
    color: #334155;
    padding: 0.12em 0.38em;
  }
  .markdown pre code {
    background: transparent;
    color: inherit;
    padding: 0;
  }
  .markdown blockquote {
    border: 1px solid #fed7aa;
    border-left: 4px solid var(--md-warm);
    border-radius: 8px;
    background: var(--md-warm-soft);
    color: #475569;
    padding: 10px 16px;
  }
  .markdown blockquote > :first-child { margin-top: 0; }
  .markdown blockquote > :last-child { margin-bottom: 0; }
  .markdown table {
    display: block;
    width: 100%;
    overflow: auto;
    border: 1px solid var(--md-border);
    border-radius: 8px;
    border-spacing: 0;
    border-collapse: separate;
  }
  .markdown th,
  .markdown td {
    border-right: 1px solid var(--md-border);
    border-bottom: 1px solid var(--md-border);
    padding: 9px 12px;
    text-align: left;
    vertical-align: top;
  }
  .markdown tr > :last-child { border-right: 0; }
  .markdown tbody tr:last-child > * { border-bottom: 0; }
  .markdown th {
    background: var(--md-panel-soft);
    color: #111827;
    font-weight: 720;
    white-space: nowrap;
  }
  .markdown tbody tr:nth-child(even) td { background: #fbfdff; }
  .markdown hr {
    border: 0;
    border-top: 1px solid var(--md-border);
    margin: 2.1em 0;
  }
  .markdown .md-chart {
    overflow: hidden;
    border: 1px solid #dbeafe;
    border-radius: 8px;
    background: #fbfdff;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
  }
  .markdown .md-chart__header {
    display: flex;
    align-items: center;
    min-height: 38px;
    border-bottom: 1px solid #dbeafe;
    background: #f8fafc;
    padding: 8px 14px;
  }
  .markdown .md-chart__title {
    color: var(--md-accent);
    font-size: 12px;
    font-weight: 760;
    letter-spacing: 0;
  }
  .markdown .md-chart__body {
    overflow: auto;
    background: #fbfdff;
    padding: 18px;
  }
  .markdown .md-chart .mermaid,
  .markdown .md-chart .mermaid-diagram {
    min-width: min-content;
    margin: 0;
  }
  .markdown .md-chart .mermaid {
    overflow: visible;
    border: 0;
    background: transparent;
    color: var(--md-text);
    padding: 0;
    white-space: pre;
  }
  .markdown .md-chart svg {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }
  .markdown .md-chart--error {
    border-color: #fecdd3;
    background: #fff1f2;
  }
  .markdown .md-chart--error .md-chart__header {
    border-bottom-color: #fecdd3;
    background: #fff1f2;
  }
  .markdown .md-chart--error .md-chart__title { color: #be123c; }
  .markdown .mermaid-error {
    white-space: pre-wrap;
    background: transparent;
    color: #9f1239;
  }
  /* 剪裁图片折叠：默认收起为标签按钮，点击 summary 展开 */
  .markdown .raw-image-fold {
    margin: 8px 0;
    border-radius: 6px;
    border: 1px solid #e2e8f0;
    background: #f8fafc;
    overflow: hidden;
  }
  .markdown .raw-image-fold > summary {
    cursor: pointer;
    padding: 6px 12px;
    font-size: 12px;
    color: #475569;
    user-select: none;
    list-style: none;
  }
  .markdown .raw-image-fold > summary::-webkit-details-marker { display: none; }
  .markdown .raw-image-fold > summary::before {
    content: '▶';
    display: inline-block;
    width: 14px;
    transition: transform 0.15s ease;
    font-size: 9px;
    color: #94a3b8;
  }
  .markdown .raw-image-fold[open] > summary::before { transform: rotate(90deg); }
  .markdown .raw-image-fold > summary:hover { background: #f1f5f9; }
  .markdown .raw-image-fold > img {
    display: block;
    margin: 0 auto 8px;
    padding: 8px;
    max-width: 100%;
  }
  :root[data-theme="dark"] body {
    padding: 0;
  }
  :root[data-theme="dark"] .markdown {
    max-width: 1040px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    padding: 32px 40px 48px;
  }
  :root[data-theme="dark"] .markdown h1,
  :root[data-theme="dark"] .markdown h2,
  :root[data-theme="dark"] .markdown h3,
  :root[data-theme="dark"] .markdown h4,
  :root[data-theme="dark"] .markdown strong,
  :root[data-theme="dark"] .markdown th {
    color: #f5f5f5;
  }
  :root[data-theme="dark"] .markdown mark {
    background: rgba(251, 191, 36, 0.2);
    box-shadow: inset 0 -0.36em 0 rgba(251, 191, 36, 0.12);
  }
  :root[data-theme="dark"] .markdown code {
    color: #e5e5e5;
  }
  :root[data-theme="dark"] .markdown blockquote {
    border-color: rgba(251, 191, 36, 0.28);
    border-left-color: var(--md-warm);
    color: var(--md-muted);
  }
  :root[data-theme="dark"] .markdown tbody tr:nth-child(even) td,
  :root[data-theme="dark"] .markdown .md-chart,
  :root[data-theme="dark"] .markdown .md-chart__body {
    background: #171717;
  }
  :root[data-theme="dark"] .markdown .md-chart,
  :root[data-theme="dark"] .markdown .md-chart__header {
    border-color: var(--md-border);
  }
  :root[data-theme="dark"] .markdown .md-chart__header,
  :root[data-theme="dark"] .markdown .raw-image-fold {
    background: var(--md-panel-soft);
  }
  :root[data-theme="dark"] .markdown .raw-image-fold {
    border-color: var(--md-border);
  }
  :root[data-theme="dark"] .markdown .raw-image-fold > summary {
    color: var(--md-muted);
  }
  :root[data-theme="dark"] .markdown .raw-image-fold > summary:hover {
    background: var(--md-code-inline);
  }
  @media (max-width: 720px) {
    body { padding: 14px; }
    .markdown {
      padding: 22px 18px 30px;
      border-radius: 8px;
    }
    .markdown h1 { font-size: 1.7rem; }
    .markdown h2 { font-size: 1.25rem; }
    .markdown .md-chart__body { padding: 14px; }
  }
`

export function createMarkdownChartHtml(innerHtml: string, options: { error?: boolean } = {}): string {
  const modifier = options.error ? ' md-chart--error' : ''
  return `<figure class="md-chart${modifier}"><figcaption class="md-chart__header"><span class="md-chart__title">${MARKDOWN_CHART_LABEL}</span></figcaption><div class="md-chart__body">${innerHtml}</div></figure>`
}

export function createMarkdownDocumentHtml(input: {
  title?: string
  body: string
  mermaidScript?: string
  theme?: 'light' | 'dark'
}): string {
  const article = input.body.trim() ? `<article class="markdown">${input.body}</article>` : ''
  const title = input.title ? escapeHtml(input.title) : 'Markdown Preview'
  const theme = input.theme ?? 'light'
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>${MARKDOWN_DOCUMENT_CSS}</style>
  </head>
  <body>
    ${article}
    ${input.mermaidScript ?? ''}
  </body>
</html>`
}

export function createMermaidInitializeScript(startOnLoad: boolean): string {
  return `mermaid.initialize(${JSON.stringify({ ...MARKDOWN_MERMAID_CONFIG, startOnLoad })});`
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
