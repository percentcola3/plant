<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

defineProps<{ gitAvailable?: boolean }>()
const emit = defineEmits<{
  history: []
  rename: []
  move: []
  copy: []
  delete: []
}>()
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="project-card-more-menu__trigger"
        aria-label="更多操作"
        @click.stop
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <circle cx="3" cy="8" r="1.25" />
          <circle cx="8" cy="8" r="1.25" />
          <circle cx="13" cy="8" r="1.25" />
        </svg>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-36 text-xs">
      <DropdownMenuItem v-if="gitAvailable" class="text-xs" @select="emit('history')">变更记录</DropdownMenuItem>
      <DropdownMenuSeparator v-if="gitAvailable" />
      <DropdownMenuItem class="text-xs" @select="emit('rename')">重命名</DropdownMenuItem>
      <DropdownMenuItem class="text-xs" @select="emit('move')">移动</DropdownMenuItem>
      <DropdownMenuItem class="text-xs" @select="emit('copy')">复制</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        class="text-xs text-destructive focus:text-destructive"
        @select="emit('delete')"
      >
        删除
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>

<style scoped>
.project-card-more-menu__trigger {
  display: flex;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition:
    opacity 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    background 180ms cubic-bezier(0.25, 0.1, 0.25, 1),
    color 180ms cubic-bezier(0.25, 0.1, 0.25, 1);
}

.project-card-more-menu__trigger:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.project-card-more-menu__trigger svg {
  width: 16px;
  height: 16px;
}
</style>

<style>
.product-card:hover .project-card-more-menu__trigger,
.group\/card:hover .project-card-more-menu__trigger,
.product-card:focus-within .project-card-more-menu__trigger,
.group\/card:focus-within .project-card-more-menu__trigger,
.project-card-more-menu__trigger:focus-visible,
.project-card-more-menu__trigger[data-state='open'] {
  opacity: 1;
}
</style>
