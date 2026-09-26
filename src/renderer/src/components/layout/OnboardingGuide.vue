<script setup lang="ts">
import {
  ArrowRight,
  BookOpenText,
  Boxes,
  ExternalLink,
  GitBranch,
  KeyRound,
  PackageOpen,
  SearchCheck,
  Settings2,
  Sparkles,
  TerminalSquare,
} from 'lucide-vue-next'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'

const ui = useUiStore()
const CLI_GUIDE_URL = 'https://code.claude.com/docs/en/overview'

type GuideStep = {
  title: string
  detail: string
}

const cliSteps: GuideStep[] = [
  { title: '安装 Claude Code', detail: '按官方文档完成安装与账号认证，确认终端能执行 claude 命令。' },
  { title: '回到 WorkSpace 设置', detail: '在「CLI」里确认引擎为 Claude Code，AI 面板会通过 claude 启动。' },
  { title: '失败时先看命令可用性', detail: '确认终端能执行 claude，再重启 App 或重新打开 AI 面板。' },
]

const resourceSteps: GuideStep[] = [
  { title: '先配置 Git SSH', detail: '在设置里生成或复制 App 专用 SSH Key，并添加到 Git 服务的 SSH Keys。' },
  { title: '添加资源包', detail: '资源包页可以添加本地目录、Git 知识库、UI 资产和剪页内容。Git 地址优先使用 SSH URL。' },
  { title: '构建或重建索引', detail: '导入后检查“检索索引”状态；内容有较大变化时点“重新构建”，让 AI 能检索到新内容。' },
]

const skillSteps: GuideStep[] = [
  { title: '从模板库开始', detail: '技能页可以安装内置模板，也可以新增空白 skill。' },
  { title: '在根项目内定制', detail: '按工作流修改 .claude/skills/<name>/SKILL.md，并同步 .agents/skills 下的同名 skill。' },
  { title: '把触发条件写清楚', detail: '描述 skill 适用场景、输入、输出和约束，避免让 AI 猜。' },
]

async function openCliGuide(): Promise<void> {
  const result = await call('system.openExternal', { url: CLI_GUIDE_URL })
  if (!result.ok) ui.showToast('error', `打开 CLI 文档失败：${result.message}`, 5000)
}
</script>

<template>
  <main class="onboarding-guide">
    <div class="onboarding-guide__content">
      <section class="onboarding-guide__hero" aria-labelledby="onboarding-title">
        <span class="onboarding-guide__eyebrow">
          <BookOpenText :size="16" aria-hidden="true" />
          新手引导
        </span>
        <h1 id="onboarding-title">把 AI 工作台先配顺</h1>
        <p>按顺序完成 CLI、资源包和 skill 配置。这里保留常用入口，后续也可以随时回来检查。</p>
      </section>

      <section class="guide-grid" aria-label="配置入口">
        <article class="guide-panel guide-panel--wide">
          <div class="guide-panel__head">
            <span class="guide-panel__icon" aria-hidden="true">
              <TerminalSquare :size="18" />
            </span>
            <div>
              <h2>Claude Code CLI 配置</h2>
              <p>先按官方文档完成 Claude Code 的安装与认证，再在 App 里确认引擎。</p>
            </div>
          </div>

          <ol class="guide-steps">
            <li v-for="step in cliSteps" :key="step.title">
              <strong>{{ step.title }}</strong>
              <span>{{ step.detail }}</span>
            </li>
          </ol>

          <div class="guide-actions">
            <Button @click="openCliGuide">
              打开 CLI 文档
              <ExternalLink class="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="outline" @click="ui.openSettings('cli')">
              切换 CLI
              <Settings2 class="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </article>

        <article class="guide-panel">
          <div class="guide-panel__head">
            <span class="guide-panel__icon" aria-hidden="true">
              <Settings2 :size="18" />
            </span>
            <div>
              <h2>AI 引擎切换</h2>
              <p>AI 面板支持 Claude Code 原生 CLI 与内置 DeepSeek Harness 两种引擎。</p>
            </div>
          </div>

          <div class="cli-compare">
            <div>
              <strong>claude</strong>
              <span>Claude Code 原生命令，执行形态类似 <code>claude --resume &lt;uuid&gt;</code>。</span>
            </div>
            <div>
              <strong>DeepSeek Harness</strong>
              <span>内置引擎，基于 DeepSeek API，无需本机安装 Claude Code。</span>
            </div>
          </div>

          <Button variant="outline" class="guide-panel__solo-action" @click="ui.openSettings('cli')">
            打开 CLI 设置
            <ArrowRight class="h-4 w-4" aria-hidden="true" />
          </Button>
        </article>

        <article class="guide-panel guide-panel--wide">
          <div class="guide-panel__head">
            <span class="guide-panel__icon" aria-hidden="true">
              <PackageOpen :size="18" />
            </span>
            <div>
              <h2>资源包与索引</h2>
              <p>资源包会作为 AI 可读上下文，Git 资源包建议先走 SSH。</p>
            </div>
          </div>

          <ol class="guide-steps">
            <li v-for="step in resourceSteps" :key="step.title">
              <strong>{{ step.title }}</strong>
              <span>{{ step.detail }}</span>
            </li>
          </ol>

          <div class="guide-actions">
            <Button variant="outline" @click="ui.openSettings('ssh')">
              配置 Git SSH
              <KeyRound class="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button @click="ui.openResources()">
              打开资源包
              <SearchCheck class="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </article>

        <article class="guide-panel">
          <div class="guide-panel__head">
            <span class="guide-panel__icon" aria-hidden="true">
              <Sparkles :size="18" />
            </span>
            <div>
              <h2>Skill 使用与定制</h2>
              <p>skill 用来固定项目里的 AI 工作流和产出规范。</p>
            </div>
          </div>

          <ol class="guide-steps guide-steps--compact">
            <li v-for="step in skillSteps" :key="step.title">
              <strong>{{ step.title }}</strong>
              <span>{{ step.detail }}</span>
            </li>
          </ol>

          <Button class="guide-panel__solo-action" @click="ui.openSkills()">
            打开技能页
            <Boxes class="h-4 w-4" aria-hidden="true" />
          </Button>
        </article>
      </section>

      <section class="guide-note" aria-label="建议顺序">
        <GitBranch :size="18" aria-hidden="true" />
        <p>建议顺序：先完成 CLI 配置，再配置 Git SSH，随后导入资源包并构建索引，最后按根项目工作流定制 skill。</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.onboarding-guide {
  min-width: 0;
  flex: 1;
  overflow-y: auto;
  background: transparent;
}

.onboarding-guide__content {
  width: min(1080px, calc(100% - 48px));
  margin: 0 auto;
  padding: 44px 0 56px;
}

.onboarding-guide__hero {
  margin-bottom: 24px;
}

.onboarding-guide__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--color-accent);
  font-size: 13px;
  font-weight: 700;
}

.onboarding-guide__hero h1 {
  margin: 12px 0 8px;
  color: var(--color-text-primary);
  font-size: 30px;
  font-weight: 760;
  line-height: 1.18;
}

.onboarding-guide__hero p {
  max-width: 680px;
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 14px;
  line-height: 1.7;
}

.guide-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 16px;
}

.guide-panel,
.guide-note {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-panel);
  box-shadow: 0 10px 28px color-mix(in srgb, var(--color-text-primary) 5%, transparent);
}

.guide-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}

.guide-panel--wide {
  min-height: 280px;
}

.guide-panel__head {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 12px;
}

.guide-panel__icon {
  display: inline-flex;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--color-accent-light);
  color: var(--color-accent);
}

.guide-panel h2 {
  margin: 0;
  color: var(--color-text-primary);
  font-size: 17px;
  font-weight: 720;
  line-height: 1.3;
}

.guide-panel__head p {
  margin: 5px 0 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.guide-steps {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: guide-step;
}

.guide-steps li {
  position: relative;
  display: grid;
  gap: 3px;
  min-width: 0;
  padding-left: 34px;
  counter-increment: guide-step;
}

.guide-steps li::before {
  position: absolute;
  left: 0;
  top: 1px;
  display: inline-flex;
  width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  content: counter(guide-step);
  font-size: 11px;
  font-weight: 700;
}

.guide-steps strong {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 680;
  line-height: 1.35;
}

.guide-steps span {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.guide-steps--compact {
  gap: 9px;
}

.guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: auto;
}

.guide-panel__solo-action {
  width: fit-content;
  margin-top: auto;
}

.cli-compare {
  display: grid;
  gap: 10px;
}

.cli-compare > div {
  display: grid;
  gap: 4px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
  padding: 12px;
}

.cli-compare strong {
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 700;
}

.cli-compare span {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.55;
}

.cli-compare code {
  color: var(--color-text-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
}

.guide-note {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 14px 16px;
  color: var(--color-text-secondary);
}

.guide-note svg {
  flex: 0 0 auto;
  color: var(--color-accent);
}

.guide-note p {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 860px) {
  .onboarding-guide__content {
    width: min(100% - 28px, 1080px);
    padding-top: 32px;
  }

  .guide-grid {
    grid-template-columns: 1fr;
  }
}
</style>
