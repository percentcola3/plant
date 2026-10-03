export type DesignTemplateId = 'antd' | 'heroui'
export type DesignTemplateFile = { path: string; purpose: string }
export type DesignTemplateFileContent = DesignTemplateFile & { content: string }
export type DesignTemplate = {
  id: DesignTemplateId
  name: string
  description: string
  version: string
  files: DesignTemplateFile[]
}

const guideFiles: DesignTemplateFile[] = [
  { path: 'README.md', purpose: '模板结构与定制方法' },
  { path: 'AI_USAGE.md', purpose: '告诉 AI 如何读取和使用这套资产' },
  { path: 'design-guide.md', purpose: '设计规范、组件规则与官方文档入口' },
  { path: 'SKILL.md', purpose: '可单独安装的设计工作流程' },
]

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    id: 'antd', name: 'Ant Design', version: '6.6.5',
    description: '适合管理后台与业务表单，示范如何组织设计规范、主题 Token 和组件资料。',
    files: [...guideFiles,
      { path: 'components/antd/theme/palette.css', purpose: '资产库色板示例' },
      { path: 'components/antd/theme/theme.css', purpose: '资产库默认主题示例' },
      { path: 'components/antd/button/index.html', purpose: '可直接预览的按钮视觉示例' },
      { path: 'components/antd/button/style.css', purpose: '按钮状态与样式写法' },
      { path: 'components/antd/button/README.md', purpose: '组件目录结构与使用边界' },
      { path: 'team-theme.json', purpose: 'React 项目的团队主题配置' },
      { path: 'team-theme.css', purpose: 'HTML 原型的样式参考' },
      { path: 'upstream/seed.ts', purpose: '官方基础 Token 源码' },
      { path: 'upstream/LICENSE', purpose: '官方源码许可证' },
    ],
  },
  {
    id: 'heroui', name: 'HeroUI', version: 'v3 · styles 3.2.6',
    description: '适合现代产品界面，示范如何组织亮暗主题、真实组件样式和团队覆盖。',
    files: [...guideFiles,
      { path: 'components/heroui/theme/palette.css', purpose: '资产库色板示例' },
      { path: 'components/heroui/theme/theme.css', purpose: '资产库亮色主题示例' },
      { path: 'components/heroui/theme/theme-dark.css', purpose: '资产库暗色主题示例' },
      { path: 'components/heroui/button/index.html', purpose: '可直接预览的按钮视觉示例' },
      { path: 'components/heroui/button/style.css', purpose: '按钮状态与样式写法' },
      { path: 'components/heroui/button/README.md', purpose: '组件目录结构与使用边界' },
      { path: 'team-theme.css', purpose: '团队品牌色与主题覆盖' },
      { path: 'upstream/variables.css', purpose: '官方亮暗主题变量' },
      { path: 'upstream/button.css', purpose: '官方 Button 样式与状态' },
      { path: 'upstream/LICENSE', purpose: '官方源码许可证' },
    ],
  },
]
