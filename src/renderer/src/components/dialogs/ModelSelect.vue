<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const model = defineModel<string>({ required: true })
const props = defineProps<{
  options: readonly string[]
  allowEmpty?: boolean
}>()
const editingCustom = ref(false)
const isCustom = computed(() => editingCustom.value || (
  !props.options.includes(model.value) && !(props.allowEmpty && model.value === '')
))

function selectModel(event: Event): void {
  const select = event.target as HTMLSelectElement
  editingCustom.value = select.selectedOptions[0]?.dataset.custom === 'true'
  if (!editingCustom.value) model.value = select.value
}

watch(() => props.options, () => { editingCustom.value = false })
</script>

<template>
  <select
    :value="isCustom ? '__custom__' : model"
    class="rounded-md border border-input bg-background p-2 text-sm"
    @change="selectModel"
  >
    <option v-if="allowEmpty" value="">跟随上面的模型</option>
    <option v-for="id in options" :key="id" :value="id">
      {{ id === 'deepseek-flash' ? 'DeepSeek V4.1 Flash（deepseek-flash）' : id }}
    </option>
    <option value="__custom__" data-custom="true">自定义模型 ID</option>
  </select>
  <input
    v-if="isCustom"
    v-model="model"
    aria-label="自定义模型 ID"
    placeholder="输入模型 ID"
    class="rounded-md border border-input bg-background p-2 text-sm"
  />
</template>
