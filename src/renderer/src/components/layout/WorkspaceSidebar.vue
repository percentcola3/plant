<script setup lang="ts">
import KnowledgeIcon from '@/components/brand/KnowledgeIcon.vue'
import { FolderKanban, Sparkles } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useEditorStore } from '@/stores/editor'

const ui = useUiStore()
const editor = useEditorStore()

function leaveEditor(): void {
  editor.hide()
}

function openResources(): void {
  leaveEditor()
  ui.openResources()
}

function openProjectManagement(): void {
  leaveEditor()
  ui.openProjectManagement()
}

function openSkills(): void {
  leaveEditor()
  ui.openSkills()
}

</script>

<template>
  <nav class="workspace-rail app-chrome" aria-label="主导航">
    <div class="workspace-rail__group">
      <button
        type="button"
        class="workspace-rail__button"
        :class="{ 'is-active': ui.currentView === 'project-management' || ui.currentView === 'features-page' || ui.currentView === 'project-home' }"
        aria-label="工作台"
        :aria-current="ui.currentView === 'project-management' || ui.currentView === 'features-page' || ui.currentView === 'project-home' ? 'page' : undefined"
        data-tooltip="工作台"
        @click="openProjectManagement"
      >
        <FolderKanban :size="18" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="workspace-rail__button"
        :class="{ 'is-active': ui.currentView === 'ai-config' }"
        aria-label="知识库"
        :aria-current="ui.currentView === 'ai-config' ? 'page' : undefined"
        data-tooltip="知识库"
        @click="openResources"
      >
        <KnowledgeIcon :size="18" aria-hidden="true" />
      </button>

      <button
        type="button"
        class="workspace-rail__button"
        :class="{ 'is-active': ui.currentView === 'skills-config' }"
        aria-label="技能"
        :aria-current="ui.currentView === 'skills-config' ? 'page' : undefined"
        data-tooltip="技能"
        @click="openSkills"
      >
        <Sparkles :size="18" aria-hidden="true" />
      </button>

    </div>
  </nav>
</template>

<style scoped>
.workspace-rail {
  position: relative;
  z-index: 20;
  display: flex;
  width: 56px;
  flex: 0 0 56px;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0 12px;
}

.workspace-rail__group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}

.workspace-rail__button {
  position: relative;
  display: inline-flex;
  width: 38px;
  height: 38px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 9px;
  background: transparent;
  color: var(--color-text-muted);
  transition: background-color 140ms ease, border-color 140ms ease, color 140ms ease;
}

.workspace-rail__button:not(.is-active):hover {
  border-color: transparent;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
}

.workspace-rail__button.is-active {
  border-color: transparent;
  background: var(--color-accent-light);
  color: var(--color-leaf);
}

.workspace-rail__button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 1px;
}

.workspace-rail__button::after {
  position: absolute;
  left: calc(100% + 10px);
  top: 50%;
  z-index: 60;
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--color-text-primary);
  color: var(--color-bg-panel);
  content: attr(data-tooltip);
  font-size: 12px;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) translateX(-4px);
  transition: opacity 120ms ease, transform 120ms ease;
  white-space: nowrap;
}

.workspace-rail__button:hover::after,
.workspace-rail__button:focus-visible::after {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}
</style>
