<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

// 设置里手动新增 / 编辑 git host 的 PAT。
// 编辑场景：host 锁定不可改，密码留空表示「不改密码」（这是 askpass-server.setCred 的契约）。
// 新增场景：host / username / password 三项都要填。
type Props = {
  open: boolean
  mode: 'create' | 'edit'
  /** 编辑时传入；新增时空 */
  host?: string
  /** 编辑时传入旧用户名做 placeholder */
  initialUsername?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  host: '',
  initialUsername: null,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const ui = useUiStore()
const hostRef = ref<InstanceType<typeof Input>>()
const hostInput = ref('')
const usernameInput = ref('')
const passwordInput = ref('')
const saving = ref(false)
const error = ref('')

const open = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const isEdit = computed(() => props.mode === 'edit')
const title = computed(() => (isEdit.value ? `编辑 ${props.host} 凭据` : '新增 git 凭据'))
const passwordPlaceholder = computed(() =>
  isEdit.value ? '留空 = 不修改原密码' : 'Personal Access Token'
)

watch(
  () => props.open,
  async (v) => {
    if (!v) return
    hostInput.value = props.host ?? ''
    usernameInput.value = props.initialUsername ?? ''
    passwordInput.value = ''
    error.value = ''
    await nextTick()
    const target = isEdit.value
      ? (document.querySelector<HTMLInputElement>('#pat-edit-password'))
      : (document.querySelector<HTMLInputElement>('#pat-edit-host'))
    target?.focus()
  }
)

async function submit(): Promise<void> {
  error.value = ''
  const host = hostInput.value.trim()
  const username = usernameInput.value.trim()
  const password = passwordInput.value
  if (!host) {
    error.value = '请输入 git 主机名（如 github.com）'
    return
  }
  if (!isEdit.value && !password) {
    error.value = '请输入 PAT / 密码'
    return
  }
  saving.value = true
  const r = await call('askpass.upsert', { host, username, password: password || undefined })
  saving.value = false
  if (!r.ok) {
    error.value = `${r.code}: ${r.message}`
    return
  }
  ui.showToast('success', isEdit.value ? `已更新 ${host}` : `已保存 ${host}`)
  emit('saved')
  open.value = false
}

function cancel(): void {
  if (saving.value) return
  open.value = false
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px] z-[60]" overlay-class="z-[60]" @keydown.esc="cancel">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          凭据用 safeStorage 加密存到本机 userData，仅本人 macOS 登录态下可解。
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-3 py-1">
        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">主机名</span>
          <Input
            id="pat-edit-host"
            ref="hostRef"
            v-model="hostInput"
            type="text"
            placeholder="github.com / gitlab.example.com"
            class="font-mono"
            :disabled="isEdit"
            @keydown.enter="submit"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">用户名（可选）</span>
          <Input
            v-model="usernameInput"
            type="text"
            placeholder="留空表示不存用户名"
            class="font-mono"
            @keydown.enter="submit"
          />
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs text-muted-foreground">PAT / 密码</span>
          <Input
            id="pat-edit-password"
            v-model="passwordInput"
            type="password"
            :placeholder="passwordPlaceholder"
            class="font-mono"
            @keydown.enter="submit"
          />
        </label>
      </div>

      <div v-if="error" class="p-2 rounded-md bg-destructive/10 text-xs text-destructive">
        {{ error }}
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="saving" @click="cancel">取消</Button>
        <Button :disabled="saving" @click="submit">
          {{ saving ? '保存中…' : '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
