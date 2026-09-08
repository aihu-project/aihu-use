import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const archive = process.argv[2]
if (!archive) throw new Error('usage: npm run consumer:smoke -- /absolute/path/package.tgz')
const dir = mkdtempSync(join(tmpdir(), 'aihu-use-consumer-'))
execFileSync('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' })
execFileSync('npm', ['install', '--no-audit', '--no-fund', resolve(archive)], { cwd: dir, stdio: 'inherit' })
execFileSync(process.execPath, ['--input-type=module', '-e', `
  const pkg = await import('@aihu/use')
  if (typeof pkg.useCounter !== 'function' || typeof pkg.useEventListener !== 'function') throw new Error('missing public root export')
  const registry = await import('@aihu/use/composable-registry.json', { with: { type: 'json' } })
  if (registry.default.schemaVersion !== 1 || registry.default.package !== '@aihu/use') throw new Error('portable registry contract failed')
  const counter = pkg.useCounter({ initial: 2 })
  if (counter.count() !== 2) throw new Error('consumer runtime contract failed')
`], { cwd: dir, stdio: 'inherit' })
console.log(`isolated consumer passed in ${dir}`)
