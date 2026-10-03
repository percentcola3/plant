<script setup lang="ts">
import PlantHeaderIllustration from '@/components/brand/PlantHeaderIllustration.vue'

defineProps<{
  title: string
  description: string
  kind: 'workbench' | 'knowledge' | 'skills'
}>()
</script>

<template>
  <header class="plant-page-header" :class="{ 'plant-page-header--actions': !!$slots.actions }">
    <PlantHeaderIllustration :kind="kind" />
    <div class="plant-page-header__copy">
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="plant-page-header__actions"><slot name="actions" /></div>
  </header>
</template>

<style scoped>
.plant-page-header { position: relative; display: flex; flex: none; align-items: center; gap: 10px; box-sizing: border-box; min-height: 84px; padding: 18px 24px 10px; border-bottom: 0; background: var(--color-bg-panel); }
.plant-page-header__copy { flex: 1; min-width: 0; }
.plant-page-header h1 { margin: 0; color: var(--color-text-primary); font-size: 22px; line-height: 28px; font-weight: 650; letter-spacing: -0.01em; }
.plant-page-header p { margin: 2px 0 0; color: var(--color-text-secondary); font-size: 13px; line-height: 20px; }
.plant-page-header__actions { flex: none; }
@media (max-width: 760px) { .plant-page-header { padding: 14px; flex-wrap: wrap; } .plant-page-header__actions { flex-basis: 100%; } }
</style>
