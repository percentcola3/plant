import type { ExternalRefCategory } from './types'

export type BuiltinResourcePackage = {
  alias: string
  category: ExternalRefCategory
  url: string
  description: string
}

// 这里只保存推荐仓库元数据。应用启动时不 clone，必须由用户在资源包页面主动安装。
export const BUILTIN_RESOURCE_PACKAGES: readonly BuiltinResourcePackage[] = [
  {
    alias: 'POS前端',
    category: 'knowledge',
    url: 'git@git.example.internal:example-team/soda-saas-b-pos.git',
    description: 'POS SAAS 前端代码知识库'
  },
  {
    alias: '管理端前端',
    category: 'knowledge',
    url: 'git@git.example.internal:example-team/soda-saas-b-manager.git',
    description: 'SAAS B 管理端前端代码知识库'
  },
  {
    alias: 'SaaSUI',
    category: 'uikit',
    url: 'https://git.example.internal/example-team/saas-desgin-ai.git',
    description: 'SAAS UX 组件、Token、图片和图标资产库'
  }
]
