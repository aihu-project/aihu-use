import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const truthy = (value) => /^(?:1|true|yes|on)$/i.test(value ?? '')
const restrictedExecution = () =>
  truthy(process.env.CI) ||
  truthy(process.env.GITHUB_ACTIONS) ||
  truthy(process.env.RELEASE_TAG) ||
  process.env.GITHUB_REF_TYPE === 'tag'

export const rootFor = (value = process.env.PACK_ROOT) => {
  if (value && (restrictedExecution() || process.env.PACK_ROOT_TEST_MODE !== '1')) {
    throw new Error('PACK_ROOT is test-only and is forbidden in CI/release verification')
  }
  return resolve(value ?? new URL('..', import.meta.url).pathname)
}

const walk = (dir, prefix) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = `${prefix}/${entry.name}`
  return entry.isDirectory() ? walk(resolve(dir, entry.name), path) : [path]
})

export function releasePaths(root) {
  const dist = resolve(root, 'dist')
  if (!existsSync(dist)) throw new Error(`release manifest source is missing ${dist}`)
  return ['LICENSE', 'README.md', 'composable-registry.json', 'package.json', ...walk(dist, 'dist')].sort()
}

const digest = (root, path) => createHash('sha512').update(readFileSync(resolve(root, path))).digest('hex')

export function releaseManifestFor(root) {
  const packageManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const files = releasePaths(root).map((path) => ({ path, sha512: digest(root, path) }))
  return {
    schemaVersion: 1,
    name: packageManifest.name,
    version: packageManifest.version,
    files,
  }
}

export function readReleaseManifest(root) {
  const file = resolve(root, 'release-manifest.json')
  if (!existsSync(file)) throw new Error(`release manifest is missing ${file}; run npm run gen:release-manifest -- --write`)
  return JSON.parse(readFileSync(file, 'utf8'))
}

export function assertReleaseManifest(root) {
  const expected = releaseManifestFor(root)
  const actual = readReleaseManifest(root)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const expectedPaths = new Set(expected.files.map(({ path }) => path))
    const actualPaths = new Set((actual.files ?? []).map(({ path }) => path))
    const added = [...expectedPaths].filter((path) => !actualPaths.has(path))
    const missing = [...actualPaths].filter((path) => !expectedPaths.has(path))
    throw new Error(
      `release manifest drift (added: ${added.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}; regenerate only with npm run gen:release-manifest -- --write)`,
    )
  }
  return expected
}

function main() {
  const root = rootFor()
  if (process.argv.includes('--write')) {
    writeFileSync(resolve(root, 'release-manifest.json'), `${JSON.stringify(releaseManifestFor(root), null, 2)}\n`)
    console.log(`[release-manifest] wrote ${releasePaths(root).length} files`)
    return
  }
  assertReleaseManifest(root)
  console.log(`[release-manifest] up to date (${releasePaths(root).length} files)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
