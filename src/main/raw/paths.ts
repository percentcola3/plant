import { join } from 'node:path'

// 剪页库工作区物理布局（baseDir = knowledge workspace path）：
//   <baseDir>/<id>/index.md      条目主体（YAML frontmatter + markdown）
//   <baseDir>/<id>/images/       条目关联图片
// 文件树扫描器只列 md/mdx/markdown/txt（见 workspaces/doc-tree.ts），
// 所以 images/ 目录不会出现在树里，但磁盘上仍然存在，markdown 里图片用相对路径引。

export function rawEntryDir(baseDir: string, id: string): string {
  return join(baseDir, id)
}

export function rawEntryMarkdown(baseDir: string, id: string): string {
  return join(rawEntryDir(baseDir, id), 'index.md')
}

export function rawEntryImagesDir(baseDir: string, id: string): string {
  return join(rawEntryDir(baseDir, id), 'images')
}
