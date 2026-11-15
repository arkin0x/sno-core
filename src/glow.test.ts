import { describe, expect, it } from 'vitest'
import {
  GLOW_REACH, drawnGlow, drawnPointSize, glowWire, readGlow, readPointSize, suggestGlowStyle, withGlow, withPointSize,
} from './glow.js'
import { fromPayload, normalizeStored, toPayload, type ShardModel } from './shards.js'

const tri: ShardModel = {
  id: 'x', name: 'tri', unit: 3, extent: 8, mode: 'points', up: false, spin: 0, updatedAt: 0,
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [2, 0, 0], c: [1, 0, 0] }, { p: [0, 2, 0], c: [0, 0, 1] }],
  faces: [[0, 1, 2]],
}
const loose = (s: ShardModel) => toPayload(s) as unknown as Record<string, unknown>
const wire = (more: Record<string, unknown>) => JSON.parse(JSON.stringify({ ...toPayload(tri), ...more }))

// Every kind of value in the DECK-0003 §1.15 and §1.16 tables, one to one
// with sno-reference.py drawn_pointsize and drawn_glow.
const NOT_INTEGERS = [0.5, 120.5, '120', true, false, null, [120], {}, { v: 120 }]

describe('point size (DECK-0003 §1.15)', () => {
  it('reads a whole number of ticks from 0 to 7680', () => {
    for (const v of [0, 1, 48, 120, GLOW_REACH]) expect(readPointSize(v)).toBe(v)
    expect(Object.is(readPointSize(-0), 0)).toBe(true)
    expect(GLOW_REACH).toBe(7680)
  })

  it('reads anything else as absent, the reader\'s own size', () => {
    for (const bad of [-1, -120, GLOW_REACH + 1, 1e100, ...NOT_INTEGERS, undefined]) {
      expect(readPointSize(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('is drawn only in points mode, and never for an avatar', () => {
    const s = { ...tri, extra: { pointsize: 48 } }
    expect(drawnPointSize(s)).toBe(48)
    expect(drawnPointSize({ ...s, mode: 'solid' })).toBeUndefined()
    expect(drawnPointSize({ ...s, mode: 'lines' })).toBeUndefined()
    expect(drawnPointSize(s, { avatar: true })).toBeUndefined()
    expect(drawnPointSize({ ...s, extra: { pointsize: 0 } })).toBe(0)
  })
})

describe('glow (DECK-0003 §1.16)', () => {
  it('reads a word, a radius and a strength', () => {
    expect(readGlow(['fog', 240, 35])).toEqual({ style: 'fog', radius: 240, strength: 35 })
    expect(readGlow(['light', 1, 1])).toEqual({ style: 'light', radius: 1, strength: 1 })
    expect(readGlow(['light', GLOW_REACH, 100])).toEqual({ style: 'light', radius: 7680, strength: 100 })
  })

  it('reads anything else as no glow', () => {
    const bad: unknown[] = [
      undefined, null, 'fog', 240, {}, { style: 'fog', radius: 240, strength: 35 },
      [], ['fog'], ['fog', 240], ['fog', 240, 35, 0],
      ['Light', 240, 35], ['FOG', 240, 35], ['smog', 240, 35], ['haze', 240, 35], [1, 240, 35], [null, 240, 35],
      ['fog', 0, 35], ['fog', -1, 35], ['fog', GLOW_REACH + 1, 35], ['fog', 240.5, 35], ['fog', '240', 35], ['fog', null, 35],
      ['fog', 240, 0], ['fog', 240, -1], ['fog', 240, 101], ['fog', 240, 35.5], ['fog', 240, '35'], ['fog', 240, true],
    ]
    for (const b of bad) expect(readGlow(b), JSON.stringify(b)).toBeUndefined()
  })

  it('is drawn only in points mode, never for an avatar, and never multiplied by opacity', () => {
    const s = { ...tri, opacity: 0, extra: { glow: ['light', 240, 60] } }
    expect(drawnGlow(s)).toEqual({ style: 'light', radius: 240, strength: 60 })
    expect(drawnGlow({ ...s, mode: 'solid' })).toBeUndefined()
    expect(drawnGlow({ ...s, mode: 'lines' })).toBeUndefined()
    expect(drawnGlow(s, { avatar: true })).toBeUndefined()
  })
})

describe('carrying both through a round trip', () => {
  it('reads both from a payload into extra and writes them back unchanged', () => {
    const s = fromPayload(wire({ pointsize: 48, glow: ['fog', 240, 35] }), 'x')!
    expect(s.extra).toEqual({ pointsize: 48, glow: ['fog', 240, 35] })
    expect(drawnPointSize(s)).toBe(48)
    expect(drawnGlow(s)).toEqual({ style: 'fog', radius: 240, strength: 35 })
    const back = loose(s)
    expect(back.pointsize).toBe(48)
    expect(back.glow).toEqual(['fog', 240, 35])
  })

  it('carries a malformed value untouched and never refuses the object', () => {
    const s = fromPayload(wire({ pointsize: 'big', glow: ['smog', 240, 35] }), 'x')
    expect(s).not.toBeNull()
    expect(drawnPointSize(s!)).toBeUndefined()
    expect(drawnGlow(s!)).toBeUndefined()
  })

  it('keeps both in solid and lines, so changing the mode back brings them back', () => {
    const s = fromPayload(wire({ mode: 'solid', pointsize: 48, glow: ['light', 240, 35] }), 'x')!
    expect(drawnGlow(s)).toBeUndefined()
    expect(loose(s).glow).toEqual(['light', 240, 35])
    expect(drawnGlow({ ...s, mode: 'points' })).toEqual({ style: 'light', radius: 240, strength: 35 })
  })

  it('survives a stored model being loaded again', () => {
    const s = fromPayload(wire({ pointsize: 0, glow: ['fog', 960, 20] }), 'x')!
    const loaded = normalizeStored(JSON.parse(JSON.stringify(s)))
    expect(drawnPointSize(loaded)).toBe(0)
    expect(drawnGlow(loaded)).toEqual({ style: 'fog', radius: 960, strength: 20 })
  })
})

describe('setting both', () => {
  it('writes and removes the point size', () => {
    const a = withPointSize(tri, 48)
    expect(a.extra).toEqual({ pointsize: 48 })
    expect(loose(a).pointsize).toBe(48)
    const b = withPointSize(a, undefined)
    expect(b).not.toHaveProperty('extra')
    expect(toPayload(b)).not.toHaveProperty('pointsize')
    expect(withPointSize(tri, 0).extra).toEqual({ pointsize: 0 })
  })

  it('never writes a malformed point size', () => {
    for (const bad of [-1, 7681, 4.5, NaN]) expect(withPointSize(tri, bad)).not.toHaveProperty('extra')
  })

  it('writes and removes the glow, and keeps the other carried fields', () => {
    const base = { ...tri, extra: { sheen: 3 } }
    const a = withGlow(base, { style: 'fog', radius: 240, strength: 35 })
    expect(a.extra).toEqual({ sheen: 3, glow: ['fog', 240, 35] })
    expect(JSON.stringify(toPayload(a))).toContain('"glow":["fog",240,35]')
    expect(withGlow(a, undefined).extra).toEqual({ sheen: 3 })
  })

  it('never writes a malformed glow', () => {
    expect(withGlow(tri, { style: 'fog', radius: 0, strength: 35 })).not.toHaveProperty('extra')
    expect(withGlow(tri, { style: 'fog', radius: 240, strength: 101 })).not.toHaveProperty('extra')
    expect(withGlow(tri, { style: 'smog' as 'fog', radius: 240, strength: 35 })).not.toHaveProperty('extra')
  })

  it('does not change the model it was given', () => {
    const base = { ...tri, extra: { sheen: 3 } }
    withGlow(base, { style: 'light', radius: 240, strength: 35 })
    withPointSize(base, 48)
    expect(base.extra).toEqual({ sheen: 3 })
  })

  it('writes the wire form word first', () => {
    expect(glowWire({ style: 'light', radius: 240, strength: 35 })).toEqual(['light', 240, 35])
  })
})

describe('suggestGlowStyle', () => {
  it('suggests light for a bright color and fog for a dark one', () => {
    expect(suggestGlowStyle([1, 1, 1])).toBe('light')
    expect(suggestGlowStyle([1, 0.85, 0.2])).toBe('light')
    expect(suggestGlowStyle([0, 1, 0])).toBe('light')
    expect(suggestGlowStyle([0, 0, 0])).toBe('fog')
    expect(suggestGlowStyle([0.2, 0.25, 0.2])).toBe('fog')
    expect(suggestGlowStyle([0, 0, 1])).toBe('fog')
  })
})
