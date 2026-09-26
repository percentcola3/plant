declare module 'markdown-it' {
  export default class MarkdownIt {
    constructor(options?: {
      html?: boolean
      linkify?: boolean
      typographer?: boolean
      highlight?: (code: string, lang: string) => string
    })

    renderer: {
      rules: Record<string, ((...args: any[]) => string) | undefined>
    }

    inline: {
      ruler: {
        before(
          beforeName: string,
          ruleName: string,
          fn: (state: any, silent: boolean) => boolean
        ): void
      }
    }

    parse(source: string, env: Record<string, unknown>): any[]
    render(source: string): string
  }
}
