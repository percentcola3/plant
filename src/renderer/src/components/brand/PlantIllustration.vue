<script setup lang="ts">
import KnowledgeIcon from './KnowledgeIcon.vue'
import { FolderKanban, Layers, Sparkles, Sprout } from 'lucide-vue-next'

withDefaults(defineProps<{ kind?: 'knowledge' | 'assets' | 'skills' | 'plant' | 'workbench' }>(), { kind: 'plant' })
const icons = { knowledge: KnowledgeIcon, assets: Layers, skills: Sparkles, plant: Sprout, workbench: FolderKanban }
</script>

<template>
  <div class="plant-illustration" aria-hidden="true">
    <span class="plant-illustration__paper plant-illustration__paper--back" />
    <span class="plant-illustration__symbol">
      <component :is="icons[kind]" :size="30" :stroke-width="1.6" />
    </span>
  </div>
</template>

<style scoped>
.plant-illustration { position: relative; width: 140px; height: 78px; flex: none; pointer-events: none; }
.plant-illustration__paper, .plant-illustration__symbol { position: absolute; top: 12px; left: 28%; width: 48px; height: 56px; border-radius: 10px; }
.plant-illustration__paper--back { background: color-mix(in srgb, var(--color-leaf) 10%, var(--color-bg-subtle)); transform: translate(-7px, -4px) rotate(-10deg); }
.plant-illustration__symbol { display: grid; place-items: center; background: var(--color-bg-panel); color: var(--color-leaf); box-shadow: 0 4px 14px rgba(24, 38, 28, .07); transform: rotate(5deg); }
</style>
