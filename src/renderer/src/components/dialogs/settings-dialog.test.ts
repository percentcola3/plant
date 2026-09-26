import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('SettingsDialog', () => {
  it('uses DCC as the default AI engine', () => {
    const source = readFileSync(resolve(__dirname, 'SettingsDialog.vue'), 'utf8')

    expect(source).toContain("import { DEFAULT_CLI_KIND, type CliKind } from '@shared/cli'")
    expect(source).toContain("type AiEngine = CliKind | 'deepseek-harness'")
    expect(source).toContain('const aiEngine = ref<AiEngine>(DEFAULT_CLI_KIND)')
    expect(source).toContain("chooseAiEngine('dcc')")
  })

  it('offers DCC, Claude Code and Peeka as one selection group', () => {
    const source = readFileSync(resolve(__dirname, 'SettingsDialog.vue'), 'utf8')

    expect(source).toContain("import { DEFAULT_AI_PROVIDER, type AiProvider } from '@shared/ai-provider'")
    expect(source).toContain("chooseAiEngine('dcc')")
    expect(source).toContain("chooseAiEngine('claude')")
    expect(source).toContain("chooseAiEngine('deepseek-harness')")
    expect(source).toContain('name="ai-engine"')
    expect(source).not.toContain('Claude Code 命令')
    expect(source).toContain("window.dispatchEvent(new CustomEvent('ai-engine-changed', { detail: settings }))")
    expect(source).toContain("aiEngine.value === 'deepseek-harness'")
    expect(source).toContain("peekaConnection: { ...peekaConnection.value }")
    expect(source).toContain("call('settings.update', { deepseekApiKey: null })")
    expect(source).toContain('加密保存在本机')
    expect(source).toContain('内置 Peeka')
    expect(source).toContain('基于 DeepSeek')
    expect(source).toContain("v-if=\"aiEngine === 'deepseek-harness'\"")
    expect(source).toContain('视觉模型')
  })

  it('exposes appearance theme switching', () => {
    const source = readFileSync(resolve(__dirname, 'SettingsDialog.vue'), 'utf8')

    expect(source).toContain("tab === 'appearance'")
    expect(source).toContain('外观')
    expect(source).toContain('chooseTheme(')
    expect(source).toContain('useThemeStore')
  })

  it('exposes SSH key setup with GitLab guidance', () => {
    const source = readFileSync(resolve(__dirname, 'SettingsDialog.vue'), 'utf8')

    expect(source).toContain("tab === 'ssh'")
    expect(source).toContain("call('ssh.check'")
    expect(source).toContain("call('ssh.generate'")
    expect(source).toContain("call('ssh.rotate', { expectedFingerprint })")
    expect(source).toContain("call('system.copyToClipboard', { text: sshState.value.publicKey })")
    expect(source).toContain("call('system.openExternal', { url: GITLAB_SSH_KEYS_URL })")
    expect(source).toContain('fingerprint?: string')
    expect(source).toContain('sshState?.fingerprint')
    expect(source).toContain('Fingerprint')
    expect(source).toContain('https://git.example.internal/profile/keys')
    expect(source).toContain('配置 SSH Key')
    expect(source).toContain('按下面 3 步完成配置')
    expect(source).toContain('生成并复制公钥')
    expect(source).toContain('生成并复制')
    expect(source).toContain('复制公钥')
    expect(source).toContain('添加到 GitLab')
    expect(source).toContain('打开 GitLab')
    expect(source).toContain('保存并返回')
    expect(source).toContain('@click="rotateSshKey"')
    expect(source).toContain('轮换密钥')
    expect(source).toContain('window.confirm(')
    expect(source).toContain('旧公钥之后还需从 GitLab 删除')
    expect(source).toContain('重新添加到 GitLab')
    expect(source.match(/@click="copySshPublicKey"/g)).toHaveLength(1)
    expect(source).toContain('填写 Title，点击 Add key')
    expect(source).not.toContain('sshState?.path')
    expect(source).not.toContain('Add an SSH key')
    expect(source).not.toContain('Key 文本框')
  })

  it('lets users inspect, reveal, export and clear local diagnostics', () => {
    const source = readFileSync(resolve(__dirname, 'SettingsDialog.vue'), 'utf8')

    expect(source).toContain("tab === 'diagnostics'")
    expect(source).toContain('诊断与日志')
    expect(source).toContain("call('diagnostics.info'")
    expect(source).toContain("call('diagnostics.reveal'")
    expect(source).toContain("call('diagnostics.export'")
    expect(source).toContain("call('diagnostics.clear'")
    expect(source).toContain('在 Finder 中打开')
    expect(source).toContain('导出诊断包')
    expect(source).toContain('删除全部日志')
  })
})
