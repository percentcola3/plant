<script setup lang="ts">
import { computed, type Component } from 'vue'
import { Archive, Braces, CodeXml, File, FileCode2, FileText, Film, Globe, Image, Music, NotebookText, Palette, PencilRuler, Type } from 'lucide-vue-next'
import { productFileIcon } from '@/lib/preview/product-files'

const props = defineProps<{ relPath: string; web?: boolean }>()
const fileIcons: Record<string, { icon: Component; tone: string }> = {
  '<>': { icon: CodeXml, tone: 'html' },
  '#': { icon: NotebookText, tone: 'markdown' },
  '*': { icon: Palette, tone: 'css' },
  JS: { icon: FileCode2, tone: 'javascript' },
  TS: { icon: FileCode2, tone: 'typescript' },
  '{}': { icon: Braces, tone: 'data' },
  '~': { icon: PencilRuler, tone: 'sketch' },
  '▧': { icon: Image, tone: 'image' },
  Aa: { icon: Type, tone: 'font' },
  '▣': { icon: Archive, tone: 'archive' },
  '♪': { icon: Music, tone: 'audio' },
  '▶': { icon: Film, tone: 'video' },
}
const appearance = computed(() => {
  if (props.web) return { icon: Globe, tone: 'web' }
  if (/\.pdf$/i.test(props.relPath)) return { icon: FileText, tone: 'pdf' }
  if (/\.(txt|log)$/i.test(props.relPath)) return { icon: FileText, tone: 'plain' }
  return fileIcons[productFileIcon(props.relPath)] ?? { icon: File, tone: 'plain' }
})
</script>

<template>
  <component
    :is="appearance.icon"
    class="workbench-tab-icon"
    :class="`workbench-tab-icon--${appearance.tone}`"
    :size="15"
    :stroke-width="1.8"
    aria-hidden="true"
  />
</template>

<style scoped>
.workbench-tab-icon { flex: none; color: var(--file-icon-color, var(--color-text-tertiary)); }
.workbench-tab-icon--html { --file-icon-color: light-dark(#c66a37, #f09b70); }
.workbench-tab-icon--markdown { --file-icon-color: light-dark(#587ab9, #93b4ec); }
.workbench-tab-icon--css, .workbench-tab-icon--typescript { --file-icon-color: light-dark(#347fae, #7fbce6); }
.workbench-tab-icon--javascript, .workbench-tab-icon--data { --file-icon-color: light-dark(#a47d25, #dfbd65); }
.workbench-tab-icon--sketch, .workbench-tab-icon--font { --file-icon-color: light-dark(#8b63b2, #c4a1e6); }
.workbench-tab-icon--image, .workbench-tab-icon--audio { --file-icon-color: light-dark(#318b69, #75c9a5); }
.workbench-tab-icon--pdf, .workbench-tab-icon--video { --file-icon-color: light-dark(#bd596b, #ed9baa); }
.workbench-tab-icon--archive { --file-icon-color: light-dark(#a07d58, #cfaf88); }
.workbench-tab-icon--web { --file-icon-color: var(--color-leaf); }
</style>
