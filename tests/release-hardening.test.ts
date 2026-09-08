import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const gate = join(root, 'scripts/check-oidc-auth.mjs')

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

  it.each(['NPM_CONFIG_REGISTRY_AUTHTOKEN', 'NPM_CONFIG_REGISTRY_AUTH', 'NPM_CONFIG_REGISTRY_AUTH-TOKEN'])(
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
