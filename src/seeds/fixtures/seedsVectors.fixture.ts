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
  /** DECK-0008: opacity, a fourth standard gene (cyberspace PR #102, branch deck-0008-opacity-gene), 2026-11-11. */
  commit: '506bf066dbff2b2a11eb37a9cf26cfdb2a12a792',
  sha256: '49a12710dc255fa4f72314cd2992b4fbcf7b70ac03a37febcd21d79592489c7e',
} as const
