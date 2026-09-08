import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const archive = process.argv[2]
if (!archive) throw new Error('usage: npm run consumer:smoke -- /absolute/path/package.tgz')
const dir = mkdtempSync(join(tmpdir(), 'aihu-use-consumer-'))
execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' })
execFileSync('npm', ['install', '--no-audit', '--no-fund', resolve(archive)], { cwd: dir, stdio: 'inherit' })
// Optional peers are deliberately not pulled into the published package. Add
// the repository's built peer fixtures to this disposable consumer so every
// public subpath can be imported and evaluated, including integrations that
// reference an optional peer at module load time.
execFileSync('npm', [
  'install', '--ignore-scripts', '--no-audit', '--no-fund',
  resolve(new URL('../node_modules/@aihu/context', import.meta.url).pathname),
  resolve(new URL('../node_modules/@aihu/router', import.meta.url).pathname),
  resolve(new URL('../node_modules/jwt-decode', import.meta.url).pathname),
], { cwd: dir, stdio: 'inherit' })
const consumerScript = join(dir, 'consumer-check.mjs')
writeFileSync(consumerScript, `
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const packageName = '@aihu/use'
const packageDir = join(process.cwd(), 'node_modules/@aihu/use')
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
const exportKeys = Object.keys(manifest.exports ?? {})
if (!exportKeys.includes('.')) throw new Error('installed package has no public root export')
for (const key of exportKeys) {
  const specifier = key === '.' ? packageName : packageName + key.slice(1)
  const resolved = await import.meta.resolve(specifier)
  if (!resolved.startsWith('file://' + packageDir + '/')) throw new Error('export resolved outside installed package: ' + specifier)
  const namespace = key.endsWith('.json')
    ? await import(specifier, { with: { type: 'json' } })
    : await import(specifier)
  if (Object.keys(namespace).length === 0) throw new Error('public export has no runtime bindings: ' + specifier)
}
const pkg = await import(packageName)
if (typeof pkg.useCounter !== 'function' || typeof pkg.useEventListener !== 'function') throw new Error('missing public root export')
const registry = await import(packageName + '/composable-registry.json', { with: { type: 'json' } })
if (registry.default.schemaVersion !== 1 || registry.default.package !== packageName) throw new Error('portable registry contract failed')
const counter = pkg.useCounter({ initial: 2 })
if (counter.count() !== 2) throw new Error('consumer runtime contract failed')
console.log('resolved public exports:', exportKeys.length)
`)
execFileSync(process.execPath, [consumerScript], { cwd: dir, stdio: 'inherit' })
console.log(`isolated consumer passed in ${dir}`)
