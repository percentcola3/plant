// 统一的 auto wip commit message 生成。
//
// 设计师向 App 的核心约定：用户不应该被频繁要求"写一句版本说明"——后台 saga
// 已经自动 commit + push 了，前台主动触发的 sync / 完成需求 / 保存进度也走同样
// 自动机制，不再弹窗强制手填。语义化 commit 留给"打版本"那种少数显式动作。
//
// scope 用来区分触发源：
//   - 'sync'      远程同步前的兜底保存
//   - 'mainline'  同步主分支前的兜底保存
//   - 'home'      切回项目首页前的兜底保存
//   - 'switch'    切需求分支前的兜底保存
//   - 'complete'  完成需求前的最终保存
//   - 'save'      用户主动点保存进度按钮（兜底）
export function autoCommitMessage(scope:
  'sync' | 'mainline' | 'home' | 'switch' | 'complete' | 'save'
): string {
  return `wip(${scope}): ${new Date().toISOString()}`
}
