/**
 * The published @aihu/use registry is the portable boundary for consumers
 * that live outside this monorepo. Keep it byte-for-byte in parity with the
 * generated language-server table so a compiler or LSP cannot silently use a
 * different auto-import set after extraction.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMPOSABLE_REGISTRY } from '../src/composable-registry.ts'

interface RegistryContract {
  schemaVersion: number
  package: string
  entries: typeof COMPOSABLE_REGISTRY
}

const contractPath = resolve(import.meta.dirname, '../composable-registry.json')
const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as RegistryContract

describe('@aihu/use portable registry contract', () => {
  it('matches the generated language-server table exactly', () => {
    expect(contract.schemaVersion).toBe(1)
    expect(contract.package).toBe('@aihu/use')
    expect(contract.entries).toEqual(COMPOSABLE_REGISTRY)
  })

  it('contains unique names and specifiers for downstream consumers', () => {
    const names = contract.entries.map((entry) => entry.name)
    const specifiers = contract.entries.map((entry) => entry.specifier)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(specifiers).size).toBe(specifiers.length)
    for (const entry of contract.entries) {
      expect(entry.name).toMatch(/^use[A-Z]/)
      expect(entry.specifier).toMatch(/^@aihu\/use\//)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('rejects redirected inputs and outputs unless an explicit fixture mode is enabled', () => {
    const fixtureRoot = resolve(import.meta.dirname, '../scripts/fixtures/composable-registry')
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/gen-composable-hover-registry.ts', '--check'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        COMPOSABLE_REGISTRY_RS: resolve(fixtureRoot, 'use_registry.rs'),
        COMPOSABLE_REGISTRY_OUT: resolve(fixtureRoot, 'expected-match.ts'),
        COMPOSABLE_REGISTRY_CONTRACT_OUT: resolve(fixtureRoot, 'expected-match.json'),
        COMPOSABLE_USE_SRC_ROOT: resolve(fixtureRoot, 'nonexistent-src'),
      },
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('overrides are fixture-only')
  })

  it.each(['true', '1'])('allows fully redirected fixtures in explicit test mode under CI=%s', (ci) => {
    const fixtureRoot = resolve(import.meta.dirname, '../scripts/fixtures/composable-registry')
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/gen-composable-hover-registry.ts', '--check', '--fixture'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: ci,
        COMPOSABLE_REGISTRY_FIXTURE: '1',
        COMPOSABLE_REGISTRY_RS: resolve(fixtureRoot, 'use_registry.rs'),
        COMPOSABLE_REGISTRY_OUT: resolve(fixtureRoot, 'expected-match.ts'),
        COMPOSABLE_REGISTRY_CONTRACT_OUT: resolve(fixtureRoot, 'expected-match.json'),
        COMPOSABLE_USE_SRC_ROOT: resolve(fixtureRoot, 'nonexistent-src'),
      },
    })
    expect(result.status).toBe(0)
  })

  it.each(['true', '1'])('does not allow fixture redirects under CI=%s without the explicit fixture command', (ci) => {
    const fixtureRoot = resolve(import.meta.dirname, '../scripts/fixtures/composable-registry')
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/gen-composable-hover-registry.ts', '--check'], {
      cwd: resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: ci,
        COMPOSABLE_REGISTRY_FIXTURE: '1',
        COMPOSABLE_REGISTRY_RS: resolve(fixtureRoot, 'use_registry.rs'),
        COMPOSABLE_REGISTRY_OUT: resolve(fixtureRoot, 'expected-match.ts'),
        COMPOSABLE_REGISTRY_CONTRACT_OUT: resolve(fixtureRoot, 'expected-match.json'),
        COMPOSABLE_USE_SRC_ROOT: resolve(fixtureRoot, 'nonexistent-src'),
      },
    })
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('fixture-only')
  })
})
