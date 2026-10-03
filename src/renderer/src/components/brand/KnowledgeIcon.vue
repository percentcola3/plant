<script setup lang="ts">
withDefaults(defineProps<{ size?: number | string; strokeWidth?: number | string }>(), { size: 20, strokeWidth: 1.7 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" :stroke-width="strokeWidth" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 19c-2.6-1.8-5.4-2.2-9-1.6V5.5c3.6-.6 6.4-.2 9 1.6V19Z" />
    <path d="M12 19c2.5-2.7 5.3-4 9-4.2V3.5c-3.7.2-6.5 1.5-9 4.2" />
  </svg>
</template>
