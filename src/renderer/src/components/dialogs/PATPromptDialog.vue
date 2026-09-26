<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { call } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

type Pending = { id: number; prompt: string; isPassword: boolean; host: string }

const queue = ref<Pending[]>([])
const current = computed<Pending | null>(() => queue.value[0] ?? null)
const inputEl = ref<InstanceType<typeof Input>>()
const value = ref('')
const remember = ref(true)

const open = computed({
  get: () => !!current.value,
  set: (v) => { if (!v) cancel() },
})

function isPasswordPrompt(prompt: string): boolean {
  return /password|token|passphrase/i.test(prompt)
}

function extractHost(prompt: string): string {
  const m = prompt.match(/['"]([^'"]+)['"]/)
  if (!m) return ''
  try { return new URL(m[1]).host } catch { return m[1] }
}

const tokenHelpUrl = computed(() => {
  const host = current.value?.host ?? ''
  if (host.includes('github.com')) return '访问 https://github.com/settings/tokens 生成 Personal Access Token。'
  return '请使用该 Git 服务的 Personal Access Token，不要使用登录密码。'
})

onMounted(() => {
  window.events.on('askpass.request', (payload: unknown) => {
    const p = payload as { id: number; prompt: string }
    const pending = {
      id: p.id,
      prompt: p.prompt,
      isPassword: isPasswordPrompt(p.prompt),
      host: extractHost(p.prompt),
    }
    queue.value.push(pending)
    if (!pending.isPassword) void prefillUsername(pending.id)
    void nextTick(() => focusInput())
  })
})

function focusInput(): void {
  const el = (inputEl.value as unknown as { $el?: HTMLElement })?.$el?.querySelector?.('input')
  ;(el ?? (inputEl.value as unknown as HTMLInputElement))?.focus?.()
}

async function prefillUsername(promptId: number): Promise<void> {
  const r = await call('git.currentUser', undefined)
  if (!r.ok || !r.data.email) return
  if (current.value?.id !== promptId) return
  if (value.value.trim()) return
  value.value = r.data.email
  await nextTick()
  focusInput()
}

async function submit(): Promise<void> {
  if (!current.value) return
  const trimmed = value.value.trim()
  if (!trimmed) return cancel()
  const c = current.value
  await call('askpass.respond', {
    id: c.id,
    answer: trimmed,
    rememberHost: remember.value && c.host ? c.host : undefined,
  })
  value.value = ''
  remember.value = true
  queue.value.shift()
  void nextTick(() => focusInput())
}

async function cancel(): Promise<void> {
  if (!current.value) return
  await call('askpass.cancel', { id: current.value.id })
  value.value = ''
  queue.value.shift()
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="sm:max-w-[480px] z-[60]"
      overlay-class="z-[60]"
      @keydown.esc="cancel"
    >
      <DialogHeader>
        <DialogTitle>
          {{ current?.isPassword ? '输入密码 / 访问令牌' : '输入用户名' }}
        </DialogTitle>
        <DialogDescription class="break-all">
          git 需要凭据：{{ current?.prompt }}
        </DialogDescription>
      </DialogHeader>

      <p
        v-if="current?.isPassword"
        class="text-xs text-muted-foreground"
      >
        {{ tokenHelpUrl }}
      </p>

      <Input
        ref="inputEl"
        v-model="value"
        :type="current?.isPassword ? 'password' : 'text'"
        :placeholder="current?.isPassword ? '密码或 Personal Access Token' : '用户名'"
        class="font-mono"
        @keydown.enter="submit"
      />

      <label
        v-if="current?.host"
        class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"
      >
        <Checkbox v-model:checked="remember" />
        记住 {{ current.host }} 的凭据（仅本次会话）
      </label>

      <DialogFooter>
        <Button variant="outline" @click="cancel">取消</Button>
        <Button :disabled="!value.trim()" @click="submit">提交</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
