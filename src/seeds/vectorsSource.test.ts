// The vendored vectors are the spec's file, unchanged.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './hash.js'
import { SEEDS_VECTORS_SOURCE } from './fixtures/seedsVectors.fixture.js'

const here = dirname(fileURLToPath(import.meta.url))
const vendored = readFileSync(join(here, 'fixtures', 'seeds-vectors.json'))
const repoRoot = resolve(here, '..', '..')
const specDir = process.env.CYBERSPACE_SPEC_DIR ?? resolve(repoRoot, '..', 'cyberspace')
const specFile = join(specDir, SEEDS_VECTORS_SOURCE.path)

describe('vendored seeds-vectors.json', () => {
  it('has the hash recorded with its source commit', () => {
    expect(sha256Hex(new Uint8Array(vendored))).toBe(SEEDS_VECTORS_SOURCE.sha256)
  })
  it.skipIf(!existsSync(specFile))('matches the spec repository checkout byte for byte', () => {
    const spec = readFileSync(specFile)
    // A difference means the spec's vectors moved on: copy the file, update the fixture's commit and hash.
    expect(sha256Hex(new Uint8Array(spec)), specFile).toBe(sha256Hex(new Uint8Array(vendored)))
  })
})
