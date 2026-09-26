export type PastePlainTextInput = {
  text: string
  preventDefault: () => void
  insertText?: (text: string) => void
}

export function pastePlainTextIntoSelection(input: PastePlainTextInput): boolean {
  if (!input.text) return false
  input.preventDefault()
  if (input.insertText) {
    input.insertText(input.text)
  } else if (typeof document !== 'undefined') {
    document.execCommand('insertText', false, input.text)
  }
  return true
}
