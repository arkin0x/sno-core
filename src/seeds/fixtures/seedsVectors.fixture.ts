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
  /** DECK-0008: Seeds (draft) (#91), 2026-11-10. */
  commit: '6a397f8c52c371b85a4b886e5eda0e054bb1e62e',
  sha256: 'c48c25dda86930a9e6bd98dd6dc9a882b50eea7a9c14204e69c460c5c1d32e61',
} as const
