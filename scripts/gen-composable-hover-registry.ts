#!/usr/bin/env bun
/**
 * `gen:composable-registry` — regenerate the LSP's `@aihu/use` completion +
 * hover table from each composable's own leading JSDoc in
 *      `src/<...specifier-tail>/index.ts` — the one-line
 *      description after the `` `name` — `` prefix, already hand-written and
 *      maintained per FEL-342's ask for "hover docs (signature + one-line
 *      purpose)".
 *
 * Run after editing either source (adding a composable via `gen:use`, or
 * editing a composable's doc comment):
 *
 *   npm run gen:composable-registry          # regenerate
 *   npm run check:composable-registry        # CI: fail if stale
 *
 * Emits src/composable-registry.ts and composable-registry.json. The TypeScript
 * table is useful to compiler/LSP integrations while the JSON file is the
 * portable published contract for consumers in other repositories.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
// Fixture redirects are intentionally opt-in. A production/CI invocation must
// always read the checked source tree and write the checked artifacts, so a
// caller cannot redirect every input and output and make drift appear clean.
const overrideNames = [
  'COMPOSABLE_REGISTRY_OUT',
  'COMPOSABLE_REGISTRY_CONTRACT_OUT',
  'COMPOSABLE_USE_SRC_ROOT',
  'COMPOSABLE_REGISTRY_RS',
]
const hasOverride = overrideNames.some((name) => Boolean(process.env[name]))
const fixtureMode = process.env.COMPOSABLE_REGISTRY_FIXTURE === '1' && process.argv.includes('--fixture')
if (hasOverride && !fixtureMode) {
  throw new Error('composable registry overrides are fixture-only; invoke with --fixture and COMPOSABLE_REGISTRY_FIXTURE=1 for an isolated fixture')
}
const OUT_FILE = process.env.COMPOSABLE_REGISTRY_OUT
  ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_OUT)
  : join(ROOT, 'src/composable-registry.ts')
const CONTRACT_FILE = process.env.COMPOSABLE_REGISTRY_CONTRACT_OUT
  ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_CONTRACT_OUT)
  : join(ROOT, 'composable-registry.json')
const USE_SRC_ROOT = process.env.COMPOSABLE_USE_SRC_ROOT
  ? resolve(ROOT, process.env.COMPOSABLE_USE_SRC_ROOT)
  : join(ROOT, 'src')

interface ComposableEntry {
  name: string
  specifier: string
  description: string
}

function parseRegistry(): { name: string; specifier: string }[] {
  // The legacy Rust registry override is retained for gate-wiring's tiny
  // fixture pair. Production generation reads root-owned @aihu/use sources;
  // the standalone compiler consumes the resulting published contract.
  const legacyRegistry = process.env.COMPOSABLE_REGISTRY_RS
    ? resolve(ROOT, process.env.COMPOSABLE_REGISTRY_RS)
    : undefined
  if (legacyRegistry && existsSync(legacyRegistry)) {
    const text = readFileSync(legacyRegistry, 'utf8')
    return [...text.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map((match) => ({
      name: match[1],
      specifier: match[2],
    }))
  }
  const srcRoot = resolve(USE_SRC_ROOT)
  const familiesPath = join(ROOT, 'families.json')
  const families = existsSync(familiesPath)
    ? ((
        JSON.parse(readFileSync(familiesPath, 'utf8')) as {
          families?: Record<string, { autoImport?: boolean }>
        }
      ).families ?? {})
    : {}
  const entries: { name: string; specifier: string }[] = []
  const walk = (dir: string, tail: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'shared') continue
      const nextTail = tail ? `${tail}/${entry.name}` : entry.name
      const index = join(dir, entry.name, 'index.ts')
      if (existsSync(index)) {
        // Only directories declared as families have aggregate indexes that
        // are not composables. A root-level composable such as useMouse also
        // has an index.ts and must be registered directly.
        if (!tail && families[entry.name]) {
          walk(join(dir, entry.name), nextTail)
          continue
        }
        const family = tail ? tail.split('/')[0] : undefined
        if (!family || families[family]?.autoImport === true) {
          entries.push({ name: entry.name, specifier: `@aihu/use/${nextTail}` })
        }
        continue
      }
      walk(join(dir, entry.name), nextTail)
    }
  }
  walk(srcRoot, '')
  return entries
}

/**
 * The leading doc comment's one-line purpose, e.g.
 * `` `useMouse` — reactive mouse position: the reference SENSOR composable ``
 * → "reactive mouse position: the reference SENSOR composable".
 *
 * The name — description dash may wrap across several `* `-prefixed lines
 * before hitting a `(docs/plans/...)` citation or a blank line; join them,
 * strip the citation, and cap length so a hover tooltip stays one line.
 */
function descriptionFor(specifier: string): string {
  // specifier is `@aihu/use/<tail>` or `@aihu/use/<family>/<tail>`.
  const tail = specifier.replace(/^@aihu\/use\//, '')
  const srcFile = join(USE_SRC_ROOT, tail, 'index.ts')
  let text: string
  try {
    text = readFileSync(srcFile, 'utf8')
  } catch {
    return ''
  }
  const blockMatch = text.match(/\/\*\*([\s\S]*?)\*\//)
  if (!blockMatch?.[1]) return ''
  const joined = blockMatch[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = joined.match(/`[\w$]+`\s*(?:\([^)]*\)\s*)?—\s*(.+)/)
  if (!m?.[1]) return ''
  let desc = m[1]
    .replace(/\(docs\/plans\/[^)]*\)/g, '')
    .replace(/\(§[^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Cut at the first sentence boundary so the hover stays one line.
  const period = desc.indexOf('. ')
  if (period > 20) desc = desc.slice(0, period)
  desc = desc.replace(/[.:,]$/, '').trim()
  return desc.length > 140 ? `${desc.slice(0, 137)}...` : desc
}

function main(): void {
  const check = process.argv.includes('--check')
  let existing = ''
  if (check) {
    try {
      existing = readFileSync(OUT_FILE, 'utf8')
    } catch {
      existing = ''
    }
  }
  const raw = parseRegistry()
  const entries: ComposableEntry[] = raw
    .map(({ name, specifier }) => ({ name, specifier, description: descriptionFor(specifier) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // This JSON is the portable contract. It is shipped by @aihu/use so the
  // language server and compiler can validate/consume the registry after the
  // package is consumed independently; downstream tools need only this artifact.
  const contract = `${JSON.stringify(
    {
      schemaVersion: 1,
      package: '@aihu/use',
      entries,
    },
    null,
    2,
  )}\n`

  const lines: string[] = []
  lines.push('/**')
  lines.push(' * src/composable-registry.ts')
  lines.push(' *')
  lines.push(' * GENERATED — do not hand-edit. Source of truth:')
  lines.push(' *   src/<name>/index.ts (names, specifiers, and doc comments)')
  lines.push(' *')
  lines.push(' * Regenerate: npm run gen:composable-registry')
  lines.push(' * (FEL-342 / #427 follow-up — LSP composable-awareness)')
  lines.push(' */')
  lines.push('')
  lines.push('export interface ComposableRegistryEntry {')
  lines.push('  /** Bare call name, e.g. `useMouse`. */')
  lines.push('  name: string')
  lines.push('  /** Module specifier the compiler auto-imports, e.g. `@aihu/use/useMouse`. */')
  lines.push('  specifier: string')
  lines.push("  /** One-line purpose, extracted from the composable's doc comment. */")
  lines.push('  description: string')
  lines.push('}')
  lines.push('')
  lines.push('export const COMPOSABLE_REGISTRY: readonly ComposableRegistryEntry[] = [')
  for (const e of entries) {
    const desc = e.description.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
    lines.push(`  { name: '${e.name}', specifier: '${e.specifier}', description: '${desc}' },`)
  }
  lines.push(']')
  lines.push('')
  const output = lines.join('\n')

  if (check) {
    if (existing !== output) {
      console.error(
        `[gen-composable-registry] ${basename(OUT_FILE)} is stale — run: npm run gen:composable-registry`,
      )
      process.exit(1)
    }
    let existingContract = ''
    try {
      existingContract = readFileSync(CONTRACT_FILE, 'utf8')
    } catch {
      existingContract = ''
    }
    if (existingContract !== contract) {
      console.error(
        `[gen-composable-registry] ${basename(CONTRACT_FILE)} is stale — run: npm run gen:composable-registry`,
      )
      process.exit(1)
    }
    console.log('[gen-composable-registry] up to date')
    return
  }

  writeFileSync(OUT_FILE, output)
  writeFileSync(CONTRACT_FILE, contract)
  console.log(
    `[gen-composable-registry] wrote ${entries.length} entries to ${OUT_FILE} and ${CONTRACT_FILE}`,
  )
}

main()
