// AI 约束文案。明确两类边界：
//
// 1) App 运行时基线（EXTERNAL_RESOURCE_RULE）：跟 App 运行时强绑定——.external/ 是
//    App 的只读挂载概念。是否触发取决于运行时
//    挂载状态，用户没法静态写。→ 由 App 自动注入（in-app Claude 走 compose-prompt，
//    按 externalRefs 是否存在条件注入），用户永远不碰。
//
// 2) 项目业务规则（UI_GENERATION_HARD_RULES + UI_ASSET_BUSINESS_RULES）：用哪套
//    设计方法论 / design token / 组件约定，取决于具体项目。→ 用户自管，写进
//    CLAUDE.md（Claude）/ AGENTS.md（Codex/Cursor）。App 只在「新建」时预填模板，
//    生成后归用户，不再回写。

// ── App 运行时基线（App 注入，用户不写） ──
export const EXTERNAL_RESOURCE_RULE =
  '复用资产库/知识库里的资源（图片/字体/样式/组件等）时，一律复制一份到当前产物目录（如 assets/），引用指向项目内相对路径。禁止产物里出现指向 .external/ 的 src/href/url()/@import——.external/ 是只读且 gitignore，不随项目发布，引用它会导致产物无法独立运行。'

// compose-prompt 用：externalRefs 非空时注入的段落（含段头）。
export function renderExternalResourceLines(): string[] {
  return ['## 资源引用约束（必须遵守，不可跳过）', '', EXTERNAL_RESOURCE_RULE]
}

// ── 项目业务规则（用户自管，仅作「新建」模板） ──
export const UI_GENERATION_HARD_RULES =
  '【没有视觉图时】禁止凭空想样式：先读知识库/前端代码找到对应功能，思考并最大限度 1:1 还原；还原不到的部分（如后端返回的 icon、动态数据驱动的样式）明确提示用户并标 TODO，禁止用"通常/一般/应该/默认就是"等措辞臆测填补。'

export const UI_ASSET_BUSINESS_RULES = [
  '挂了 UI 资产库时，任何 UI 产出（生成/迭代/还原/mockup）的颜色、组件、命名必须取自资产库，禁止自由发挥：',
  '',
  '- 颜色：只用资产库 styles 暴露的 theme token（var(--...)）。禁止裸色值（#xxx / rgb() / rgba() / hsl() / 命名色），禁止改 token 名，禁止直接引用 palette 原子（如 --orange-6），禁止 var(--x, <fallback>) 兜底。',
  '- 组件：优先复用资产库 components/ 里已有组件，不行再照 DOM/类名 1:1 抄。禁止重新发明已存在的组件。类名前缀与资产库一致（如 sp-/dt-），禁止自造新前缀；组件自有尺寸用 --sp-<组件名>-* 变量。',
  '- 找不到匹配的 token/组件 → 标 TODO，禁止套 theme 近义变量、禁止凭记忆套用。'
].join('\n')

// 业务规则段（方法论 + 资产库约定）。可独立追加到迁移来的已有内容尾部。
export const BUSINESS_RULES_HEADING_RE = /##\s*UI (生成方法论|资产库约定)/

export function renderBusinessRulesSection(): string {
  return [
    '## UI 生成方法论（必须遵守，不可跳过）',
    '',
    UI_GENERATION_HARD_RULES,
    '',
    '## UI 资产库约定（挂了 UI 资产库时必须遵守）',
    '',
    UI_ASSET_BUSINESS_RULES
  ].join('\n')
}

// system.md 的初始模板：用户维护的**唯一** AI 约束文件（业务规则）。
// 项目根的 CLAUDE.md / AGENTS.md 由 App 符号链接指向它，Claude / Codex / Cursor
// 读的都是这一份，用户只维护 system.md。只含业务规则（方法论 + 资产库约定）；
// 不含 .external/ 资源基线——那条是 App 运行时绑定，由 App 注入。生成后归用户、随仓库走。
export function renderSystemDoc(): string {
  return [
    '# 项目 AI 约束（system.md）',
    '',
    '本文件是项目唯一的 AI 约束事实源。CLAUDE.md（Claude Code）/ AGENTS.md（Codex / Cursor）',
    '由 App 符号链接指向本文件——改这一份即可，无需维护多份。在这里写项目级指令、',
    '代码风格、技术栈约束等。',
    '',
    renderBusinessRulesSection(),
    ''
  ].join('\n')
}
