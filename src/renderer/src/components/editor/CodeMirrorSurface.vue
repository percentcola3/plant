<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildMarkdownShortcutInsertion, type MarkdownShortcutId } from '@/lib/editor/markdown-shortcuts'

const props = withDefaults(defineProps<{
  modelValue: string
  language: Extension
  extraExtensions?: Extension[]
  placeholder?: string
  readOnly?: boolean
  textVariant?: 'default' | 'markdown'
  theme?: 'light' | 'dark'
  handleImageFiles?: (files: File[]) => Promise<string | null>
  onSave?: () => void | Promise<void>
}>(), {
  extraExtensions: () => [],
  placeholder: '',
  readOnly: false,
  textVariant: 'default',
  theme: 'light',
  handleImageFiles: undefined,
  onSave: undefined
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const rootEl = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null
const languageCompartment = new Compartment()
const editableCompartment = new Compartment()
const typographyCompartment = new Compartment()
const colorThemeCompartment = new Compartment()

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.meta, color: '#a3a3a3' },
  { tag: [tags.heading, tags.strong], color: '#fafafa', fontWeight: '700' },
  { tag: tags.emphasis, color: '#e5e5e5', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.atom, tags.bool], color: '#c4b5fd' },
  { tag: [tags.string, tags.inserted], color: '#86efac' },
  { tag: [tags.url, tags.link], color: '#7dd3fc', textDecoration: 'underline' },
  { tag: [tags.number, tags.changed, tags.annotation, tags.modifier], color: '#fbbf24' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#67e8f9' },
  { tag: [tags.comment, tags.quote], color: '#a3a3a3' },
  { tag: [tags.tagName, tags.deleted, tags.invalid], color: '#fda4af' }
], { themeType: 'dark' })

function insertText(text: string): void {
  if (!view) return
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length }
  })
}

function insertMarkdownShortcut(id: MarkdownShortcutId): void {
  if (!view) return
  const range = view.state.selection.main
  const selectedText = view.state.sliceDoc(range.from, range.to)
  const insertion = buildMarkdownShortcutInsertion(id, selectedText)
  const base = range.from
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: insertion.text },
    selection: {
      anchor: base + insertion.selectionStart,
      head: base + insertion.selectionEnd
    }
  })
  view.focus()
}

function collectImageFiles(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return []
  return [...dataTransfer.files].filter((file) => file.type.startsWith('image/'))
}

function editorExtensions(): Extension[] {
  return [
    basicSetup,
    EditorView.lineWrapping,
    languageCompartment.of(props.language),
    editableCompartment.of(EditorState.readOnly.of(props.readOnly)),
    keymap.of([{
      key: 'Mod-s',
      run() {
        void props.onSave?.()
        return true
      }
    }]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) emit('update:modelValue', update.state.doc.toString())
    }),
    EditorView.domEventHandlers({
      paste: (event) => {
        if (!props.handleImageFiles) return false
        const files = collectImageFiles((event as ClipboardEvent).clipboardData ?? null)
        if (files.length === 0) return false
        event.preventDefault()
        void props.handleImageFiles(files).then((markdown) => {
          if (markdown) insertText(markdown)
        })
        return true
      },
      drop: (event) => {
        if (!props.handleImageFiles) return false
        const files = collectImageFiles((event as DragEvent).dataTransfer ?? null)
        if (files.length === 0) return false
        event.preventDefault()
        void props.handleImageFiles(files).then((markdown) => {
          if (markdown) insertText(markdown)
        })
        return true
      }
    }),
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px'
      },
      '.cm-editor': {
        height: '100%'
      },
      '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        overflow: 'auto'
      },
      '.cm-content': {
        minHeight: '100%'
      },
      '.cm-focused': {
        outline: 'none'
      },
      '.cm-line': {
        padding: '0 2px'
      },
      '.cm-gutters': { borderRightStyle: 'solid', borderRightWidth: '1px' }
    }),
    colorThemeCompartment.of(editorColorTheme(props.theme)),
    typographyCompartment.of(editorTypography(props.textVariant)),
    ...props.extraExtensions
  ]
}

function editorColorTheme(theme: 'light' | 'dark'): Extension {
  const dark = theme === 'dark'
  return [
    EditorView.theme({
      '&': {
        backgroundColor: dark ? '#121212' : '#ffffff',
        color: dark ? '#e5e5e5' : '#0f172a'
      },
      '.cm-content': {
        caretColor: dark ? '#fafafa' : '#0f172a'
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: dark ? '#fafafa' : '#0f172a'
      },
      '.cm-gutters': {
        backgroundColor: dark ? '#171717' : '#f8fafc',
        color: dark ? '#737373' : '#94a3b8',
        borderRightColor: dark ? '#2a2a2a' : '#e5e7eb'
      },
      '.cm-activeLine': {
        backgroundColor: dark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(14, 165, 233, 0.06)'
      },
      '.cm-activeLineGutter': {
        backgroundColor: dark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(14, 165, 233, 0.08)'
      },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: dark ? 'rgba(125, 211, 252, 0.22)' : 'rgba(14, 165, 233, 0.18)'
      }
    }, { dark }),
    ...(dark ? [syntaxHighlighting(darkHighlightStyle)] : [])
  ]
}

function editorTypography(variant: 'default' | 'markdown'): Extension {
  return EditorView.theme({
    '&': {
      fontSize: variant === 'markdown' ? '14.5px' : '13px'
    },
    '.cm-scroller': {
      lineHeight: variant === 'markdown' ? '1.78' : '1.5'
    },
    '.cm-content': {
      padding: variant === 'markdown' ? '22px 26px 36px' : '16px 18px 28px',
      letterSpacing: '0'
    },
    '.cm-line': {
      padding: variant === 'markdown' ? '1px 2px' : '0 2px'
    }
  })
}

onMounted(() => {
  if (!rootEl.value) return
  view = new EditorView({
    parent: rootEl.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: editorExtensions()
    })
  })
})

watch(() => props.modelValue, (value) => {
  if (!view) return
  const current = view.state.doc.toString()
  if (value === current) return
  view.dispatch({
    changes: { from: 0, to: current.length, insert: value }
  })
})

watch(() => props.language, (language) => {
  if (!view) return
  view.dispatch({ effects: languageCompartment.reconfigure(language) })
})

watch(() => props.readOnly, (readOnly) => {
  if (!view) return
  view.dispatch({ effects: editableCompartment.reconfigure(EditorState.readOnly.of(readOnly)) })
})

watch(() => props.textVariant, (variant) => {
  if (!view) return
  view.dispatch({ effects: typographyCompartment.reconfigure(editorTypography(variant)) })
})

watch(() => props.theme, (theme) => {
  if (!view) return
  view.dispatch({ effects: colorThemeCompartment.reconfigure(editorColorTheme(theme)) })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

defineExpose({ insertMarkdownShortcut })
</script>

<template>
  <div
    ref="rootEl"
    class="h-full w-full"
    :class="theme === 'dark' ? 'bg-[#121212] text-[#e5e5e5]' : 'bg-white text-slate-900'"
  />
</template>
