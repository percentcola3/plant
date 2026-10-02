<script setup lang="ts">
import { BookOpen, Layers, Sparkles, Sprout } from 'lucide-vue-next'

withDefaults(defineProps<{ kind?: 'knowledge' | 'assets' | 'skills' | 'plant' }>(), { kind: 'plant' })
const icons = { knowledge: BookOpen, assets: Layers, skills: Sparkles, plant: Sprout }
</script>

<template>
  <div class="plant-illustration" aria-hidden="true">
    <span class="plant-illustration__halo" />
    <span class="plant-illustration__sheet plant-illustration__sheet--back" />
    <span class="plant-illustration__sheet plant-illustration__sheet--front">
      <component :is="icons[kind]" :size="27" :stroke-width="1.4" />
      <span class="plant-illustration__line" /><span class="plant-illustration__line plant-illustration__line--short" />
    </span>
  </div>
</template>

<style scoped>
.plant-illustration { position: relative; width: 140px; height: 78px; flex: none; pointer-events: none; background: url('@/assets/project-placeholder.svg') right center / cover no-repeat; }
.plant-illustration__halo { position: absolute; inset: 8px 26px 3px 15px; border-radius: 50%; background: color-mix(in srgb, var(--color-leaf) 7%, transparent); }
.plant-illustration__sheet { position: absolute; width: 48px; height: 57px; border: 1px solid color-mix(in srgb, var(--color-leaf) 25%, var(--color-border)); border-radius: 9px; }
.plant-illustration__sheet--back { top: 9px; left: 32px; transform: rotate(-14deg); background: color-mix(in srgb, var(--color-leaf) 12%, var(--color-bg-elevated)); }
.plant-illustration__sheet--front { top: 12px; left: 45px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; transform: rotate(7deg); background: var(--color-bg-elevated); color: var(--color-leaf); box-shadow: 0 5px 12px color-mix(in srgb, var(--color-leaf) 8%, transparent); }
.plant-illustration__line { width: 24px; height: 2px; border-radius: 2px; background: color-mix(in srgb, var(--color-leaf) 20%, transparent); }
.plant-illustration__line--short { width: 16px; }
@media (prefers-reduced-motion: no-preference) { .plant-illustration__sheet { transition: transform 180ms ease; } }
</style>
