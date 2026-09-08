import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const packDir = resolve(root, '.release')
mkdirSync(packDir, { recursive: true })
for (const entry of readdirSync(packDir)) {
  if (!entry.endsWith('.tgz')) continue
  rmSync(resolve(packDir, entry), { force: true })
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')))
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' }))[0]
const archive = resolve(packDir, packed.filename)
const fail = (message) => { throw new Error(`packed package check failed: ${message}`) }
if (!existsSync(archive)) fail(`npm pack did not create ${archive}`)
const archives = readdirSync(packDir).filter((entry) => entry.endsWith('.tgz'))
if (archives.length !== 1 || archives[0] !== packed.filename) fail(`expected exactly one captured tarball in ${packDir}`)

const expectedFilename = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`
if (packed.filename !== expectedFilename) fail(`archive ${packed.filename} is not ${expectedFilename}`)
const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
for (const field of ['name', 'version', 'main', 'module', 'types', 'exports', 'files', 'sideEffects', 'dependencies', 'peerDependencies']) {
  if (JSON.stringify(packedManifest[field]) !== JSON.stringify(manifest[field])) fail(`${field} changed in tarball`)
}
if (JSON.stringify(packedManifest).includes('workspace:')) fail('workspace dependency leaked into tarball')

const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort()
const walk = (dir, prefix) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = `${prefix}/${entry.name}`
  return entry.isDirectory() ? walk(resolve(dir, entry.name), path) : [path]
})
const expectedEntries = ['package/LICENSE', 'package/README.md', 'package/composable-registry.json', 'package/package.json', ...walk(resolve(root, 'dist'), 'package/dist')].sort()
if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
  const added = entries.filter((entry) => !expectedEntries.includes(entry))
  const missing = expectedEntries.filter((entry) => !entries.includes(entry))
  fail(`tarball contents differ (added: ${added.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`)
}

function exportTargets(value, path = 'exports') {
  if (typeof value === 'string') return [[path, value]]
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, child]) => exportTargets(child, `${path}.${key}`))
}
for (const [path, target] of exportTargets(packedManifest.exports)) {
  if (!target.startsWith('./')) fail(`${path} must be a relative package export`)
  if (!entries.includes(`package/${target.slice(2)}`)) fail(`${path} points to missing ${target}`)
}
for (const field of ['main', 'module', 'types']) {
  const target = packedManifest[field]
  if (!target.startsWith('./') || !entries.includes(`package/${target.slice(2)}`)) fail(`${field} points to missing ${target}`)
}
if (process.env.GITHUB_ENV) writeFileSync(process.env.GITHUB_ENV, `AIHU_PACK_PATH=${archive}\n`, { flag: 'a' })
console.log(`verified ${archive}: ${packedManifest.name}@${packedManifest.version} (${entries.length} files)`)
