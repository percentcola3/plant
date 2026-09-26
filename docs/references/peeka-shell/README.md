# PEEKA Shell Preview Reference

Standalone visual reference for the design-tool shell (tab bar, top bar, home cards, file list, canvas chrome).

This folder is **not wired into the Electron app**. Use it only as a layout/style reference when iterating on WorkSpace UI.

## View

Open in a browser:

```bash
open docs/references/peeka-shell/shell-preview.html
```

Or open `shell-preview.html` directly from Finder.

## Contents

| Path | Purpose |
|------|---------|
| `shell-preview.html` | Full static shell mock (1440×900, dark default) |
| `css/` | Shell styles and tokens (`shell.css`, `shell-tokens.css`, `figma-tokens.css`, …) |
| `icons/` | Tab bar / home / toolbar icons |
| `assets/` | Fonts and project card preview background |
| `shell-style-tokens.md` | Shell chrome token notes |
| `style-tokens.md` | Product token notes |

## Source

Copied from `/Users/didi/Desktop/PEEKA/shell-preview.html` and sibling assets. The local `downloads/` folder (installer DMG) was intentionally omitted.

When updating this reference, replace files here as a set so relative paths keep working.
