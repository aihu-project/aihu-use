import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertReleaseManifest, rootFor } from './release-manifest.mjs'

const root = rootFor()
const packDir = resolve(root, '.release')
mkdirSync(packDir, { recursive: true })
for (const entry of readdirSync(packDir)) {
  if (!entry.endsWith('.tgz')) continue
  rmSync(resolve(packDir, entry), { force: true })
}

const manifest = JSON.parse(readFileSync(resolve(root, 'package.json')))
const releaseManifest = assertReleaseManifest(root)
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir], { cwd: root, encoding: 'utf8' }))[0]
const archive = resolve(packDir, packed.filename)
const fail = (message) => { throw new Error(`packed package check failed: ${message}`) }
if (!existsSync(archive)) fail(`npm pack did not create ${archive}`)
const archives = readdirSync(packDir).filter((entry) => entry.endsWith('.tgz'))
if (archives.length !== 1 || archives[0] !== packed.filename) fail(`expected exactly one captured tarball in ${packDir}`)

const expectedFilename = `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`
if (packed.filename !== expectedFilename) fail(`archive ${packed.filename} is not ${expectedFilename}`)
const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
for (const field of ['name', 'version', 'main', 'module', 'types', 'exports', 'files', 'sideEffects', 'dependencies', 'peerDependencies', 'peerDependenciesMeta']) {
  if (JSON.stringify(packedManifest[field]) !== JSON.stringify(manifest[field])) fail(`${field} changed in tarball`)
}
if (JSON.stringify(packedManifest).includes('workspace:')) fail('workspace dependency leaked into tarball')

const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort()
const expectedEntries = releaseManifest.files.map(({ path }) => `package/${path}`).sort()
if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
  const added = entries.filter((entry) => !expectedEntries.includes(entry))
  const missing = expectedEntries.filter((entry) => !entries.includes(entry))
  fail(`tarball contents differ (added: ${added.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`)
}

for (const { path, sha512 } of releaseManifest.files) {
  const packedDigest = createHash('sha512')
    .update(execFileSync('tar', ['-xOf', archive, `package/${path}`]))
    .digest('hex')
  if (packedDigest !== sha512) fail(`${path} digest differs from the reviewed release manifest`)
}
const registryDigest = releaseManifest.files.find(({ path }) => path === 'composable-registry.json')?.sha512
const packedRegistryDigest = createHash('sha512')
  .update(execFileSync('tar', ['-xOf', archive, 'package/composable-registry.json']))
  .digest('hex')
if (packedRegistryDigest !== registryDigest) fail('packed composable-registry.json is not byte-identical to the clean generated artifact')

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
