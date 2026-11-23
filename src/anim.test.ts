/**
 * anim.test.ts: reading `anim` as DECK-0003 §1.14 says (first four entries;
 * malformed, unknown, out of range or faster than two cycles a second
 * ignored; never a throw), every one of the spec's 19 vectors at their Unix
 * times (§2 frame, ticks), the canonical writer, and the field carried
 * through fromPayload and toPayload, never a reason to refuse an object.
 */
import { describe, expect, it } from 'vitest'
import { animOf, composeRender, hasAnim, MOTIONS, motionPose, newPose, phaseAt, REACH, readAnim, readMotion, withAnim, writeMotion, type Motion } from './anim.js'
import { fromPayload, newShard, toPayload, type ShardModel } from './shards.js'

const m = (raw: unknown): Motion => {
  const r = readMotion(raw)
  if (!r) throw new Error(`unread: ${JSON.stringify(raw)}`)
  return r
}

/** A column-major 4x4 applied to a point. */
function apply(e: ArrayLike<number>, p: [number, number, number]): [number, number, number] {
  return [
    e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12],
    e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13],
    e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14],
  ]
}

/** A point (ticks, §2 frame) moved by `anim` at phases `u` (one per motion), through the render-frame matrix a client draws with. */
function drawnAt(anim: unknown[], u: number[], p: [number, number, number]): number[] {
  const motions = readAnim(anim)
  const poses = motions.map((x, i) => motionPose(x, u[i], newPose()))
  const out = new Array<number>(16)
  composeRender(poses, poses.length, out)
  return apply(out, [p[0] / 120, p[1] / 120, p[2] / 120]).map((v) => v * 120)
}
const drawn = (anim: unknown[], t: number, p: [number, number, number]): number[] => drawnAt(anim, readAnim(anim).map((x) => phaseAt(x, t)), p)

const T0 = 1_795_132_800
const SHUTTLE = ['path', 1, 60, 0, [0, 0, 0, 2], [1920, 0, 0, 2], [1920, 0, 0, 1], [0, 0, 0, 2]]

describe('the motion table', () => {
  it('holds every motion the spec names, in one place', () => {
    expect(Object.keys(MOTIONS).sort()).toEqual(['lift', 'orbit', 'path', 'slide', 'swing', 'turn'])
  })
})

describe('DECK-0003 §1.14 vectors (cyberspace ce3f948), every row: poses at Unix times', () => {
  const rows: Array<[unknown[], number, [number, number, number], [number, number, number]]> = [
    [[['turn', 'y', 1, 6, 0]], T0 + 1.5, [120, 0, 0], [0, 0, -120]],
    [[['turn', 'y', -1, 6, 0]], T0 + 1.5, [120, 0, 0], [0, 0, 120]],
    [[['turn', 'y', 2, 1, 0]], T0 + 0.125, [120, 0, 0], [0, 0, -120]],
    [[['turn', 'y', 1, 31536000, 0]], T0, [120, 0, 0], [106.328475, 0, 55.626033]],
    [[['turn', 'y', 7, 90, 30]], 1795171234.567, [120, 0, 0], [-111.164515, 0, -45.19348]],
    [[['swing', 'x', 60, 1, 2, 0]], T0 + 0.5, [0, 120, 0], [0, 60, 103.923048]],
    [[['slide', 'y', 240, 1, 4, 90]], T0 + 0.5, [0, 0, 0], [0, 169.705627, 0]],
    [[['orbit', 'y', 480, 1, 8, 0]], T0 + 2, [120, 0, 0], [600, 0, 0]],
    [[['orbit', 'z', 480, 1, 8, 0]], T0 + 1, [0, 0, 0], [339.411255, 339.411255, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 2, [0, 0, 0], [0, 0, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 7.5, [0, 0, 0], [0, 720, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 12, [0, 0, 0], [0, 1440, 0]],
    [[['lift', 'y', 1440, 25, 1, 20, 0]], T0 + 16, [0, 0, 0], [0, 1290.24, 0]],
    [[['lift', 'y', -480, 0, 1, 8, 0]], T0 + 1, [0, 0, 0], [0, -75, 0]],
    [[SHUTTLE], T0 + 6, [0, 0, 0], [0, 0, 0]],
    [[SHUTTLE], T0 + 30, [0, 0, 0], [1440, 0, 0]],
    [[SHUTTLE], T0 + 54, [0, 0, 0], [672, 0, 0]],
    [[['turn', 'z', 1, 8, 0], ['slide', 'x', 120, 1, 2, 0]], T0 + 2.5, [120, 0, 0], [74.077988, 110.865544, 0]],
    [[['slide', 'x', 120, 1, 2, 0], ['turn', 'z', 1, 8, 0]], T0 + 2.5, [120, 0, 0], [-91.844024, 221.731088, 0]],
  ]
  it('has all 19 rows', () => expect(rows).toHaveLength(19))
  rows.forEach(([anim, t, p, want], i) => {
    it(`row ${i + 1}: ${JSON.stringify(anim).slice(0, 60)} at t ${t}`, () => {
      expect(readAnim(anim)).toHaveLength(anim.length)
      const got = drawn(anim, t, p)
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 4)
    })
  })
  it('the year-long turn is at phase 337/365 at T0, and the odd moment at 39469/90000', () => {
    expect(phaseAt({ c: 1, b: 31_536_000, phi: 0 }, T0)).toBeCloseTo(337 / 365, 9)
    expect(phaseAt({ c: 7, b: 90, phi: 30 }, 1795171234.567)).toBeCloseTo(39469 / 90000, 6)
  })
})

describe('reading', () => {
  it('ignores malformed entries, unknown words, out-of-range integers and too-fast rates; keeps the rest; never throws', () => {
    const bad = [
      ['turn', 'w', 1, 1, 0], ['turn', 'y', 1.5, 1, 0], ['turn', 'y', 1, 0, 0], ['turn', 'y', 1, 1, 360], ['turn', 'y', 1, 1],
      ['turn', 'y', 0, 1, 0], ['turn', 'y', 3, 1, 0], ['turn', 'y', 1201, 600, 0], ['turn', 'y', 1, 31_536_001, 0], ['turn', 'Y', 1, 1, 0],
      ['turn', 'y', '1', 1, 0], ['turn', 'y', 1, 1, -1], ['turn', 'y', 1, 1, 0, 0],
      ['swing', 'x', 0, 1, 1, 0], ['swing', 'x', 181, 1, 1, 0], ['slide', 'x', 0, 1, 1, 0], ['slide', 'x', REACH + 1, 1, 1, 0],
      ['orbit', 'y', 0, 1, 1, 0], ['orbit', 'y', REACH + 1, 1, 1, 0], ['lift', 'y', 0, 10, 1, 1, 0], ['lift', 'y', 10, 50, 1, 1, 0], ['lift', 'y', -REACH - 1, 0, 1, 1, 0],
      ['path', 1, 1, 0, [0, 0, 0, 1]], ['path', 1, 1, 0, [0, 0, 0, 0], [1, 1, 1, 1]], ['path', 1, 1, 0, [0, 0, 0, 1001], [1, 1, 1, 1]],
      ['path', 1, 1, 0, [REACH + 1, 0, 0, 1], [1, 1, 1, 1]], ['path', 1, 1, 0, [0, 0, 1], [1, 1, 1, 1]], ['path', 'y', 1, 1, 0, [0, 0, 0, 1], [1, 1, 1, 1]],
      ['path', 1, 1, 0, ...Array.from({ length: 33 }, () => [0, 0, 0, 1])],
      ['spin', 'y', 1, 1, 0], ['constructor', 'y', 1, 1, 0], ['__proto__', 'y', 1, 1, 0], 'turn', 7, null, {}, [],
    ]
    for (const b of bad) expect(readMotion(b)).toBeNull()
    expect(readAnim([...bad.slice(0, 4), ['turn', 'y', 1, 3, 0]])).toHaveLength(0) // past the fourth entry
    expect(readAnim([bad[0], ['turn', 'y', 1, 3, 0]]).map((x) => x.b)).toEqual([3])
    for (const raw of [undefined, null, 'x', 3, {}, [[]], [[null]]]) expect(readAnim(raw)).toEqual([])
  })

  it('reads the boundary values (at most two cycles a second, b up to a year, distances up to 4,096 units)', () => {
    expect(REACH).toBe(4096 * 120)
    for (const ok of [['turn', 'y', 2, 1, 359], ['turn', 'y', -63_072_000, 31_536_000, 0], ['turn', 'y', 1200, 600, 0], ['turn', 'y', 1, 31_536_000, 0], ['slide', 'z', REACH, 1, 1, 0], ['lift', 'x', -REACH, 49, 1, 1, 0], ['orbit', 'y', 7681, 1, 1, 0],
      ['path', 1, 1, 0, [-REACH, REACH, 0, 1000], [0, 0, 0, 1]], ['path', 1, 1, 0, ...Array.from({ length: 32 }, () => [0, 0, 0, 1])]]) expect(readMotion(ok)).not.toBeNull()
  })

  it('reads at most the first four entries', () => {
    const five = Array.from({ length: 5 }, (_, i) => ['turn', 'y', 1, i + 1, 0])
    expect(readAnim(five).map((x) => x.b)).toEqual([1, 2, 3, 4])
  })

  it('reads the field from extra, top level first, once per model', () => {
    const s = { ...newShard('t'), extra: { anim: [['turn', 'y', 1, 20, 0]] } } as ShardModel
    expect(hasAnim(s)).toBe(true)
    expect(animOf(s)).toBe(animOf(s))
    expect(hasAnim(newShard('still'))).toBe(false)
    expect(hasAnim({ ...newShard('bad'), extra: { anim: 'spin please' } } as ShardModel)).toBe(false)
    const top = { ...newShard('top'), anim: [['turn', 'x', 1, 2, 0]], extra: { anim: [['turn', 'y', 1, 20, 0]] } } as ShardModel
    expect(animOf(top)[0].b).toBe(2)
  })
})

describe('the phase', () => {
  it('keeps its precision when b divides the time, negative c runs backward, φ offsets', () => {
    const r = m(['turn', 'y', 1, 144, 90])
    expect(phaseAt(r, 144 * 6800)).toBeCloseTo(0.25, 12)
    expect(phaseAt(r, 144 * 6800 + 36)).toBeCloseTo(0.5, 12)
    expect(phaseAt(m(['turn', 'y', -1, 4, 0]), 1)).toBeCloseTo(0.75, 12)
  })
  it('stays in [0, 1) for odd times and rates', () => {
    for (const t of [0, -1.5, 1e9 + 0.999999, T0 + 0.1234567]) {
      for (const r of [{ c: 7, b: 90, phi: 359 }, { c: -63_072_000, b: 31_536_000, phi: 1 }, { c: 2, b: 1, phi: 0 }]) {
        const u = phaseAt(r, t)
        expect(u).toBeGreaterThanOrEqual(0)
        expect(u).toBeLessThan(1)
      }
    }
  })
  it('the rest pose (phase 0) of turn, swing, slide and lift is the object as written', () => {
    const list = readAnim([['turn', 'y', 1, 3, 0], ['swing', 'x', 30, 1, 1, 0], ['slide', 'z', 99, 1, 1, 0], ['lift', 'y', 600, 10, 1, 1, 0]])
    const poses = list.map((x) => motionPose(x, 0, newPose()))
    const out = new Array<number>(16)
    composeRender(poses, poses.length, out)
    expect(out.map((v) => Math.round(v * 1e12) / 1e12 + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  })
})

describe('a motion made by hand', () => {
  it('with a word the table does not hold is held still, never a throw', () => {
    const odd = { word: 'toString', axis: 1, p: [], pts: [], c: 1, b: 1, phi: 0 } as Motion
    expect(motionPose(odd, 0.3, newPose())).toEqual({ axis: -1, angle: 0, t: [0, 0, 0] })
  })
})

describe('writing', () => {
  it('writes canonically: c/b in lowest terms, a forward swing or slide, path weights with no common factor', () => {
    expect(writeMotion(m(['turn', 'y', 3, 60, 0]))).toEqual(['turn', 'y', 1, 20, 0])
    expect(writeMotion(m(['turn', 'y', -6, 9, 10]))).toEqual(['turn', 'y', -2, 3, 10])
    expect(writeMotion(m(['swing', 'x', 30, -2, 6, 30]))).toEqual(['swing', 'x', 30, 1, 3, 150])
    expect(writeMotion(m(['slide', 'y', 99, -1, 4, 270]))).toEqual(['slide', 'y', 99, 1, 4, 270])
    expect(writeMotion(m(['lift', 'y', 99, 10, -1, 4, 0]))).toEqual(['lift', 'y', 99, 10, -1, 4, 0])
    expect(writeMotion(m(['path', 2, 4, 7, [0, 0, 0, 2], [10, 0, 0, 4]]))).toEqual(['path', 1, 2, 7, [0, 0, 0, 1], [10, 0, 0, 2]])
  })
  it('a backward swing written forward draws the same pose at every moment', () => {
    const back = m(['swing', 'x', 30, -2, 6, 30])
    const fwd = m(writeMotion(back))
    for (const t of [T0, T0 + 0.7, T0 + 2.2]) {
      const a = drawnAt([['swing', 'x', 30, -2, 6, 30]], [phaseAt(back, t)], [0, 120, 0])
      const b = drawnAt([writeMotion(back)], [phaseAt(fwd, t)], [0, 120, 0])
      for (let k = 0; k < 3; k++) expect(a[k]).toBeCloseTo(b[k], 6)
    }
  })
  it('withAnim keeps what a reader reads, canonically, in extra; empty removes it; unchanged is the same object', () => {
    const s = newShard('w')
    const { shard, kept } = withAnim(s, [['turn', 'y', 2, 40, 0], ['bogus', 1], ['turn', 'y', 3, 1, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(kept).toHaveLength(2)
    expect(shard.extra?.anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect((toPayload(shard) as unknown as Record<string, unknown>).anim).toEqual([['turn', 'y', 1, 20, 0], ['slide', 'z', 6, 1, 4, 0]])
    expect(withAnim(shard, shard.extra?.anim).shard).toBe(shard)
    const cleared = withAnim(shard, []).shard
    expect(cleared.extra?.anim).toBeUndefined()
    expect('anim' in (toPayload(cleared) as object)).toBe(false)
  })
})

describe('the payload', () => {
  const base = { v: 2, name: 't', unit: 0, mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], colors: [229, 229, 229], faces: [[0, 1, 2]] }
  it('fromPayload carries anim as written and toPayload writes it back', () => {
    const anim = [['turn', 'y', 1, 6, 0], ['lift', 'y', 1440, 25, 1, 20, 0]]
    const s = fromPayload({ ...base, anim }, 'a')!
    expect(s).not.toBeNull()
    expect(animOf(s).map((x) => x.word)).toEqual(['turn', 'lift'])
    expect((toPayload(s) as unknown as Record<string, unknown>).anim).toEqual(anim)
  })
  it('never refuses an object for anything in anim (§1.9 rule 17)', () => {
    for (const anim of [null, 'spin', 7, {}, [null], [['turn']], [['turn', 'y', 9, 1, 0]], Array.from({ length: 9 }, () => ['turn', 'y', 1, 1, 0])]) {
      const s = fromPayload({ ...base, anim }, 'b')
      expect(s).not.toBeNull()
      expect(animOf(s!).length).toBeLessThanOrEqual(4)
    }
  })
})
