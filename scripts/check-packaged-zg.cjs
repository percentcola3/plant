// Verify zg in a built macOS app without loading a model or building an index.
// Usage: node scripts/check-packaged-zg.cjs /path/to/WorkSpace.app
const { spawnSync } = require('node:child_process')
const { realpathSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { getRawHeader } = require('@electron/asar')

function main() {
  if (process.argv.length !== 3) {
    throw new Error('Usage: node scripts/check-packaged-zg.cjs /path/to/WorkSpace.app')
  }
  const appPath = resolve(process.argv[2])
  const executable = join(appPath, 'Contents', 'MacOS', 'WorkSpace')
  const resources = join(appPath, 'Contents', 'Resources')
  const archive = join(resources, 'app.asar')
  const modules = realpathSync(join(resources, 'app.asar.unpacked', 'node_modules'))
  const script = join(modules, '@zvec', 'zvec-grep', 'dist', 'cli', 'index.js')
  const dependencies = getRawHeader(archive).header.files.node_modules
  if (!dependencies) throw new Error('Packaged node_modules is missing')

  // A build beneath the source checkout can silently resolve missing dependencies
  // from the source node_modules. Check archive layout before executing anything.
  const packed = []
  let fileCount = 0
  function inspect(entry, path, inheritedUnpacked = false) {
    const unpacked = inheritedUnpacked || entry.unpacked === true
    if (entry.files) {
      for (const [name, child] of Object.entries(entry.files)) {
        inspect(child, `${path}/${name}`, unpacked)
      }
    } else if (!entry.link) {
      fileCount += 1
      if (!unpacked) packed.push(path)
    }
  }
  inspect(dependencies, 'node_modules')
  if (packed.length) {
    throw new Error(`${packed.length} dependency files remain inside app.asar; zg cannot resolve them from app.asar.unpacked. Examples:\n${packed.slice(0, 5).join('\n')}`)
  }
  if (!fileCount) throw new Error('Packaged node_modules contains no files')

  function run(args) {
    const result = spawnSync(executable, args, {
      cwd: tmpdir(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '', NODE_OPTIONS: '' },
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Packaged zg probe failed (exit ${result.status}, signal ${result.signal ?? 'none'}):\n${result.stderr || result.stdout}`)
    }
    return result.stdout.trim()
  }

  const version = run([script, '--version'])
  const probe = `
    import assert from 'node:assert/strict';
    import { realpathSync } from 'node:fs';
    import { createRequire } from 'node:module';
    import { isAbsolute, relative } from 'node:path';
    import { fileURLToPath, pathToFileURL } from 'node:url';
    const [script, modules] = process.argv.slice(1);
    const require = createRequire(script);
    function checkPath(path) {
      const local = relative(modules, realpathSync(path));
      assert(!local.startsWith('..') && !isAbsolute(local), 'Dependency escaped packaged node_modules: ' + path);
    }
    for (const name of ['@modelcontextprotocol/client', 'zod', 'jsonc-parser', 'detect-libc', '@zvec/zvec', 'onnxruntime-node', 'onnxruntime-common']) {
      checkPath(require.resolve(name));
    }
    require('@zvec/zvec');
    const ort = require('onnxruntime-node');
    assert.deepEqual(new ort.Tensor('float32', new Float32Array([1]), [1]).dims, [1]);
    const transformersUrl = import.meta.resolve('@huggingface/transformers', pathToFileURL(script).href);
    checkPath(fileURLToPath(transformersUrl));
    const transformers = await import(transformersUrl);
    assert.equal(typeof transformers.pipeline, 'function');
    console.log('zvec native, ONNX native, and Transformers.js imports passed');
  `
  // Electron 32 embeds Node 20: the second import.meta.resolve argument needs
  // this flag to resolve the ESM entry from zg rather than the eval module.
  const nativeResult = run(['--experimental-import-meta-resolve', '--input-type=module', '-e', probe, script, modules])
  console.log(`Packaged zg ${version}: ${fileCount} dependency files unpacked; ${nativeResult}. No model or index was loaded.`)
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
