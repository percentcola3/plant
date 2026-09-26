import { projectHashFor, sessionJsonlPath } from '../src/main/claude-headless/session-id'
import assert from 'node:assert'
import { join } from 'node:path'
import { homedir } from 'node:os'

assert.strictEqual(projectHashFor('/Users/dev/Code/flower'), '-Users-didi-Code-ui-client')
assert.strictEqual(projectHashFor('/tmp/test'), '-tmp-test')
assert.strictEqual(projectHashFor('/'), '-')

const expected = join(homedir(), '.claude', 'projects', '-Users-didi-Code-ui-client', 'abc.jsonl')
assert.strictEqual(sessionJsonlPath('/Users/dev/Code/flower', 'abc'), expected)

console.log('✅ session-id 纯函数验证通过')
