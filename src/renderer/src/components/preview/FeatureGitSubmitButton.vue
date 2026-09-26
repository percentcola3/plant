<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  workspaceId: string
  relDir: string
  prepare?: () => Promise<void>
}>()

const emit = defineEmits<{
  done: []
}>()

const ui = useUiStore()
const bound = ref(false)
const submitting = ref(false)

async function refreshBound(): Promise<void> {
  const result = await call('git.capability', { workspaceId: props.workspaceId })
  bound.value = result.ok && result.data.state === 'remote'
}

onMounted(() => {
  void refreshBound()
})

watch(() => props.workspaceId, () => {
  void refreshBound()
})

async function submit(): Promise<void> {
  if (submitting.value) return
  submitting.value = true
  try {
    await props.prepare?.()
    const result = await call('git.submitFeature', {
      workspaceId: props.workspaceId,
      relDir: props.relDir
    })
    if (!result.ok) {
      ui.showToast('error', result.message, 5000)
      emit('done')
      return
    }
    if (!result.data.committed && !result.data.pushed) {
      ui.showToast('info', '当前没有待提交或推送的改动，自动保存可能已完成同步', 4500)
      emit('done')
      return
    }
    ui.showToast(
      result.data.warning ? 'info' : 'success',
      result.data.warning ?? '当前项目已提交并推送到远程',
      4500
    )
    emit('done')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Button
    v-if="bound"
    type="button"
    variant="outline"
    size="sm"
    class="text-xxs"
    :disabled="submitting"
    title="只提交当前项目目录的改动并推送到远程，不会带上仓库里其他项目"
    @click="submit"
  >
    {{ submitting ? '提交中…' : '提交' }}
  </Button>
</template>
