// electron-builder 26.15.3: the hoisted tree-sitter-wasms graph contains a
// back-edge. _getNodeModules recursively expands it without an ancestor guard.
// A back-edge resolves through ancestor node_modules; do not expand it again.
// Keep this patch scoped to the pinned builder version until upstream fixes it.
const marker = Symbol.for('workspace.builderCycleGuard')
function guardCollector(Collector) {
  const prototype = Collector.prototype
  if (prototype[marker]) return
  const original = prototype._getNodeModules
  if (typeof original !== 'function') throw new Error('electron-builder dependency collector API changed')
  const stacks = new WeakMap()
  prototype._getNodeModules = async function (dependencies, result) {
    let ancestors = stacks.get(this)
    if (!ancestors) { ancestors = new Set(); stacks.set(this, ancestors) }
    if (ancestors.has(dependencies)) return
    ancestors.add(dependencies)
    try { return await original.call(this, dependencies, result) }
    finally { ancestors.delete(dependencies) }
  }
  prototype[marker] = true
}
function beforePack() {
  const { version } = require('app-builder-lib/package.json')
  if (version !== '26.15.3') throw new Error(`Recheck builder-cycle-guard before using app-builder-lib ${version}`)
  const { NodeModulesCollector } = require('app-builder-lib/out/node-module-collector/nodeModulesCollector.js')
  guardCollector(NodeModulesCollector)
}
module.exports = beforePack
module.exports.guardCollector = guardCollector
