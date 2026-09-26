import { describe, it, expect } from 'vitest'
import { composeUserMessage, type ComposeInput } from './compose-prompt'

describe('composeUserMessage', () => {
  it('纯文本（无 chip/image）→ 单 text block，无 prefix', () => {
    const result = composeUserMessage({ text: '把按钮改成圆角' })
    expect(result).toEqual([
      { type: 'text', text: '把按钮改成圆角' }
    ])
  })

  it('单 chip + 文本 → text block 含 prefix', () => {
    const input: ComposeInput = {
      text: '把 @A 改成圆角',
      chips: [{
        alias: 'A',
        path: 'main > section > button:nth-of-type(2)',
        tagName: 'button',
        textPreview: '提交订单',
        edits: { 'style:color': '#ef4444' }
      }]
    }
    const result = composeUserMessage(input)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 上下文')
    expect(text).toContain('@A：选中元素 `main > section > button:nth-of-type(2)`')
    expect(text).toContain('（标签 <button>）')
    expect(text).toContain('，文本 "提交订单"')
    expect(text).toContain('，已修改 style:color: #ef4444')
    expect(text).toContain('## 用户指令')
    expect(text).toContain('把 @A 改成圆角')
  })

  it('UI 产物上下文 → text block 含当前可编辑区域和 chip selector', () => {
    const input: ComposeInput = {
      text: '@A 字体小一点',
      editableArea: {
        relPath: 'ui/点餐',
        kind: 'ui-product'
      },
      chips: [{
        alias: 'A',
        path: 'body > main > h1',
        tagName: 'h1',
        textPreview: '点餐'
      }]
    }

    const result = composeUserMessage(input)
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 当前可编辑区域')
    expect(text).toContain('UI 产物目录：`ui/点餐`')
    expect(text).toContain('优先修改这个目录下的文件')
    // UI 业务硬约束已交还用户（CLAUDE.md），不再每轮注入
    expect(text).not.toContain('## UI 生成硬约束')
    expect(text).toContain('@A：选中元素 `body > main > h1`')
    expect(text).toContain('## 用户指令')
    expect(text).toContain('@A 字体小一点')
  })

  it('UI 组件上下文 → text block 含当前组件目录约束', () => {
    const input: ComposeInput = {
      text: '@A 调整空态文案',
      editableArea: {
        relPath: 'components/common/sp-empty-state',
        kind: 'ui-component'
      },
      chips: [{
        alias: 'A',
        path: 'body > section > p',
        tagName: 'p',
        textPreview: 'Empty'
      }]
    }

    const result = composeUserMessage(input)
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 当前可编辑区域')
    expect(text).toContain('UI 组件目录：`components/common/sp-empty-state`')
    expect(text).toContain('优先修改这个组件目录下的文件')
    expect(text).not.toContain('## UI 生成硬约束')
    expect(text).toContain('@A：选中元素 `body > section > p`')
  })

  it('当前编辑文档 → text block 含目标文件约束', () => {
    const result = composeUserMessage({
      text: '增加 Pix 线下支付 PRD',
      targetDocument: {
        relPath: '测试pred.md',
        kind: 'markdown'
      }
    })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 当前编辑文档')
    expect(text).toContain('目标文件：`测试pred.md`')
    expect(text).toContain('如果本轮需要写入内容，优先写入这个目标文件')
    expect(text).toContain('不要只新建其它文件而不更新这个目标文件')
    expect(text).toContain('## 用户指令')
    expect(text).toContain('增加 Pix 线下支付 PRD')
  })

  it('feature 项目工作区 → 默认写入当前项目 index.html', () => {
    const result = composeUserMessage({
      text: '优化当前页面',
      targetWorkspace: {
        kind: 'workspace-home',
        scopeKey: 'feature:features/POS订单',
        intent: 'design-prd'
      }
    })

    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 当前项目工作范围')
    expect(text).toContain('可写范围：`features/POS订单/`')
    expect(text).toContain('默认 UI 入口：`features/POS订单/index.html`')
    expect(text).toContain('不要只新建其它 HTML 文件而不更新默认入口')
    expect(text).toContain('PRD/说明写入 `features/POS订单/doc/`')
  })

  it('需求分支共享工作区 → text block 明确 docs/ + ui/ 范围并允许设计和 PRD 协同', () => {
    const result = composeUserMessage({
      text: '帮我把移动端点餐页设计和 PRD 一起补齐',
      targetWorkspace: {
        kind: 'workspace-home',
        scopeKey: 'requirement:4e4a6af8-yidongduan',
        intent: 'design-prd'
      }
    })

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 当前分支工作范围')
    expect(text).toContain('可写范围：`docs/` 和 `ui/`')
    expect(text).toContain('产品设计与 PRD 编写')
    expect(text).toContain('PRD/说明写入 `docs/`')
    expect(text).toContain('页面/原型/UI 产物写入 `ui/`')
    expect(text).not.toContain('## UI 生成硬约束')
    expect(text).toContain('## 用户指令')
    expect(text).toContain('帮我把移动端点餐页设计和 PRD 一起补齐')
  })

  it('chip 无 tagName/textPreview/edits → 后缀全部不输出', () => {
    const input: ComposeInput = {
      text: '修改这个',
      chips: [{ alias: 'A', path: 'body > div' }]
    }
    const result = composeUserMessage(input)
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('@A：选中元素 `body > div`')
    // 不应包含任何后缀
    expect(text).not.toContain('（标签')
    expect(text).not.toContain('，文本')
    expect(text).not.toContain('，已修改')
  })

  it('chip textPreview 含双引号 → 转义为 \\"', () => {
    const input: ComposeInput = {
      text: 'hello',
      chips: [{
        alias: 'A',
        path: 'body > p',
        textPreview: '他说"你好"'
      }]
    }
    const result = composeUserMessage(input)
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('，文本 "他说\\"你好\\""')
  })

  it('chip edits 多项 → 中文逗号连接', () => {
    const input: ComposeInput = {
      text: 'test',
      chips: [{
        alias: 'A',
        path: 'body > div',
        edits: { 'style:color': 'red', 'style:background': 'blue' }
      }]
    }
    const result = composeUserMessage(input)
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('，已修改 style:color: red，style:background: blue')
  })

  it('image only（text 空、chip 空）→ 仅 image block，无 text block', () => {
    const input: ComposeInput = {
      text: '',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]
    }
    const result = composeUserMessage(input)
    expect(result).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }
    ])
  })

  it('多 chip + 多 image → prefix 多行 + 多个 image block', () => {
    const input: ComposeInput = {
      text: '比较一下',
      chips: [
        { alias: 'A', path: 'body > div', tagName: 'div' },
        { alias: 'B', path: 'body > span', tagName: 'span', textPreview: '按钮' }
      ],
      images: [
        { mediaType: 'image/png', data: 'abc' },
        { mediaType: 'image/jpeg', data: 'def' }
      ]
    }
    const result = composeUserMessage(input)
    // 1 text + 2 image = 3 blocks
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('text')
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('@A：选中元素 `body > div`')
    expect(text).toContain('@B：选中元素 `body > span`')
    expect(result[1].type).toBe('image')
    expect(result[2].type).toBe('image')
  })

  it('空 text + 空 chips + 空 images → 空数组', () => {
    const result = composeUserMessage({ text: '' })
    expect(result).toEqual([])
  })

  it('tool result 回复 → 仅输出 tool_result block', () => {
    const result = composeUserMessage({
      text: '我选择方案 A',
      toolResult: {
        toolUseId: 'toolu_123',
        content: '我选择方案 A'
      }
    })
    expect(result).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_123', content: '我选择方案 A' }
    ])
  })

  it('externalRefs → 注入 ## 可用知识库 段，按 category 排序', () => {
    const result = composeUserMessage({
      text: '参考一下设计系统',
      externalRefs: [
        { alias: 'logos', path: '.external/logos', kind: 'asset', category: 'other' },
        { alias: 'design-system', path: '.external/design-system', kind: 'ui-kit', category: 'uikit' },
        {
          alias: 'product-spec',
          path: '.external/product-spec',
          kind: 'docs',
          category: 'knowledge'
        }
      ]
    })
    const text = (result[0] as { type: 'text'; text: string }).text
    // 必须有段头
    expect(text).toContain('## 可用知识库')
    // knowledge 排在 uikit 之前，other 最后
    const kbIdx = text.indexOf('@product-spec')
    const uikitIdx = text.indexOf('@design-system')
    const otherIdx = text.indexOf('@logos')
    expect(kbIdx).toBeGreaterThan(0)
    expect(kbIdx).toBeLessThan(uikitIdx)
    expect(uikitIdx).toBeLessThan(otherIdx)
    // 检索由模型决定，@ 范围优先，未命中再扩展
    expect(text).toContain('`.external/product-spec/`。需要语义检索时可用 mcp__zvec-grep__zvec_grep_search（root=.external/product-spec）定位候选文件，再 Read 原文件核实')
    expect(text).toContain('优先在本轮 @ 选中的文件或目录中查找')
    expect(text).toContain('没有找到相关信息，再扩展')
    expect(text).toContain('是否检索由你根据问题决定，不要求调用工具')
    expect(text).not.toContain('或用 Grep/Glob 在目录内定位')
    expect(text).not.toContain('INDEX.md')
    expect(text).not.toContain('files.jsonl')
    // 有用户指令
    expect(text).toContain('## 用户指令')
    expect(text).toContain('参考一下设计系统')
  })

  it('externalRefs 空数组 → 不注入 ## 可用知识库 段', () => {
    const result = composeUserMessage({
      text: 'hello',
      externalRefs: []
    })
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).not.toContain('## 可用知识库')
    expect(text).toBe('hello')
  })

  it('含 external ref → 注入 .external 资源基线（App 运行时绑定），但业务规则不注入', () => {
    const result = composeUserMessage({
      text: '画一个登录页',
      externalRefs: [
        { alias: 'design-system', path: '.external/design-system', kind: 'ui-kit', category: 'uikit' }
      ]
    })
    const text = (result[0] as { type: 'text'; text: string }).text
    // App 运行时基线：.external 资源复制约束
    expect(text).toContain('## 资源引用约束（必须遵守，不可跳过）')
    expect(text).toContain('禁止产物里出现指向 .external/')
    // 业务规则（token/组件）已交还用户，不再注入
    expect(text).not.toContain('禁止裸色值')
    expect(text).not.toContain('## UI 资产库')
    expect(text).not.toContain('## UI 生成方法论')
    // uikit 仍作为可用资料列出，供 AI 主动 Read
    expect(text).toContain('## 可用知识库')
    expect(text).toContain('@design-system')
  })

  it('externalRefs 为空 → 不注入 .external 资源基线', () => {
    const result = composeUserMessage({ text: '把按钮改圆角' })
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).not.toContain('## 资源引用约束')
    expect(text).toBe('把按钮改圆角')
  })

  it('externalRefs 只有 knowledge → 注入资源基线，不注入业务规则', () => {
    const result = composeUserMessage({
      text: '看下需求',
      externalRefs: [
        { alias: 'product-spec', path: '.external/product-spec', kind: 'docs', category: 'knowledge' }
      ]
    })
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 资源引用约束（必须遵守，不可跳过）')
    expect(text).not.toContain('禁止裸色值')
    expect(text).toContain('## 可用知识库')
  })

  it('资源包说明和项目说明在用户指令前注入', () => {
    const result = composeUserMessage({
      text: '生成一个结算页面',
      externalRefs: [{
        alias: 'mobile-design',
        path: '.external/mobile-design',
        kind: 'local',
        category: 'uikit',
        instructions: '优先复用 components/ 下的组件。',
        usageNote: '本项目只使用移动端规范。'
      }]
    })
    const text = (result[0] as { type: 'text'; text: string }).text
    expect(text).toContain('## 资源包使用说明')
    expect(text).toContain('优先复用 components/ 下的组件。')
    expect(text).toContain('本项目只使用移动端规范。')
    expect(text.indexOf('## 资源包使用说明')).toBeLessThan(text.indexOf('## 用户指令'))
  })
})
