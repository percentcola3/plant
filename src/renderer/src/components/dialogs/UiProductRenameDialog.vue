<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const ui = useUiStore()
const name = ref('')
const coverTag = ref('')
const uxName = ref('')
const pmName = ref('')
const advancedOpen = ref(false)
const nameInputEl = ref<HTMLInputElement>()

const open = computed({
  get: () => !!ui.uiProductRenameOpen,
  set: (value) => { if (!value) cancel() },
})

watch(
  () => ui.uiProductRenameOpen,
  async (req) => {
    if (!req) return
    name.value = req.productName
    coverTag.value = req.coverTag ?? ''
    uxName.value = req.uxName ?? ''
    pmName.value = req.pmName ?? ''
    advancedOpen.value = Boolean(req.coverTag || req.uxName || req.pmName)
    await nextTick()
    nameInputEl.value?.focus()
    nameInputEl.value?.select()
  },
)

function submit(): void {
  ui.uiProductRenameOpen?.onSubmit({
    name: name.value,
    coverTag: coverTag.value,
    uxName: uxName.value,
    pmName: pmName.value,
  })
}

function cancel(): void {
  ui.uiProductRenameOpen?.onSubmit(null)
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[480px]" @keydown.esc="cancel">
      <DialogHeader>
        <DialogTitle>{{ ui.uiProductRenameOpen?.title ?? '编辑 UX 项目' }}</DialogTitle>
      </DialogHeader>

      <p
        v-if="ui.uiProductRenameOpen?.message"
        class="rounded-md bg-muted px-3 py-2 text-xs leading-relaxed text-muted-foreground"
      >
        {{ ui.uiProductRenameOpen.message }}
      </p>

      <div class="space-y-2">
        <label class="block text-xs font-medium text-foreground">项目名称</label>
        <Input
          ref="nameInputEl"
          v-model="name"
          type="text"
          placeholder="例如：login-page"
          @keydown.enter="submit"
        />
      </div>

      <div class="space-y-3">
        <button
          type="button"
          class="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          @click="advancedOpen = !advancedOpen"
        >
          <span class="inline-block transition-transform" :class="advancedOpen ? 'rotate-90' : ''">›</span>
          <span>高级设置</span>
        </button>

        <div v-if="advancedOpen" class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
          <div class="space-y-2">
            <label class="block text-xs font-medium text-foreground">封面标签</label>
            <Input
              v-model="coverTag"
              type="text"
              placeholder="留空则使用分组名或 SAAS"
            />
          </div>
          <div class="space-y-2">
            <label class="block text-xs font-medium text-foreground">UX 负责人</label>
            <Input
              v-model="uxName"
              type="text"
              placeholder="例如：张裴"
            />
          </div>
          <div class="space-y-2">
            <label class="block text-xs font-medium text-foreground">PM 负责人</label>
            <Input
              v-model="pmName"
              type="text"
              placeholder="例如：张代辉"
            />
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="cancel">取消</Button>
        <Button @click="submit">
          {{ ui.uiProductRenameOpen?.confirmLabel ?? '保存' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
