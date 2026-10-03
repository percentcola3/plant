<script setup lang="ts">
defineProps<{ kind: 'workbench' | 'knowledge' | 'skills' }>()
</script>

<template>
  <svg class="plant-header-illustration" viewBox="0 0 112 88" fill="none" aria-hidden="true" focusable="false">
    <g v-if="kind === 'workbench'">
      <path class="art-wash" d="M22 69C18 50 26 31 46 22C40 39 45 58 61 71C46 79 31 78 22 69Z" />
      <path class="art-green" d="M54 43C51 23 65 13 88 15C82 32 70 43 54 43Z" />
      <path class="art-green art-soft" d="M53 55C36 54 25 43 24 29C43 30 55 40 53 55Z" />
      <path class="art-line" d="M48 73C55 56 56 37 73 24" />
      <path class="art-line art-faint" d="M27 73C41 79 65 79 83 69" />
    </g>

    <g v-else-if="kind === 'knowledge'">
      <path class="art-wash" d="M18 41C33 39 48 47 57 62C69 50 84 44 96 47L89 71C76 69 65 71 55 77C42 69 30 66 21 67Z" />
      <path class="art-green art-soft" d="M54 69C36 65 26 53 26 31C42 35 54 47 54 69Z" />
      <path class="art-green" d="M57 69C55 47 67 27 87 21C86 44 76 61 57 69Z" />
      <path class="art-line" d="M56 74C55 58 49 40 42 24" />
      <path class="art-cut" d="M63 59C69 48 75 38 80 32" />
    </g>

    <g v-else>
      <path class="art-wash" d="M19 62C26 41 45 28 77 26C63 34 57 50 60 70C44 79 29 78 19 62Z" />
      <path class="art-green" d="M62 15C58 34 64 41 88 48C66 47 56 53 49 76C53 54 47 45 24 38C46 40 55 34 62 15Z" />
      <path class="art-line art-faint" d="M29 66C14 46 24 22 45 17M71 72C83 67 91 57 92 44" />
      <path class="art-cut" d="M56 35C53 41 48 43 42 43" />
    </g>
  </svg>
</template>

<style scoped>
.plant-header-illustration { display: block; width: 68px; height: 54px; flex: none; overflow: visible; pointer-events: none; }
.art-wash { fill: var(--color-leaf); opacity: .08; }
.art-green { fill: var(--color-leaf); }
.art-soft { opacity: .42; }
.art-line, .art-cut { stroke-width: 1.1; stroke-linecap: round; }
.art-line { stroke: var(--color-leaf); }
.art-faint { opacity: .35; }
.art-cut { stroke: var(--color-bg-panel); opacity: .65; }
@media (max-width: 760px) { .plant-header-illustration { width: 56px; height: 44px; } }
</style>
