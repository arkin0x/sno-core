import { describe, expect, it } from 'vitest'
import { EYE_REACH, autoEye, drawnEye, eyeChosen, readEye, withEye } from './eye.js'
import { fromPayload, toPayload, type ShardModel } from './shards.js'

const at = (y: number): ShardModel['vertices'][number] => {
  const p = Math.floor(y / 120)
  const t = y - p * 120
  return t ? { p: [0, p, 0], t: [0, t, 0], c: [1, 1, 1] } : { p: [0, p, 0], c: [1, 1, 1] }
}
const column = (bottom: number, top: number): ShardModel => ({
  id: 'x', name: 'column', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
  vertices: [at(bottom), at(top), { ...at(bottom), p: [1, at(bottom).p[1], 0] }],
  faces: [[0, 1, 2]],
})

// Every kind of value in the DECK-0003 §1.17 table, one to one with
// sno-reference.py drawn_eye.
describe('eye (DECK-0003 §1.17)', () => {
  it('reads three whole numbers of ticks, each -7680 to 7680', () => {
    expect(EYE_REACH).toBe(7680)
    for (const e of [[0, 159, 0], [0, 0, 0], [-12, 30, -480], [EYE_REACH, -EYE_REACH, 0]]) expect(readEye(e)).toEqual(e)
    expect(Object.is(readEye([-0, 1, 0])![0], 0)).toBe(true)
  })

  it('reads anything else as absent: the automatic eye, never a refusal', () => {
    for (const bad of [undefined, null, '0,159,0', 159, {}, { x: 0, y: 159, z: 0 }, [], [0, 159], [0, 159, 0, 0],
      [0, 159.5, 0], [0, EYE_REACH + 1, 0], [-EYE_REACH - 1, 0, 0], [0, '159', 0], [0, true, 0], [0, null, 0], [0, NaN, 0], [0, Infinity, 0]]) {
      expect(readEye(bad), JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('works the automatic eye out in integers: one eighth of the height below the top', () => {
    expect(autoEye(column(0, 240))).toEqual([0, 210, 0])
    expect(autoEye(column(96, 168))).toEqual([0, 159, 0])
    expect(autoEye(column(-120, 120))).toEqual([0, 90, 0])
    expect(autoEye(column(0, 10))).toEqual([0, 9, 0])
    expect(autoEye(column(-240, -120))).toEqual([0, -135, 0])
    expect(autoEye({ vertices: [] })).toEqual([0, 0, 0])
  })

  it('draws a written eye, [0, 0, 0] included, and the automatic one otherwise', () => {
    const s = column(0, 240)
    expect(drawnEye(s)).toEqual([0, 210, 0])
    expect(eyeChosen(s)).toBe(false)
    expect(drawnEye({ ...s, extra: { eye: [0, 0, 0] } })).toEqual([0, 0, 0])
    expect(eyeChosen({ ...s, extra: { eye: [0, 0, 0] } })).toBe(true)
    // Not held to the shape: above it, and behind it.
    expect(drawnEye({ ...s, extra: { eye: [0, 600, 0] } })).toEqual([0, 600, 0])
    expect(drawnEye({ ...s, extra: { eye: [0, 30, -480] } })).toEqual([0, 30, -480])
    expect(drawnEye({ ...s, extra: { eye: [0, 1.5, 0] } })).toEqual([0, 210, 0])
  })

  it('writes an eye, removes it for AUTO, and never writes a malformed one', () => {
    const s = column(0, 240)
    const set = withEye(s, [0, 159, 0])
    expect(set.extra).toEqual({ eye: [0, 159, 0] })
    expect(withEye(set, undefined).extra).toBeUndefined()
    expect(withEye(s, [0, 0, 0]).extra).toEqual({ eye: [0, 0, 0] })
    expect(withEye(set, [0, 0.5, 0]).extra).toBeUndefined()
    expect(withEye({ ...s, extra: { glow: ['fog', 1, 1] } }, [1, 2, 3]).extra).toEqual({ glow: ['fog', 1, 1], eye: [1, 2, 3] })
  })

  it('rides the wire in extra, both ways, and a version 1 eye turns with its vertices', () => {
    const out = toPayload(withEye(column(0, 240), [0, 159, -24])) as unknown as Record<string, unknown>
    expect(out.eye).toEqual([0, 159, -24])
    const back = fromPayload(JSON.parse(JSON.stringify(out)), 'y')!
    expect(drawnEye(back)).toEqual([0, 159, -24])
    const v1 = fromPayload({ ...out, v: 1, colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] }, 'z')!
    expect(drawnEye(v1)).toEqual([0, 159, 24])
    expect((toPayload(v1) as unknown as Record<string, unknown>).eye).toEqual([0, 159, 24])
    // A malformed eye on the wire is carried as it is and never refuses the object.
    expect(fromPayload({ ...out, eye: 'up' }, 'w')).not.toBeNull()
  })
})
