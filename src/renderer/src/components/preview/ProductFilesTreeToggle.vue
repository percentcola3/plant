<script setup lang="ts">
import { PanelLeft, PanelLeftClose } from 'lucide-vue-next'

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
    :title="open ? '收起目录树' : '展开目录树'"
    :aria-label="open ? '收起目录树' : '展开目录树'"
    :aria-expanded="open ? 'true' : 'false'"
    @click="emit('toggle')"
  >
    <PanelLeftClose v-if="open" aria-hidden="true" />
    <PanelLeft v-else aria-hidden="true" />
  </button>
</template>
