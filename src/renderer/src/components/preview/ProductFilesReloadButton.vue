<script setup lang="ts">
import { RefreshCw } from 'lucide-vue-next'

withDefaults(defineProps<{
  loading?: boolean
  disabled?: boolean
}>(), {
  loading: false,
  disabled: false,
})

const emit = defineEmits<{
  reload: []
}>()
</script>

<template>
  <button
    type="button"
    class="product-workbench-icon-btn"
    :disabled="disabled || loading"
    title="重载"
    aria-label="重载"
    @click="emit('reload')"
  >
    <RefreshCw
      :class="{ 'product-workbench-icon-btn__spinning': loading }"
      aria-hidden="true"
    />
  </button>
</template>

<style scoped>
.product-workbench-icon-btn__spinning {
  animation: product-files-reload-spin 0.8s linear infinite;
}

@keyframes product-files-reload-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
