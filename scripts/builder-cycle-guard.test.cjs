const { test } = require('node:test')
const assert = require('node:assert/strict')
const { guardCollector } = require('./builder-cycle-guard.cjs')
function collectorClass() {
  return class Collector {
    async _getNodeModules(dependencies, result) {
      for (const dep of dependencies) {
        const entry = { name: dep.name, dependencies: [] }
        result.push(entry)
        await this._getNodeModules(dep.dependencies, entry.dependencies)
      }
    }
  }
}
test('terminates self-referencing hoisted graph without dropping sibling packages', async () => {
  const Collector = collectorClass(); guardCollector(Collector); guardCollector(Collector)
  const cycle = new Set(); cycle.add({ name: 'tree-sitter-wasms', dependencies: cycle })
  const result = []
  await new Collector()._getNodeModules(new Set([
    { name: 'zvec-grep', dependencies: cycle }, { name: 'node-pty', dependencies: new Set() }
  ]), result)
  assert.deepEqual(result.map(p => p.name), ['zvec-grep', 'node-pty'])
  assert.equal(result[0].dependencies[0].name, 'tree-sitter-wasms')
  assert.deepEqual(result[0].dependencies[0].dependencies, [])
})
test('retains shared dependencies in independent branches instead of globally deduplicating', async () => {
  const Collector = collectorClass(); guardCollector(Collector)
  const shared = new Set([{ name: 'shared', dependencies: new Set() }]); const result = []
  await new Collector()._getNodeModules(new Set([
    { name: 'a', dependencies: shared }, { name: 'b', dependencies: shared }
  ]), result)
  assert.equal(result[0].dependencies[0].name, 'shared')
  assert.equal(result[1].dependencies[0].name, 'shared')
})
