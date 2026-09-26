<script setup lang="ts">
import { usePreviewStore } from '@/stores/preview'
import { Button } from '@/components/ui/button'
import HtmlPreviewSurface from './HtmlPreviewSurface.vue'
import MarkdownTabPane from './MarkdownTabPane.vue'
import ProductFilesTabPane from './ProductFilesTabPane.vue'

const previewStore = usePreviewStore()

function onLoad(tabId: string): void {
  previewStore.setTabLoaded(tabId)
}

function onError(tabId: string): void {
  previewStore.setTabError(tabId)
}

function retry(tabId: string): void {
  previewStore.retryTab(tabId)
}
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden bg-background">
    <div class="flex min-h-0 flex-1 bg-background">
      <div
        v-for="tab in previewStore.visibleTabs"
        v-show="tab.id === previewStore.activeTabId"
        :key="tab.id"
        class="relative h-full w-full"
      >
        <MarkdownTabPane
          v-if="tab.type === 'markdown' && tab.markdownMeta"
          :tab-id="tab.id"
          :workspace-id="tab.workspaceId"
          :rel-path="tab.markdownMeta.relPath"
        />

        <ProductFilesTabPane
          v-else-if="tab.type === 'files' && tab.filesMeta"
          :tab-id="tab.id"
          :workspace-id="tab.workspaceId"
          :root-rel-path="tab.filesMeta.rootRelPath"
          :primary-rel-path="tab.filesMeta.primaryRelPath"
          :active-rel-path="tab.filesMeta.activeRelPath"
        />

        <HtmlPreviewSurface
          v-else-if="tab.productMeta"
          :tab-id="tab.id"
          :workspace-id="tab.workspaceId"
          :rel-path="tab.productMeta.path"
          :editable-root-path="tab.productMeta.path"
          :url="tab.url"
          @loaded="onLoad(tab.id)"
          @error="onError(tab.id)"
        />

        <template v-else>
          <div
            v-if="tab.loadingState === 'loading'"
            class="absolute inset-0 flex items-center justify-center bg-background"
          >
            <span class="text-sm text-muted-foreground/70">加载中…</span>
          </div>
          <div
            v-else-if="tab.loadingState === 'error'"
            class="absolute inset-0 flex items-center justify-center bg-background"
          >
            <Button size="sm" class="text-xs" @click="retry(tab.id)">加载失败，点击重试</Button>
          </div>
          <iframe
            v-show="tab.loadingState !== 'loading'"
            :src="tab.url"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            class="h-full w-full border-none bg-white"
            @load="onLoad(tab.id)"
            @error="onError(tab.id)"
          />
        </template>
      </div>
    </div>
  </div>
</template>
