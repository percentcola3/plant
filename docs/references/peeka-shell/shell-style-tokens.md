# Shell Style — Figma UI Spec (v2)

IDE chrome (top navigation + left input panel) mapped to **Figma design-tool colors**.

## Preview

Open **`shell-preview.html`** — 1440×900, dark mode default.

| Region | Size |
|--------|------|
| Top bar | 48px — Figma `#2C2C2C` glass |
| Left sidebar | 360px — Figma `#1E1E1E` |
| Canvas | iframe → `index.html?embedded=1` |

## Token Stack

```
figma-tokens.css  →  Figma semantic (shared with product)
shell-tokens.css  →  Shell chrome aliases (--shell-*)
shell.css         →  Component styles
```

## Figma Chrome Mapping — Dark

| Shell Token | Figma Source | Value |
|-------------|--------------|-------|
| `--shell-bg-sidebar` | `--figma-bg` | `#1E1E1E` |
| `--shell-bg-topbar` | `--figma-bg-secondary` | `#2C2C2C` |
| `--shell-bg-canvas` | `--figma-bg-canvas` | `#2C2C2C` |
| `--shell-bg-input` | `--figma-bg-secondary` | `#2C2C2C` |
| `--shell-accent` | `--figma-accent` | `#0D99FF` |
| `--shell-text-primary` | `--figma-text` | `rgba(255,255,255,0.9)` |

## Figma Chrome Mapping — Light

| Shell Token | Value |
|-------------|-------|
| `--shell-bg-sidebar` | `#FFFFFF` |
| `--shell-bg-topbar` | `#FFFFFF` glass |
| `--shell-bg-canvas` | `#E5E5E5` |

## Theme Sync

Top-right sun/moon toggle sets `data-theme` on shell **and** posts to embedded iframe:

```js
frame.contentWindow.postMessage({ type: 'theme-change', theme }, '*');
```

Product page inside canvas switches light/dark in sync.

## Style Decisions (v2 vs v1)

| v1 | v2 (Figma-aligned) |
|----|---------------------|
| Custom grays `#0A0A0A` | Figma `#1E1E1E` / `#2C2C2C` |
| Gradient Share button | Figma blue `#0D99FF` |
| Empty canvas placeholder | Embedded `index.html` product page |
| Shell-only dark/light | Unified `figma-tokens.css` for shell + product |
| Top bar 52px | 48px (Figma toolbar height) |
| Sidebar 400px | 360px (closer to Figma layers panel) |

## Components

- **Top bar**: Figma logo blue, Locked/Beta badges, URL bar, theme toggle, Publish + Share
- **Sidebar**: Context summary, version card, Ask-for-changes input (Figma focus ring)
- **Canvas**: Rounded frame with embedded product preview
