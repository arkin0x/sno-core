/**
 * snoPalette.test.ts - reading a palette out of an event (DECK-0003 §1.3b).
 *
 * The rules here are the format's, not any one client's: the `c` tags are the
 * encoding and their order is the index, `content` is a legacy second chance,
 * and a palette with a hole in it is not a repaired palette. Both clients
 * resolve an object's colours through this, so it is tested here rather than
 * only in whichever app happened to add the feature.
 *
 * snocrash's useNostr.test.ts covers the same reader from the other side,
 * round-tripping it against the writer that makes the events. That is a claim
 * about that app's writer; this is a claim about the reader alone.
 */

import { describe, it, expect } from 'vitest'
import { BUILT_IN, parsePaletteEvent, resolvePalette, type Palette } from './snoPalette.js'

/** A real palette, published by espy.you, from the kind 3367 survey of 2026-09-16. */
const ESPY = {
  tags: [
    ['c', '#B4B4AF'], ['c', '#FC4755'], ['c', '#D1242B'],
    ['c', '#694F34'], ['c', '#A1785D'], ['c', '#01AE85'],
    ['layout', 'horizontal'],
    ['alt', 'Color moment: #B4B4AF, #FC4755, #D1242B, #694F34, #A1785D, #01AE85'],
  ],
  content: '\u{1F3F0}',
}

const ESPY_COLORS: Palette = [
  [180, 180, 175], [252, 71, 85], [209, 36, 43],
  [105, 79, 52], [161, 120, 93], [1, 174, 133],
]

/** Any well-formed reference. What it points at is the fetched event, not this. */
const NEVENT = 'nevent1qqsfktxwwrls0r3e465nl47z7x3p9zsj8gqye7w5lhpakewwzw9r44cpp4mhxue69uhkummn9ekx7mqwz8u63'

describe('parsePaletteEvent', () => {
  it('reads a real event off the network, whose colours are in c tags', () => {
    expect(parsePaletteEvent(ESPY)).toEqual(ESPY_COLORS)
  })

  it('takes the tags in document order, because the order is the index', () => {
    expect(parsePaletteEvent({ tags: [['c', '#00ff00'], ['c', '#ff0000']] })).toEqual([[0, 255, 0], [255, 0, 0]])
  })

  it('prefers the tags to a content that also parses', () => {
    expect(parsePaletteEvent({ ...ESPY, content: JSON.stringify(['#000000', '#111111', '#222222']) })).toEqual(ESPY_COLORS)
  })

  it('falls back to the legacy content form, which is read and never written', () => {
    expect(parsePaletteEvent({ content: JSON.stringify(['#000000', '#111111']) })).toEqual([[0, 0, 0], [17, 17, 17]])
    // And a string on its own is that content, for a caller that only has it.
    expect(parsePaletteEvent(JSON.stringify(['#000000', '#111111']))).toEqual([[0, 0, 0], [17, 17, 17]])
  })

  it('fails the whole tag path on one malformed value rather than leaving a hole', () => {
    // Skipping it would shift every index after it, which is a different
    // palette rather than a repaired one.
    expect(parsePaletteEvent({ tags: [['c', '#ff0000'], ['c', 'ff0000'], ['c', '#0000ff']] })).toBeNull()
    expect(parsePaletteEvent({ tags: [['c', '#ff0000'], ['c'], ['c', '#0000ff']] })).toBeNull()
  })

  it('holds to the 2..256 bound a palette has everywhere else', () => {
    expect(parsePaletteEvent({ tags: [['c', '#ff0000']] })).toBeNull()
    expect(parsePaletteEvent({ tags: Array.from({ length: 257 }, () => ['c', '#ff0000']) })).toBeNull()
    expect(parsePaletteEvent({ tags: Array.from({ length: 256 }, () => ['c', '#ff0000']) })).toHaveLength(256)
  })

  it('is a failed fetch and never an error when the event carries nothing', () => {
    for (const ev of [{ content: '\u{1F3A8}', tags: [] }, { content: 'not json', tags: [['name', 'x']] }, {}]) {
      expect(parsePaletteEvent(ev)).toBeNull()
    }
  })
})

describe('resolvePalette against a reference', () => {
  it('accepts an nevent as well as an naddr, since an immutable event has no address', () => {
    expect(resolvePalette(NEVENT, ESPY)).toEqual(ESPY_COLORS)
    expect(resolvePalette('naddr1qqxnzdenxvmnxdfhxg6rwwfjqy88wumn8ghj7mn0wvhxcmmv', ESPY)).toEqual(ESPY_COLORS)
  })

  it('draws an object in the built-in when the reference does not resolve', () => {
    // A reference is never load-bearing: the worst case is an object in the
    // wrong colours, never one that cannot be drawn at all.
    expect(resolvePalette(NEVENT)).toBe(BUILT_IN)
    expect(resolvePalette(NEVENT, { content: 'not json' })).toBe(BUILT_IN)
  })

  it('still refuses a string that names nothing', () => {
    expect(resolvePalette('some palette')).toBeNull()
  })
})
