/**
 * src/composable-registry.ts
 *
 * GENERATED — do not hand-edit. Source of truth:
 *   src/<name>/index.ts (names, specifiers, and doc comments)
 *
 * Regenerate: npm run gen:composable-registry
 * (FEL-342 / #427 follow-up — LSP composable-awareness)
 */

export interface ComposableRegistryEntry {
  /** Bare call name, e.g. `useMouse`. */
  name: string
  /** Module specifier the compiler auto-imports, e.g. `@aihu/use/useMouse`. */
  specifier: string
  /** One-line purpose, extracted from the composable's doc comment. */
  description: string
}

export const COMPOSABLE_REGISTRY: readonly ComposableRegistryEntry[] = [
  { name: 'useFixtureAlpha', specifier: '@aihu/use/useFixtureAlpha', description: '' },
  { name: 'useFixtureBeta', specifier: '@aihu/use/useFixtureBeta', description: '' },
]
