<script setup lang="ts">
import plantIcon from '@/assets/brand/plant-icon.svg'

withDefaults(defineProps<{ size?: number; alt?: string }>(), {
  size: 24,
  alt: '',
})
</script>

<template>
  <img class="plant-logo" :src="plantIcon" :width="size" :height="size" :alt="alt" draggable="false" />
</template>

<style scoped>
.plant-logo {
  display: inline-block;
  flex: none;
  border-radius: 22%;
  vertical-align: middle;
}
</style>
