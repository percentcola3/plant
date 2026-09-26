import type { ExternalRefCategory } from './types'

export type BuiltinResourcePackage = {
  alias: string
  category: ExternalRefCategory
  url: string
  description: string
}

// 这里只保存推荐仓库元数据。应用启动时不 clone，必须由用户在资源包页面主动安装。
// 默认不内置任何仓库，需要的用户在资源包页自行添加。
export const BUILTIN_RESOURCE_PACKAGES: readonly BuiltinResourcePackage[] = []
