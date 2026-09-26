export function injectInspectorIntoHtml(
  html: string,
  projectId: string,
  relPath: string,
  token: string,
  options?: {
    workspacePath?: string
    autoLockWorkspace?: boolean
  }
): string {
  const ctxScript =
    `<script>window.__UIKIT_INSPECTOR=${JSON.stringify({
      projectId,
      relPath,
      token,
      workspacePath: options?.workspacePath ?? null,
      autoLockWorkspace: options?.autoLockWorkspace ?? false
    })};</script>`
  const tag = `<script src="/static/inspector.js" defer></script>`
  const block = `\n${ctxScript}\n${tag}\n`
  const idx = html.toLowerCase().lastIndexOf('</body>')
  if (idx === -1) return html + block
  return html.slice(0, idx) + block + html.slice(idx)
}
