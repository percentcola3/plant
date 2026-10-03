<script setup lang="ts">
import { PanelLeftClose, PanelLeftOpen } from 'lucide-vue-next'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    type="button"
    class="product-workbench-icon-btn"
    :title="open ? '隐藏文件侧边栏' : '显示文件侧边栏'"
    :aria-label="open ? '隐藏文件侧边栏' : '显示文件侧边栏'"
    :aria-expanded="open ? 'true' : 'false'"
    @click="emit('toggle')"
  >
    <PanelLeftClose v-if="open" aria-hidden="true" />
    <PanelLeftOpen v-else aria-hidden="true" />
  </button>
</template>
