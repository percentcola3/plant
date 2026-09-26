<script setup lang="ts">
import ModelSelect from './ModelSelect.vue'
import { computed, ref, watch } from 'vue'
import { PEEKA_LLM_PROXY_MODELS, PEEKA_LLM_PROXY_VISION_MODELS, PEEKA_OFFICIAL_MODELS, PEEKA_OFFICIAL_VISION_MODELS, PEEKA_PRESETS, type PeekaConnection } from '@shared/peeka'
import { DEFAULT_CLI_KIND, type CliKind } from '@shared/cli'
import { DEFAULT_AI_PROVIDER, type AiProvider } from '@shared/ai-provider'
import type { AppTheme } from '@shared/app-theme'
import { useUiStore } from '@/stores/ui'
import { useThemeStore } from '@/stores/theme'
import type { SettingsTab } from '@/stores/ui'
import { call } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog'
import PATEditDialog from './PATEditDialog.vue'

const ui = useUiStore()
const themeStore = useThemeStore()
const tab = ref<SettingsTab>('appearance')

const open = computed({
  get: () => ui.settingsOpen,
  set: (v) => { if (!v) close() },
})

type ExtInfo = { destDir: string; version: string | null; installed: boolean; error?: string }
const extInfo = ref<ExtInfo | null>(null)
const extLoading = ref(false)

async function loadExtension(): Promise<void> {
  extLoading.value = true
  const r = await call('raw.extensionInfo', undefined)
  extLoading.value = false
  if (r.ok) extInfo.value = r.data
}

async function revealExtensionDir(): Promise<void> {
  await call('raw.revealExtensionDir', undefined)
}

async function copyExtensionPath(): Promise<void> {
  if (!extInfo.value?.destDir) return
  const r = await call('system.copyToClipboard', { text: extInfo.value.destDir })
  if (r.ok) ui.showToast('success', '已复制路径')
}

async function openChromeExtensions(): Promise<void> {
  await call('raw.openChromeExtensions', undefined)
}

type SshKeyState = {
  exists: boolean
  publicKey?: string
  fingerprint?: string
  path: string
}
const sshState = ref<SshKeyState | null>(null)
const sshLoading = ref(false)
const sshGenerating = ref(false)
const sshError = ref('')

async function loadSsh(): Promise<void> {
  sshLoading.value = true
  sshError.value = ''
  const r = await call('ssh.check', undefined)
  sshLoading.value = false
  if (r.ok) sshState.value = r.data
  else sshError.value = `${r.code}: ${r.message}`
}

async function generateSshKey(): Promise<void> {
  sshGenerating.value = true
  sshError.value = ''
  try {
    const r = await call('ssh.generate', {})
    if (r.ok) {
      sshState.value = r.data
      if (r.data.publicKey) {
        const copied = await call('system.copyToClipboard', { text: r.data.publicKey })
        ui.showToast(copied.ok ? 'success' : 'error', copied.ok ? 'SSH Key 已生成并复制' : `SSH Key 已生成，但复制失败：${copied.message}`, 5000)
      } else {
        ui.showToast('success', 'SSH Key 已生成')
      }
    } else {
      sshError.value = `${r.code}: ${r.message}`
    }
  } finally {
    sshGenerating.value = false
  }
}

async function rotateSshKey(): Promise<void> {
  const expectedFingerprint = sshState.value?.fingerprint
  if (!expectedFingerprint) {
    await loadSsh()
    sshError.value = 'SSH Key 指纹缺失，请刷新设置后重试。'
    return
  }

  const confirmed = window.confirm(
    '将替换本机 App 所有 Git 项目共用的 SSH Key。新公钥重新添加到 Git 服务前，SSH 拉取和推送会失败；旧公钥之后还需从 Git 服务删除。旧私钥会备份到本机，确定轮换吗？',
  )
  if (!confirmed) return

  sshGenerating.value = true
  sshError.value = ''
  try {
    const r = await call('ssh.rotate', { expectedFingerprint })
    if (r.ok) {
      sshState.value = r.data
      if (r.data.publicKey) {
        const copied = await call('system.copyToClipboard', { text: r.data.publicKey })
        ui.showToast(
          copied.ok ? 'success' : 'error',
          copied.ok
            ? 'SSH Key 已轮换并复制，请重新添加到 Git 服务'
            : `SSH Key 已轮换，但复制失败：${copied.message}`,
          6000,
        )
      } else {
        ui.showToast('success', 'SSH Key 已轮换，请重新添加到 Git 服务', 6000)
      }
    } else {
      const errorMessage = `${r.code}: ${r.message}`
      await loadSsh()
      sshError.value = errorMessage
    }
  } finally {
    sshGenerating.value = false
  }
}

async function copySshPublicKey(): Promise<void> {
  if (!sshState.value?.publicKey) return
  const r = await call('system.copyToClipboard', { text: sshState.value.publicKey })
  if (r.ok) ui.showToast('success', '已复制公钥')
  else ui.showToast('error', `复制失败：${r.message}`, 5000)
}

type CredEntry = { host: string; username: string | null; hasPassword: boolean }
const creds = ref<CredEntry[]>([])
const credsLoading = ref(false)
const credsError = ref('')

const editDialogOpen = ref(false)
const editMode = ref<'create' | 'edit'>('create')
const editHost = ref('')
const editUsername = ref<string | null>(null)

function openCreate(): void {
  editMode.value = 'create'
  editHost.value = ''
  editUsername.value = null
  editDialogOpen.value = true
}

function openEdit(entry: CredEntry): void {
  editMode.value = 'edit'
  editHost.value = entry.host
  editUsername.value = entry.username
  editDialogOpen.value = true
}

async function loadCreds(): Promise<void> {
  credsLoading.value = true
  credsError.value = ''
  const r = await call('askpass.listCreds', undefined)
  credsLoading.value = false
  if (r.ok) creds.value = r.data
  else credsError.value = r.message
}

async function forgetCred(host: string): Promise<void> {
  const ok = window.confirm(`清除 ${host} 的缓存凭证？下次使用会重新弹框输入。`)
  if (!ok) return
  const r = await call('askpass.forget', { host })
  if (r.ok) {
    ui.showToast('success', `已清除 ${host}`)
    await loadCreds()
  } else {
    ui.showToast('error', `清除失败：${r.message}`, 5000)
  }
}

async function clearAllCreds(): Promise<void> {
  if (creds.value.length === 0) return
  const ok = window.confirm(`清除全部 ${creds.value.length} 条缓存凭证？`)
  if (!ok) return
  const r = await call('askpass.clearAll', undefined)
  if (r.ok) {
    ui.showToast('success', '已清除全部凭证')
    await loadCreds()
  } else {
    ui.showToast('error', `清除失败：${r.message}`, 5000)
  }
}

type AiEngine = CliKind | 'deepseek-harness'

// AI 面板引擎：Claude Code / 内置 DeepSeek Harness。
// 切换本机命令时会清空 capability cache，下一次开 AI 面板时重探新二进制。
const cliKind = ref<CliKind>(DEFAULT_CLI_KIND)
const aiEngine = ref<AiEngine>(DEFAULT_CLI_KIND)
const aiEngineSaved = ref<AiEngine>(DEFAULT_CLI_KIND)
const aiSaving = ref(false)
const aiError = ref('')
const deepseekApiKey = ref('')
const deepseekApiKeyConfigured = ref(false)
const peekaConnection = ref<PeekaConnection>({ ...PEEKA_PRESETS.official })
const savedPeekaBaseUrl = ref(PEEKA_PRESETS.official.baseUrl)
const endpointChanged = computed(() => peekaConnection.value.baseUrl.replace(/\/+$/, '') !== savedPeekaBaseUrl.value)
const peekaPreset = computed(() => peekaConnection.value.baseUrl === PEEKA_PRESETS.official.baseUrl ? 'official' : peekaConnection.value.baseUrl === PEEKA_PRESETS.llm.baseUrl ? 'llm' : 'custom')
function choosePeekaPreset(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'official' || value === 'llm') peekaConnection.value = { ...PEEKA_PRESETS[value] }
  deepseekApiKey.value = ''
}


async function loadCli(): Promise<void> {
  aiError.value = ''
  const r = await call('settings.get', undefined)
  if (r.ok) {
    cliKind.value = r.data.cliKind ?? DEFAULT_CLI_KIND
    aiEngine.value = aiEngineFromSettings({
      cliKind: cliKind.value,
      aiProvider: r.data.aiProvider ?? DEFAULT_AI_PROVIDER,
    })
    aiEngineSaved.value = aiEngine.value
    deepseekApiKeyConfigured.value = r.data.deepseekApiKeyConfigured
    peekaConnection.value = { ...r.data.peekaConnection }
    savedPeekaBaseUrl.value = r.data.peekaConnection.baseUrl
  }
}

function aiEngineFromSettings(settings: { cliKind: CliKind; aiProvider: AiProvider }): AiEngine {
  return settings.aiProvider === 'deepseek-harness' ? 'deepseek-harness' : settings.cliKind
}

function applyAiSettings(settings: { cliKind: CliKind; aiProvider: AiProvider; deepseekApiKeyConfigured: boolean; peekaConnection: PeekaConnection }): void {
  cliKind.value = settings.cliKind
  aiEngine.value = aiEngineFromSettings(settings)
  aiEngineSaved.value = aiEngine.value
  deepseekApiKeyConfigured.value = settings.deepseekApiKeyConfigured
  deepseekApiKey.value = ''
  peekaConnection.value = { ...settings.peekaConnection }
  savedPeekaBaseUrl.value = settings.peekaConnection.baseUrl
  window.dispatchEvent(new CustomEvent('ai-engine-changed', { detail: settings }))
}

function aiEngineLabel(value: AiEngine): string {
  if (value === 'claude') return 'Claude Code'
  return '内置 DeepSeek Harness'
}

async function chooseAiEngine(value: AiEngine): Promise<void> {
  if (value === aiEngine.value && value === aiEngineSaved.value) return
  if (value === 'deepseek-harness' && !deepseekApiKeyConfigured.value && !deepseekApiKey.value.trim()) {
    aiEngine.value = value
    aiError.value = '请先输入并保存 DeepSeek API key。'
    return
  }

  aiSaving.value = true
  aiError.value = ''
  const input: { aiProvider: AiProvider; cliKind?: CliKind; deepseekApiKey?: string } = value === 'deepseek-harness'
    ? { aiProvider: value }
    : { aiProvider: 'claude-code', cliKind: value }
  if (value === 'deepseek-harness' && deepseekApiKey.value.trim()) {
    input.deepseekApiKey = deepseekApiKey.value.trim()
  }
  const r = await call('settings.update', input)
  aiSaving.value = false
  if (r.ok) {
    applyAiSettings(r.data)
    ui.showToast('success', `已切换到 ${aiEngineLabel(value)}`)
  } else {
    aiEngine.value = aiEngineSaved.value
    aiError.value = `${r.code}: ${r.message}`
  }
}

async function saveDeepseekApiKey(): Promise<void> {
  const value = deepseekApiKey.value.trim()
  if (!value && (!deepseekApiKeyConfigured.value || endpointChanged.value)) {
    aiError.value = '请输入当前请求地址对应的 API key。'
    return
  }
  aiSaving.value = true
  aiError.value = ''
  const r = await call('settings.update', {
    peekaConnection: { ...peekaConnection.value },
    ...(value ? { deepseekApiKey: value } : {}),
    ...(aiEngine.value === 'deepseek-harness' ? { aiProvider: 'deepseek-harness' as const } : {})
  })
  aiSaving.value = false
  if (r.ok) {
    applyAiSettings(r.data)
    ui.showToast('success', 'Peeka 连接配置已保存，下一条消息生效')
  } else {
    aiError.value = `${r.code}: ${r.message}`
  }
}

async function clearDeepseekApiKey(): Promise<void> {
  if (!window.confirm('清除本机保存的 DeepSeek API key？内置 DeepSeek Harness 将无法继续使用。')) return
  aiSaving.value = true
  aiError.value = ''
  const r = await call('settings.update', { deepseekApiKey: null })
  aiSaving.value = false
  if (r.ok) {
    applyAiSettings(r.data)
    ui.showToast('success', 'DeepSeek API key 已清除')
  } else {
    aiError.value = `${r.code}: ${r.message}`
  }
}

const appTheme = ref<AppTheme>('light')
const appThemeSaved = ref<AppTheme>('light')
const themeSaving = ref(false)
const themeError = ref('')

const aiTaskNotchEnabled = ref(true)
const notchSaving = ref(false)
async function toggleNotch(event: Event): Promise<void> {
  notchSaving.value = true
  const r = await call('settings.update', { aiTaskNotchEnabled: (event.target as HTMLInputElement).checked })
  notchSaving.value = false
  if (r.ok) aiTaskNotchEnabled.value = r.data.aiTaskNotchEnabled
  else { (event.target as HTMLInputElement).checked = aiTaskNotchEnabled.value; ui.showToast('error', r.message) }
}
async function loadTheme(): Promise<void> {
  const settings = await call('settings.get', undefined)
  if (settings.ok) aiTaskNotchEnabled.value = settings.data.aiTaskNotchEnabled
  themeError.value = ''
  appTheme.value = themeStore.theme
  appThemeSaved.value = themeStore.theme
}

async function chooseTheme(value: AppTheme): Promise<void> {
  if (value === appThemeSaved.value) return
  themeSaving.value = true
  themeError.value = ''
  appTheme.value = value
  const result = await themeStore.setTheme(value)
  themeSaving.value = false
  if (result.ok) {
    appThemeSaved.value = themeStore.theme
    appTheme.value = appThemeSaved.value
    ui.showToast('success', value === 'light' ? '已切换到亮色主题' : '已切换到暗色主题')
  } else {
    appTheme.value = appThemeSaved.value
    themeError.value = result.message
  }
}

type DiagnosticsInfo = {
  directory: string
  fileCount: number
  totalBytes: number
  oldestAt?: string
  newestAt?: string
}
const diagnosticsInfo = ref<DiagnosticsInfo | null>(null)
const diagnosticsLoading = ref(false)
const diagnosticsAction = ref<'reveal' | 'export' | 'clear' | null>(null)
const diagnosticsError = ref('')

async function loadDiagnostics(): Promise<void> {
  diagnosticsLoading.value = true
  diagnosticsError.value = ''
  const r = await call('diagnostics.info', undefined)
  diagnosticsLoading.value = false
  if (r.ok) diagnosticsInfo.value = r.data
  else diagnosticsError.value = `${r.code}: ${r.message}`
}

async function revealDiagnostics(): Promise<void> {
  diagnosticsAction.value = 'reveal'
  const r = await call('diagnostics.reveal', undefined)
  diagnosticsAction.value = null
  if (!r.ok) ui.showToast('error', `打开日志目录失败：${r.message}`, 5000)
}

async function exportDiagnostics(): Promise<void> {
  diagnosticsAction.value = 'export'
  const r = await call('diagnostics.export', {})
  diagnosticsAction.value = null
  if (r.ok) ui.showToast('success', '诊断包已导出并在 Finder 中定位')
  else ui.showToast('error', `导出失败：${r.message}`, 5000)
}

async function clearDiagnostics(): Promise<void> {
  if (!window.confirm('删除本机全部诊断日志？此操作无法撤销。')) return
  diagnosticsAction.value = 'clear'
  const r = await call('diagnostics.clear', undefined)
  diagnosticsAction.value = null
  if (r.ok) {
    diagnosticsInfo.value = r.data
    ui.showToast('success', '诊断日志已删除')
  } else {
    ui.showToast('error', `删除失败：${r.message}`, 5000)
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatLogTime(value?: string): string {
  return value ? new Date(value).toLocaleString() : '暂无'
}

watch(
  () => ui.settingsOpen,
  (openNow) => {
    if (openNow) {
      tab.value = ui.settingsInitialTab
      void loadCreds()
      void loadSsh()
      void loadExtension()
      void loadCli()
      void loadTheme()
      void loadDiagnostics()
    }
  },
)

watch(
  () => ui.settingsInitialTab,
  (nextTab) => {
    if (ui.settingsOpen) tab.value = nextTab
  }
)

function close(): void {
  ui.settingsOpen = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex p-0 overflow-hidden sm:max-w-[640px] h-[480px] gap-0">
      <nav class="w-36 shrink-0 border-r border-border/60 p-2 flex flex-col gap-1">
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'appearance' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'appearance'"
        >外观</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'credentials' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'credentials'"
        >凭证缓存</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'ssh' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'ssh'"
        >SSH Key</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'cli' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'cli'"
        >AI 助手</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'extension' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'extension'"
        >剪页插件</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'diagnostics' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'diagnostics'"
        >诊断与日志</button>
        <button
          class="text-left px-3 py-2 rounded-md text-sm transition-colors"
          :class="tab === 'about' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'"
          @click="tab = 'about'"
        >关于</button>
      </nav>

      <div class="flex-1 p-5 overflow-y-auto">
        <div v-if="tab === 'appearance'">
          <label class="mb-5 flex items-center gap-3 rounded-md border border-border p-3">
            <input type="checkbox" :checked="aiTaskNotchEnabled" :disabled="notchSaving" @change="toggleNotch" />
            <span class="text-sm">显示悬浮任务球<span class="mt-1 block text-xs text-muted-foreground">关闭后后台任务继续运行，可随时在这里重新开启。</span></span>
          </label>
          <h2 class="text-md font-medium mb-1">外观</h2>
          <p class="text-xs text-muted-foreground/70 mb-4">
            切换 WorkSpace 全局界面主题。选择后会立即生效，并保存到本机设置。
          </p>

          <div class="flex flex-col gap-2">
            <label
              class="flex items-start gap-3 p-3 border border-border/60 rounded-md cursor-pointer hover:bg-muted/40 transition-colors"
              :class="appTheme === 'dark' ? 'border-foreground/40 bg-muted/30' : ''"
            >
              <input
                type="radio"
                name="app-theme"
                value="dark"
                :checked="appTheme === 'dark'"
                :disabled="themeSaving"
                class="mt-1"
                @change="chooseTheme('dark')"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">暗色</div>
                <div class="text-xs text-muted-foreground/70 mt-1">
                  适合长时间编辑与预览。
                </div>
              </div>
            </label>

            <label
              class="flex items-start gap-3 p-3 border border-border/60 rounded-md cursor-pointer hover:bg-muted/40 transition-colors"
              :class="appTheme === 'light' ? 'border-foreground/40 bg-muted/30' : ''"
            >
              <input
                type="radio"
                name="app-theme"
                value="light"
                :checked="appTheme === 'light'"
                :disabled="themeSaving"
                class="mt-1"
                @change="chooseTheme('light')"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">亮色</div>
                <div class="text-xs text-muted-foreground/70 mt-1">
                  更明亮的背景与边框，适合明亮环境，当前默认风格。
                </div>
              </div>
            </label>
          </div>

          <div v-if="themeError" class="mt-3 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            {{ themeError }}
          </div>
        </div>

        <div v-if="tab === 'credentials'">
          <div class="flex items-start justify-between mb-1 gap-3">
            <h2 class="text-md font-medium">凭证缓存</h2>
            <Button size="sm" @click="openCreate">新增凭据</Button>
          </div>
          <p class="text-xs text-muted-foreground/70 mb-4">
            clone HTTPS git 仓库时记住的 PAT。也可在此手动新增/编辑，避免下次 clone 弹框输入。
            密码用 safeStorage 加密落盘到本机 userData。
          </p>

          <div v-if="credsLoading" class="text-xs text-muted-foreground/70 py-4">加载中…</div>
          <div v-else-if="creds.length === 0" class="border border-dashed border-border rounded-md p-6 text-center">
            <p class="text-sm text-muted-foreground/70">还没有缓存凭证</p>
            <p class="text-xs text-muted-foreground/70 mt-1">点上方「新增凭据」或下次 clone 输入 PAT 时勾「记住」。</p>
          </div>
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="entry in creds"
              :key="entry.host"
              class="flex items-center gap-3 px-3 py-2 border border-border/60 rounded-md"
            >
              <div class="flex-1 min-w-0">
                <div class="text-sm font-mono text-foreground truncate">{{ entry.host }}</div>
                <div class="text-xs text-muted-foreground/70 truncate">
                  <span v-if="entry.username">{{ entry.username }} · </span>
                  <span v-if="entry.hasPassword" class="text-green-600">✓ PAT 已保存</span>
                  <span v-else class="text-amber-600">PAT 未保存</span>
                </div>
              </div>
              <Button variant="outline" size="sm" @click="openEdit(entry)">编辑</Button>
              <Button variant="outline" size="sm" @click="forgetCred(entry.host)">清除</Button>
            </li>
          </ul>

          <div v-if="creds.length > 0" class="mt-4 flex justify-end">
            <Button variant="outline" size="sm" @click="clearAllCreds">全部清除</Button>
          </div>

          <div v-if="credsError" class="mt-3 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            {{ credsError }}
          </div>
        </div>

        <div v-if="tab === 'ssh'">
          <div class="mb-5">
            <h2 class="text-md font-medium">配置 SSH Key</h2>
            <p class="mt-1 text-xs text-muted-foreground">按下面 3 步完成配置。</p>
          </div>

          <div v-if="sshLoading" class="text-xs text-muted-foreground/70 py-4">读取中…</div>
          <ol v-else class="space-y-0">
            <li class="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
              <div class="flex flex-col items-center">
                <span class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">1</span>
                <span class="mt-2 min-h-8 w-px flex-1 bg-border"></span>
              </div>
              <div class="flex items-center justify-between gap-4 pb-5">
                <div>
                  <div class="text-sm font-medium">生成并复制公钥</div>
                  <p class="mt-1 text-xs text-muted-foreground">App 使用独立 SSH Key。</p>
                  <p v-if="sshState?.fingerprint" class="mt-1 font-mono text-[11px] text-muted-foreground break-all">
                    Fingerprint: {{ sshState.fingerprint }}
                  </p>
                </div>
                <Button
                  v-if="!sshState?.exists"
                  size="sm"
                  :disabled="sshGenerating"
                  @click="generateSshKey"
                >{{ sshGenerating ? '生成中…' : '生成并复制' }}</Button>
                <div v-else class="flex shrink-0 items-center gap-2">
                  <Button size="sm" :disabled="sshGenerating" @click="copySshPublicKey">复制公钥</Button>
                  <Button
                    v-if="sshState.fingerprint"
                    variant="outline"
                    size="sm"
                    :disabled="sshGenerating"
                    @click="rotateSshKey"
                  >{{ sshGenerating ? '轮换中…' : '轮换密钥' }}</Button>
                </div>
              </div>
            </li>
            <li class="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
              <div class="flex flex-col items-center">
                <span class="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">2</span>
                <span class="mt-2 min-h-8 w-px flex-1 bg-border"></span>
              </div>
              <div class="flex items-center justify-between gap-4 pb-5">
                <div>
                  <div class="text-sm font-medium">添加到 Git 服务</div>
                  <p class="mt-1 text-xs text-muted-foreground">复制公钥，粘贴到 Git 服务的 SSH Keys 设置页。</p>
                </div>
              </div>
            </li>
            <li class="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
              <span class="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold">3</span>
              <div class="pt-1">
                <div class="text-sm font-medium">保存并返回</div>
                <p class="mt-1 text-xs text-muted-foreground">填写 Title，点击 Add key，然后返回继续 Clone。</p>
              </div>
            </li>
          </ol>

          <div v-if="sshError" class="mt-3 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            {{ sshError }}
          </div>
        </div>

        <div v-if="tab === 'cli'">
          <h2 class="text-md font-medium mb-1">AI 面板使用的引擎</h2>
          <p class="text-xs text-muted-foreground/70 mb-4">
            保留现有的对话界面、别名和 <code class="font-mono">@</code> 引用能力。切换后，下一条消息会在独立会话中使用新引擎；进行中的任务不会被中断。
          </p>

          <div class="flex flex-col gap-2">
            <label
              class="flex items-start gap-3 p-3 border border-border/60 rounded-md cursor-pointer hover:bg-muted/40 transition-colors"
              :class="aiEngine === 'claude' ? 'border-foreground/40 bg-muted/30' : ''"
            >
              <input
                type="radio"
                name="ai-engine"
                value="claude"
                :disabled="aiSaving"
                :checked="aiEngine === 'claude'"
                class="mt-1"
                @change="chooseAiEngine('claude')"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">Claude Code</div>
                <div class="text-xs text-muted-foreground/70 mt-1">默认。直接使用本机安装的 Claude Code，以 headless 方式执行。</div>
              </div>
            </label>

            <label
              class="flex items-start gap-3 p-3 border border-border/60 rounded-md cursor-pointer hover:bg-muted/40 transition-colors"
              :class="aiEngine === 'deepseek-harness' ? 'border-foreground/40 bg-muted/30' : ''"
            >
              <input
                type="radio"
                name="ai-engine"
                value="deepseek-harness"
                :disabled="aiSaving"
                :checked="aiEngine === 'deepseek-harness'"
                class="mt-1"
                @change="chooseAiEngine('deepseek-harness')"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium">内置 Peeka</div>
                <div class="text-xs text-muted-foreground/70 mt-1">基于 DeepSeek，无需本机安装 Claude Code。</div>
              </div>
            </label>
          </div>

          <div v-if="aiEngine === 'deepseek-harness'" class="mt-4 rounded-md border border-border/60 p-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-medium">Peeka 连接配置</div>
                <p class="mt-1 text-xs text-muted-foreground/70">API key 加密保存在本机，界面不会回显已保存的 key。</p>
              </div>
              <span class="shrink-0 text-xs" :class="deepseekApiKeyConfigured && !endpointChanged ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'">
                {{ deepseekApiKeyConfigured && !endpointChanged ? '已配置' : '未配置' }}
              </span>
            </div>
            <fieldset :disabled="aiSaving" class="mt-3 flex flex-col gap-3">
              <label class="flex flex-col gap-1 text-xs">请求路径预设
                <select :value="peekaPreset" class="rounded-md border border-input bg-background p-2 text-sm" @change="choosePeekaPreset">
                  <option value="official">DeepSeek 官方 API</option><option value="llm">LLM 内网代理</option><option value="custom" disabled>自定义地址</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 text-xs">Base URL
                <input v-model="peekaConnection.baseUrl" type="url" class="rounded-md border border-input bg-background p-2 text-sm" />
              </label>
              <label class="flex flex-col gap-1 text-xs">API 格式
                <select v-model="peekaConnection.protocol" class="rounded-md border border-input bg-background p-2 text-sm">
                  <option value="chat-completions">Chat Completions (/chat/completions)</option><option value="messages">Anthropic Messages (/v1/messages)</option><option value="responses">Responses (/responses)</option>
                </select>
              </label>
              <label class="flex flex-col gap-1 text-xs">模型
                <ModelSelect v-model="peekaConnection.model" :options="peekaPreset === 'official' ? PEEKA_OFFICIAL_MODELS : PEEKA_LLM_PROXY_MODELS" />
              </label>
              <label class="flex flex-col gap-1 text-xs">视觉模型（可选，留空使用上面的模型）
                <ModelSelect v-model="peekaConnection.visionModel" :options="peekaPreset === 'official' ? PEEKA_OFFICIAL_VISION_MODELS : PEEKA_LLM_PROXY_VISION_MODELS" allow-empty />
              </label>
            </fieldset>
            <p v-if="peekaPreset === 'official'" class="mt-2 text-xs text-muted-foreground">V4.1 Flash 的模型 ID 为 deepseek-flash，同时支持文本和图片。</p>
            <p v-if="endpointChanged" class="mt-2 text-xs text-muted-foreground">请求地址已改变，请输入该地址对应的 API key。</p>
            <div class="mt-3 flex gap-2">
              <input
                v-model="deepseekApiKey"
                type="password"
                autocomplete="off"
                placeholder="请输入 Peeka API key"
                class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                :disabled="aiSaving"
                @keyup.enter="saveDeepseekApiKey"
              />
              <Button size="sm" :disabled="aiSaving || ((!deepseekApiKeyConfigured || endpointChanged) && !deepseekApiKey.trim())" @click="saveDeepseekApiKey">保存</Button>
              <Button v-if="deepseekApiKeyConfigured" size="sm" variant="outline" :disabled="aiSaving" @click="clearDeepseekApiKey">清除</Button>
            </div>
            <p class="mt-2 text-xs text-muted-foreground/70">含图片的对话使用配置的视觉模型，请确保所选协议支持该模型。内网代理使用截图中的内网地址，需连接对应内网。</p>
          </div>

          <div v-if="aiError" class="mt-3 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            {{ aiError }}
          </div>
        </div>

        <div v-if="tab === 'extension'">
          <h2 class="text-md font-medium mb-1">剪页插件</h2>
          <p class="text-xs text-muted-foreground/70 mb-4">
            安装到 Chrome 后，可以在网页选区里把内容保存到本地剪页资源包。
            插件文件由 App 自动放在固定位置，方便 Chrome 加载。
          </p>

          <div v-if="extLoading" class="text-xs text-muted-foreground/70 py-4">读取中…</div>
          <ol v-else class="space-y-4 text-sm">
            <li>
              <div class="flex items-center gap-2 mb-1">
                <span class="font-medium">1. 插件已就位</span>
                <span v-if="extInfo?.version" class="text-xs text-muted-foreground/70">v{{ extInfo.version }}</span>
              </div>
              <p class="text-xs text-muted-foreground/70 mb-2">
                位置：<code class="font-mono text-muted-foreground">{{ extInfo?.destDir || '~/Documents/workspace-extension/' }}</code>
              </p>
              <div class="flex gap-2">
                <Button size="sm" :disabled="!extInfo" @click="revealExtensionDir">
                  在 Finder 中打开
                </Button>
                <Button variant="outline" size="sm" :disabled="!extInfo" @click="copyExtensionPath">复制路径</Button>
              </div>
            </li>

            <li>
              <div class="font-medium mb-1">2. 在 Chrome 中加载</div>
              <ul class="list-disc list-inside text-xs text-muted-foreground space-y-1 mb-2 leading-relaxed">
                <li>右上角打开"开发者模式"</li>
                <li>点击"加载已解压的扩展程序"</li>
                <li>把第 1 步打开的目录拖进去（或浏览到该目录选中确认）</li>
              </ul>
              <Button size="sm" @click="openChromeExtensions">打开 chrome://extensions</Button>
            </li>

            <li>
              <div class="font-medium mb-1">3. 完成</div>
              <p class="text-xs text-muted-foreground/70 leading-relaxed">
                回到任意网页 → 点工具栏的插件图标 → 选取内容 → 保存到剪页资源包。
              </p>
            </li>
          </ol>

          <div v-if="extInfo?.error" class="mt-4 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            插件分发出错：{{ extInfo.error }}
          </div>
        </div>

        <div v-if="tab === 'diagnostics'">
          <h2 class="text-md font-medium mb-1">诊断与日志</h2>
          <p class="text-xs text-muted-foreground/70 mb-4 leading-relaxed">
            日志只保存在本机，不会自动上传；不记录提示词、AI 回复正文或项目文件内容。
            默认保留 14 天，总量最多 100 MB。
          </p>

          <div v-if="diagnosticsLoading" class="text-xs text-muted-foreground/70 py-4">读取中…</div>
          <section v-else class="border border-border/60 rounded-md p-3 space-y-2">
            <div class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
              <span class="text-muted-foreground/70">日志目录</span>
              <code class="font-mono break-all">{{ diagnosticsInfo?.directory || '暂无' }}</code>
              <span class="text-muted-foreground/70">当前占用</span>
              <span>{{ diagnosticsInfo?.fileCount || 0 }} 个文件 · {{ formatBytes(diagnosticsInfo?.totalBytes || 0) }}</span>
              <span class="text-muted-foreground/70">时间范围</span>
              <span>{{ formatLogTime(diagnosticsInfo?.oldestAt) }} — {{ formatLogTime(diagnosticsInfo?.newestAt) }}</span>
            </div>
          </section>

          <div class="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" :disabled="!!diagnosticsAction" @click="revealDiagnostics">
              {{ diagnosticsAction === 'reveal' ? '打开中…' : '在 Finder 中打开' }}
            </Button>
            <Button :disabled="!!diagnosticsAction" @click="exportDiagnostics">
              {{ diagnosticsAction === 'export' ? '导出中…' : '导出诊断包' }}
            </Button>
            <Button variant="outline" :disabled="!!diagnosticsAction" @click="clearDiagnostics">
              {{ diagnosticsAction === 'clear' ? '删除中…' : '删除全部日志' }}
            </Button>
          </div>

          <div v-if="diagnosticsError" class="mt-3 p-3 rounded-md bg-destructive/10 text-xs text-destructive break-all">
            {{ diagnosticsError }}
          </div>
        </div>

        <div v-if="tab === 'about'">
          <h2 class="text-md font-medium mb-1">关于 WorkSpace</h2>
          <p v-if="ui.runtime" class="text-xs text-muted-foreground/70 mb-3">
            v{{ ui.runtime.version }} · Electron {{ ui.runtime.electron }} · Node {{ ui.runtime.node }}
          </p>
          <p class="text-sm text-muted-foreground leading-relaxed">
            给 UI 与产品经理的 git 工作台。隐藏源码与终端复杂度，
            让 AI 设计 / 文档能力成为日常工具。
          </p>
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <PATEditDialog
    v-model:open="editDialogOpen"
    :mode="editMode"
    :host="editHost"
    :initial-username="editUsername"
    @saved="loadCreds"
  />
</template>
