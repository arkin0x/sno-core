/**
 * Where `seeds-vectors.json` beside this file came from. It is a byte-for-byte
 * copy of the cyberspace spec repository's `decks/seeds-vectors.json`, which
 * `decks/seeds-vectors.mjs` produces from the reference interpreter.
 *
 * To update it: copy the spec's file over this one, set the commit and the
 * hash below, and run the tests. `vectorsSource.test.ts` checks the hash
 * always, and checks the copy against the spec repository's file when a
 * checkout is present (CYBERSPACE_SPEC_DIR, or `../cyberspace` beside this
 * repository).
 */
export const SEEDS_VECTORS_SOURCE = {
  repository: 'https://github.com/arkin0x/cyberspace',
  path: 'decks/seeds-vectors.json',
  /** DECK-0008: opacity, a fourth standard gene (cyberspace PR #102, squash-merged to master), 2026-11-12. */
  commit: '9294c9822bc15f78e44fdac12192430574b52e6c',
  sha256: '2af31f204da133b6e60ac7cd516c08dc42bc4e2936090409e625229a44b71008',
} as const
