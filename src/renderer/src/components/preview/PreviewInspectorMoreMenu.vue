<script setup lang="ts">
import { Ellipsis } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { call } from '@/lib/api'
import { useUiStore } from '@/stores/ui'
import PreviewZoomStepper from './PreviewZoomStepper.vue'

const props = defineProps<{
  tabId?: string
  remarksVisible?: boolean
  workspaceId?: string
  relPath?: string
}>()

const emit = defineEmits<{
  'toggle-remarks': []
}>()

const ui = useUiStore()

async function openInBrowser(): Promise<void> {
  if (!props.workspaceId || !props.relPath) return
  const r = await call('system.openInBrowser', {
    workspaceId: props.workspaceId,
    relativePath: props.relPath,
  })
  if (!r.ok) ui.showToast('error', `打开失败：${r.message}`, 4200)
}

async function revealInFinder(): Promise<void> {
  if (!props.workspaceId || !props.relPath) return
  const r = await call('system.revealInFinder', {
    workspaceId: props.workspaceId,
    relativePath: props.relPath,
  })
  if (!r.ok) ui.showToast('error', `打开失败：${r.message}`, 4200)
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="product-workbench-icon-btn preview-inspector-tools__btn"
        aria-label="更多操作"
        title="更多操作"
        @click.stop
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="preview-inspector-more-menu min-w-[220px] p-0 text-xs">
      <PreviewZoomStepper :tab-id="tabId" />
      <DropdownMenuSeparator class="my-0" />
      <div class="py-1">
        <DropdownMenuItem class="text-xs" @select="emit('toggle-remarks')">
          {{ remarksVisible ? '隐藏元素备注' : '展示元素备注' }}
        </DropdownMenuItem>
        <DropdownMenuSeparator class="my-1" />
        <DropdownMenuItem
          class="text-xs"
          :disabled="!workspaceId || !relPath"
          @select="openInBrowser"
        >
          在浏览器中打开
        </DropdownMenuItem>
        <DropdownMenuItem
          class="text-xs"
          :disabled="!workspaceId || !relPath"
          @select="revealInFinder"
        >
          在 Finder 中显示
        </DropdownMenuItem>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
