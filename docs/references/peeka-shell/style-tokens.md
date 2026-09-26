# Luxury Beauty — Figma Token Spec (v2)

Product catalog page tokens. **Light + Dark** via `data-theme` on `<html>`.

## Architecture

```
figma-tokens.css   →  Figma UI semantic primitives (light / dark)
tokens.css         →  Product aliases (--bg-*, --text-*, --accent-*)
page.css           →  Layout + components (var references only)
```

## Design Principles

| Principle | Application |
|-----------|-------------|
| **Figma Variables** | Single semantic layer; mode switch remaps all surfaces |
| **Apple clarity** | SF Pro stack, restrained radius, generous whitespace |
| **Midjourney** | Premium photography in cards only; UI chrome stays neutral |

## Figma Semantic — Light

| Token | Value | Usage |
|-------|-------|-------|
| `--figma-bg` | `#FFFFFF` | Cards, main panel |
| `--figma-bg-secondary` | `#F5F5F5` | Filter sidebar |
| `--figma-bg-tertiary` | `#E6E6E6` | Controls, tags |
| `--figma-bg-canvas` | `#E5E5E5` | Workspace background |
| `--figma-text` | `rgba(0,0,0,0.9)` | Primary text |
| `--figma-text-secondary` | `rgba(0,0,0,0.5)` | Descriptions |
| `--figma-accent` | `#0D99FF` | Figma blue — slider, checkbox, selected |

## Figma Semantic — Dark

| Token | Value | Usage |
|-------|-------|-------|
| `--figma-bg` | `#1E1E1E` | Filter sidebar |
| `--figma-bg-secondary` | `#2C2C2C` | Cards, main panel |
| `--figma-bg-tertiary` | `#383838` | Controls, tags |
| `--figma-bg-canvas` | `#2C2C2C` | Workspace background |
| `--figma-text` | `rgba(255,255,255,0.9)` | Primary text |
| `--figma-accent` | `#0D99FF` | Same accent both modes |

## Product Aliases

| CSS Variable | Light | Dark |
|--------------|-------|------|
| `--bg-canvas` | figma-bg-canvas | figma-bg-canvas |
| `--bg-primary` | figma-bg | figma-bg-secondary |
| `--bg-secondary` | figma-bg-secondary | figma-bg |
| `--bg-tertiary` | figma-bg-tertiary | figma-bg-tertiary |
| `--accent` | `#0D99FF` | `#0D99FF` |

Dark mode inverts sidebar/card elevation for visual hierarchy on dark canvas.

## Theme Switch

```html
<html data-theme="light">  <!-- or dark -->
```

Shell preview syncs theme to embedded iframe via `postMessage`.

## Preview Files

| File | Role |
|------|------|
| `index.html` | Product page (standalone 1440×900 or embedded) |
| `shell-preview.html` | IDE shell + embedded product (1440×900) |
| `css/figma-tokens.css` | Figma light/dark source of truth |
| `css/tokens.css` | Product token aliases |
| `css/page.css` | Component styles |

## Standalone vs Embedded

| Mode | URL | Canvas |
|------|-----|--------|
| Standalone | `index.html` | Fixed 1440×900 centered |
| Embedded | `index.html?embedded=1` | Fills shell iframe 100% |
