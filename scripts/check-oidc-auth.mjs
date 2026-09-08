import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const authKey = /(?:^|[-_])auth(?:token|-token)?$|^_auth(?:token|-token)?$/i

function envValue(name) {
  return process.env[name] ?? Object.entries(process.env).find(([key]) => key.toUpperCase() === name)?.[1] ?? ''
}

function configPaths() {
  const home = envValue('HOME') || envValue('USERPROFILE') || homedir()
  const user = envValue('NPM_CONFIG_USERCONFIG') || join(home, '.npmrc')
  const global = envValue('NPM_CONFIG_GLOBALCONFIG') || join(envValue('NPM_CONFIG_PREFIX') || dirname(dirname(process.execPath)), 'etc', 'npmrc')
  return [...new Set([
    envValue('NPM_CONFIG_PROJECTCONFIG') || join(root, '.npmrc'),
    user,
    join(home, '.npmrc'),
    global,
  ].filter(Boolean).map((file) => resolve(file)))]
}

for (const [name, value] of Object.entries(process.env)) {
  if (!value) continue
  const upper = name.toUpperCase()
  if (upper === 'NPM_TOKEN' || upper === 'NODE_AUTH_TOKEN' ||
      (upper.startsWith('NPM_CONFIG_') && authKey.test(name.slice('NPM_CONFIG_'.length)))) {
    throw new Error(`${name} must be empty; npm trusted publishing uses GitHub OIDC`)
  }
}

for (const file of configPaths()) {
  if (!existsSync(file)) continue
  for (const [index, line] of readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue
    const match = trimmed.match(/^([^=]+?)\s*=\s*(.*)$/)
    if (!match || !authKey.test(match[1].trim())) continue
    throw new Error(`classic npm auth setting ${match[1].trim()} found in ${file}:${index + 1}; trusted publishing requires OIDC`)
  }
}

console.log('classic npm auth checks passed; release may use npm trusted publishing')
