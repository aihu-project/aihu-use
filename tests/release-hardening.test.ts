import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const gate = join(root, 'scripts/check-oidc-auth.mjs')
const releaseManifestGate = join(root, 'scripts/release-manifest.mjs')
const packGate = join(root, 'scripts/verify-pack.mjs')
const releaseGate = join(root, 'scripts/check-release.mjs')

function isolated() {
  const dir = mkdtempSync(join(tmpdir(), 'aihu-use-auth-'))
  const project = join(dir, 'project.npmrc')
  const user = join(dir, 'user.npmrc')
  const global = join(dir, 'global.npmrc')
  for (const file of [project, user, global]) writeFileSync(file, '')
  return {
    dir,
    project,
    user,
    global,
    env: {
      ...process.env,
      NPM_CONFIG_PROJECTCONFIG: project,
      NPM_CONFIG_USERCONFIG: user,
      NPM_CONFIG_GLOBALCONFIG: global,
    },
  }
}

function run(env: NodeJS.ProcessEnv) {
  try {
    return { ok: true, output: execFileSync(process.execPath, [gate], { env, encoding: 'utf8' }) }
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('OIDC release gate', () => {
  it.each([
    ['_authToken', 'project'],
    ['_auth', 'user'],
    ['_auth-token', 'global'],
    ['username', 'project'],
    ['password', 'user'],
    ['email', 'global'],
    ['certfile', 'project'],
    ['keyfile', 'user'],
  ])('rejects %s in the %s npmrc without exposing the secret', (key, source) => {
    const files = isolated()
    const secret = 'super-secret-regression-token'
    writeFileSync(files[source as 'project' | 'user' | 'global'], `//registry.npmjs.org/:${key}=${secret}\n`)
    const result = run(files.env)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('classic npm auth setting')
    expect(result.output).not.toContain(secret)
  })

  it('checks the default user npmrc when the configured user path is unset', () => {
    const files = isolated()
    const home = join(files.dir, 'home')
    mkdirSync(home)
    const defaultUser = join(home, '.npmrc')
    writeFileSync(defaultUser, '//registry.npmjs.org/:_auth=super-secret-regression-token\n')
    const env = { ...files.env, HOME: home }
    for (const name of Object.keys(env)) {
      if (name.toUpperCase() === 'NPM_CONFIG_USERCONFIG') delete env[name]
    }
    const result = run(env)
    expect(result.ok).toBe(false)
    expect(result.output).toContain(defaultUser)
    expect(result.output).not.toContain('super-secret-regression-token')
  })

  it.each([
    'NPM_CONFIG_REGISTRY_AUTHTOKEN',
    'NPM_CONFIG_REGISTRY_AUTH',
    'NPM_CONFIG_REGISTRY_AUTH-TOKEN',
    'NPM_CONFIG_USERNAME',
    'NPM_CONFIG_PASSWORD',
    'NPM_CONFIG_EMAIL',
    'NPM_CONFIG_CERTFILE',
    'NPM_CONFIG_KEYFILE',
    'NPM_CONFIG_//REGISTRY.NPMJS.ORG/:_AUTHTOKEN',
  ])(
    'rejects %s environment configuration',
    (name) => {
      const files = isolated()
      const result = run({ ...files.env, [name]: 'super-secret-regression-token' })
      expect(result.ok).toBe(false)
      expect(result.output).toContain(`${name} must be empty`)
      expect(result.output).not.toContain('super-secret-regression-token')
    },
  )
})

describe('release artifact and branch gates', () => {
  it('rejects an injected nested dist file against the checked 311-file manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aihu-use-pack-'))
    for (const file of ['package.json', 'README.md', 'LICENSE', 'composable-registry.json', 'release-manifest.json']) {
      cpSync(join(root, file), join(dir, file))
    }
    cpSync(join(root, 'dist'), join(dir, 'dist'), { recursive: true })
    const injected = join(dir, 'dist/injected/nested.js')
    mkdirSync(join(dir, 'dist/injected'))
    writeFileSync(injected, 'export const injected = true\n')
    const result = spawnSync(process.execPath, [releaseManifestGate], {
      cwd: root,
      env: { ...process.env, PACK_ROOT: dir },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('release manifest drift')
    expect(`${result.stdout}\n${result.stderr}`).toContain('injected/nested.js')
  })

  it('requires the reviewed tag to equal the exact origin default-branch tip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aihu-use-release-'))
    mkdirSync(join(dir, 'scripts'))
    cpSync(releaseGate, join(dir, 'scripts/check-release.mjs'))
    writeFileSync(join(dir, 'package.json'), '{"name":"@aihu/use","version":"1.0.0"}\n')
    const git = (args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git(['init', '-b', 'main'])
    git(['config', 'user.email', 'test@example.invalid'])
    git(['config', 'user.name', 'Release Test'])
    git(['add', '.'])
    git(['commit', '-m', 'tagged source'])
    git(['tag', 'v1.0.0'])
    writeFileSync(join(dir, 'README.md'), 'default branch advanced\n')
    git(['add', 'README.md'])
    git(['commit', '-m', 'reviewed merge'])
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    const result = spawnSync(process.execPath, [join(dir, 'scripts/check-release.mjs'), 'v1.0.0'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_SHA: git(['rev-parse', 'v1.0.0']).trim() },
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('exact reviewed default branch tip')
  })

  it('keeps pack verification on the strict manifest path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aihu-use-pack-gate-'))
    for (const file of ['package.json', 'README.md', 'LICENSE', 'composable-registry.json', 'release-manifest.json']) {
      cpSync(join(root, file), join(dir, file))
    }
    cpSync(join(root, 'dist'), join(dir, 'dist'), { recursive: true })
    mkdirSync(join(dir, 'dist/injected'))
    writeFileSync(join(dir, 'dist/injected/nested.js'), 'export const injected = true\n')
    const result = spawnSync(process.execPath, [packGate], {
      cwd: root,
      env: { ...process.env, PACK_ROOT: dir },
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('release manifest drift')
  })
})
