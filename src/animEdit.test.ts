/**
 * animEdit.test.ts: a motion editor's rules (animEdit.ts), in the field's own
 * frame and ticks. Presets write the canonical motions, sized for the object;
 * the speed converts both ways; every limit of DECK-0003 §1.14 holds with a
 * plain message; and whatever an edit makes, a reader reads back unchanged.
 */
import { describe, expect, it } from 'vitest'
import { readAnim, readMotion, REACH, writeMotion, type Motion } from './anim.js'
import {
  addPoint, addPreset, amountOf, cycleSeconds, LIMITS, listOf, mayFlicker, moveMotion, movePoint, objectReach, perMinute, pointsOf, PRESETS,
  rateFor, rawOf, removeMotion, removePoint, reverse, reversible, setAmount, setAxis, setPhase, setPoint, setRest, setSpeed, stepSpeed, type Edited,
} from './animEdit.js'

const m = (raw: unknown): Motion => readMotion(raw)!
const roundTrip = (e: Edited): unknown[][] => rawOf(listOf(rawOf(e.list)))

describe('presets write the canonical motions', () => {
  const want: Record<string, unknown[]> = {
    spin: ['turn', 'y', 1, 20, 0],
    bob: ['slide', 'y', 75, 1, 4, 0],
    pendulum: ['swing', 'x', 30, 1, 10, 0],
    slide: ['slide', 'x', 600, 1, 15, 0],
    elevator: ['lift', 'y', 1200, 25, 1, 30, 0],
    orbit: ['orbit', 'z', 600, 1, 30, 0],
    path: ['path', 1, 60, 0, [600, 0, 0, 1], [0, 0, 0, 1]],
  }
  for (const p of PRESETS) {
    it(`${p.label} writes ${JSON.stringify(want[p.id])}`, () => {
      const e = addPreset([], p.id, 600)
      expect(rawOf(e.list)).toEqual([want[p.id]])
      expect(roundTrip(e)).toEqual([want[p.id]])
    })
  }
  it('names live in the editor, never the data', () => {
    expect(PRESETS.map((p) => p.label)).toEqual(['SPIN', 'BOB', 'PENDULUM', 'BACK AND FORTH', 'ELEVATOR', 'FERRIS WHEEL', 'FOLLOW PATH'])
    for (const p of PRESETS) expect(['turn', 'swing', 'slide', 'orbit', 'lift', 'path']).toContain(p.make(240)[0])
  })
  it('size with the object, within the field\'s range', () => {
    expect(objectReach({ vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }] })).toBe(120)
    expect(objectReach({ vertices: [{ p: [3, -5, 1], t: [0, 0, 60], c: [1, 1, 1] }] })).toBe(600)
    expect(rawOf(addPreset([], 'slide', 99_999).list)[0][2]).toBe(REACH)
    expect(rawOf(addPreset([], 'bob', 120).list)[0][2]).toBe(15)
  })
  it('a fifth is refused with a plain message', () => {
    let list: Motion[] = []
    for (let i = 0; i < 4; i++) list = addPreset(list, 'spin', 120).list
    const e = addPreset(list, 'bob', 120)
    expect(e.list).toHaveLength(4)
    expect(e.note).toBe('Up to 4 motions')
  })
})

describe('speed: cycles a minute <-> c cycles every b seconds, lowest terms', () => {
  it('shows and stores exactly the speed shown, to two decimals', () => {
    expect(perMinute({ c: 1, b: 20 })).toBe(3)
    expect(perMinute({ c: -1, b: 4 })).toBe(-15)
    expect(rateFor(3)).toEqual({ c: 1, b: 20 })
    expect(rateFor(2.5)).toEqual({ c: 1, b: 24 })
    expect(rateFor(2.72)).toEqual({ c: 17, b: 375 })
    expect(rateFor(-3)).toEqual({ c: -1, b: 20 })
    for (const perMin of [0.01, 0.5, 1, 2.72, 3, 10, 25, 59.99, 120]) expect(perMinute(rateFor(perMin))).toBeCloseTo(perMin, 9)
  })
  it('clamps to two a second (120 a minute) with a message, and never stops', () => {
    expect(rateFor(10_000)).toEqual({ c: 2, b: 1, note: LIMITS.speed })
    expect(rateFor(Infinity)).toEqual({ c: 2, b: 1, note: LIMITS.speed })
    expect(LIMITS.speed).toBe('Top speed is 120 a minute')
    expect(rateFor(0)).toEqual({ c: 1, b: 6000, note: LIMITS.slowest })
    expect(rateFor(-0)).toMatchObject({ c: -1 })
  })
  it('warns about a motion that may flicker more than 3 times a second (§1.14 examples)', () => {
    expect(setSpeed([m(['turn', 'y', 1, 20, 0])], 0, 30).note).toBeUndefined()
    expect(setSpeed([m(['turn', 'y', 1, 20, 0])], 0, 31).note).toBe(LIMITS.flicker)
    expect(setSpeed([m(['lift', 'y', 240, 25, 1, 20, 0])], 0, 120).note).toBe(LIMITS.flicker)
    expect(setSpeed([m(['lift', 'y', 240, 25, 1, 20, 0])], 0, 60).note).toBeUndefined()
    const path = m(['path', 1, 1, 0, [1, 0, 0, 1], [2, 0, 0, 1], [3, 0, 0, 1], [4, 0, 0, 1], [0, 0, 0, 1]])
    expect(mayFlicker(path)).toBe(true)
  })
  it('the steppers walk a list of round speeds, keeping the direction', () => {
    expect(stepSpeed(2.72, 1)).toBe(3)
    expect(stepSpeed(2.72, -1)).toBe(2.5)
    expect(stepSpeed(-2.72, 1)).toBe(-3)
    expect(stepSpeed(120, 1)).toBe(120)
    expect(stepSpeed(0.1, -1)).toBe(0.1)
  })
  it('setSpeed and reverse write c/b seconds; a typed-back speed keeps its rate', () => {
    const list = [m(['turn', 'y', 1, 20, 0])]
    expect(rawOf(setSpeed(list, 0, 6).list)).toEqual([['turn', 'y', 1, 10, 0]])
    expect(rawOf(reverse(list, 0).list)).toEqual([['turn', 'y', -1, 20, 0]])
    const seven = [m(['turn', 'y', 1, 7, 0])]
    expect(rawOf(setSpeed(seven, 0, 8.57).list)).toEqual([['turn', 'y', 1, 7, 0]])
    expect(rawOf(setSpeed(seven, 0, 8.6).list)).toEqual([['turn', 'y', 43, 300, 0]])
  })
  it('a swing or a slide has no REVERSE (the field writes them forward)', () => {
    expect(['turn', 'swing', 'slide', 'orbit', 'lift', 'path'].filter((word) => reversible({ word }))).toEqual(['turn', 'orbit', 'lift', 'path'])
  })
})

describe('amounts: degrees or ticks, in the field\'s frame', () => {
  it('a slide\'s reach, a radius, a pendulum\'s degrees', () => {
    const list = readAnim([['slide', 'x', 120, 1, 1, 0], ['orbit', 'y', 240, 1, 1, 0], ['swing', 'z', 30, 1, 1, 0]])
    expect(amountOf(list[0])).toBe(120)
    expect(rawOf(setAmount(list, 0, 300).list)[0]).toEqual(['slide', 'x', 300, 1, 1, 0])
    expect(rawOf(setAmount(list, 1, 120.4).list)[1]).toEqual(['orbit', 'y', 120, 1, 1, 0])
    expect(rawOf(setAmount(list, 2, 45).list)[2]).toEqual(['swing', 'z', 45, 1, 1, 0])
  })
  it('limits: within 64 units, never zero, a pendulum 1 to 180 degrees', () => {
    const list = readAnim([['slide', 'x', 120, 1, 1, 0], ['swing', 'z', 30, 1, 1, 0], ['lift', 'y', 240, 10, 1, 1, 0]])
    expect(setAmount(list, 0, 99_999)).toMatchObject({ note: LIMITS.reach })
    expect(rawOf(setAmount(list, 0, 99_999).list)[0][2]).toBe(REACH)
    expect(rawOf(setAmount(list, 0, -5).list)[0][2]).toBe(1)
    expect(rawOf(setAmount(list, 1, 400).list)[1][2]).toBe(180)
    expect(rawOf(setAmount(list, 1, 0).list)[1][2]).toBe(1)
    expect(rawOf(setAmount(list, 2, 0).list)[2][2]).toBe(1)
    expect(rawOf(setAmount(list, 2, -240).list)[2][2]).toBe(-240)
    expect(rawOf(setAmount(list, 2, -0.2).list)[2][2]).toBe(-1)
    expect(setAmount(list, 0, NaN).list).toEqual(list)
  })
  it('a lift keeps its signed travel when its axis changes', () => {
    const list = [m(['lift', 'y', -240, 10, 1, 1, 0])]
    expect(rawOf(setAxis(list, 0, 2).list)[0]).toEqual(['lift', 'z', -240, 10, 1, 1, 0])
    expect(setAxis([m(['path', 1, 1, 0, [1, 0, 0, 1], [0, 0, 0, 1]])], 0, 1).list[0].axis).toBe(-1)
  })
  it('rest share 0 to 49 at each stop', () => {
    const list = [m(['lift', 'y', 240, 25, 1, 1, 0])]
    expect(rawOf(setRest(list, 0, 30).list)[0]).toEqual(['lift', 'y', 240, 30, 1, 1, 0])
    expect(setRest(list, 0, 80)).toMatchObject({ note: LIMITS.rest })
    expect(rawOf(setRest(list, 0, 80).list)[0][3]).toBe(49)
    expect(rawOf(setRest(list, 0, -5).list)[0][3]).toBe(0)
  })
  it('phase wraps into 0..359', () => {
    const list = [m(['turn', 'y', 1, 1, 0])]
    expect(rawOf(setPhase(list, 0, -15).list)[0]).toEqual(['turn', 'y', 1, 1, 345])
    expect(rawOf(setPhase(list, 0, 375).list)[0]).toEqual(['turn', 'y', 1, 1, 15])
    expect(rawOf(setAxis(list, 0, 0).list)[0]).toEqual(['turn', 'x', 1, 1, 0])
  })
})

describe('the list and a path\'s points', () => {
  it('reorders and removes motions; order is meaning', () => {
    const list = readAnim([['turn', 'y', 1, 1, 0], ['slide', 'x', 120, 1, 1, 0]])
    expect(rawOf(moveMotion(list, 1, -1).list).map((x) => x[0])).toEqual(['slide', 'turn'])
    expect(rawOf(moveMotion(list, 0, -1).list).map((x) => x[0])).toEqual(['turn', 'slide'])
    expect(rawOf(removeMotion(list, 0).list).map((x) => x[0])).toEqual(['slide'])
  })
  it('adds a point before the last (the home point stays last), up to 32, and keeps at least 2', () => {
    let list = [m(['path', 1, 1, 0, [600, 0, 0, 1], [0, 0, 0, 1]])]
    list = addPoint(list, 0).list
    expect(rawOf(list)[0].slice(4)).toEqual([[600, 0, 0, 1], [600, 120, 0, 1], [0, 0, 0, 1]])
    for (let i = 0; i < 40; i++) list = addPoint(list, 0).list
    expect(list[0].pts.length / 4).toBe(32)
    expect(addPoint(list, 0).note).toBe('Up to 32 points')
    const two = [m(['path', 1, 1, 0, [600, 0, 0, 1], [0, 0, 0, 1]])]
    expect(removePoint(two, 0, 0)).toMatchObject({ note: 'A path needs 2 points' })
    expect(rawOf(movePoint(two, 0, 0, 1).list)[0].slice(4)).toEqual([[0, 0, 0, 1], [600, 0, 0, 1]])
  })
  it('points in ticks; times written with no common factor', () => {
    const list = [m(['path', 1, 1, 0, [120, 240, -360, 2], [0, 0, 0, 2]])]
    expect(pointsOf(list[0])[0]).toEqual({ x: 120, y: 240, z: -360, time: 2 })
    expect(rawOf(list)[0].slice(4)).toEqual([[120, 240, -360, 1], [0, 0, 0, 1]])
    expect(rawOf(setPoint(list, 0, 0, 'z', 120).list)[0][4]).toEqual([120, 240, 120, 1])
    expect(rawOf(setPoint(list, 0, 1, 'time', 6).list)[0].slice(4)).toEqual([[120, 240, -360, 1], [0, 0, 0, 3]])
    expect(setPoint(list, 0, 1, 'time', 2).note).toBe(LIMITS.ratio)
    expect(setPoint(list, 0, 0, 'x', 99_999).note).toBe(LIMITS.reach)
    const capped = setPoint(list, 0, 0, 'time', 5000)
    expect(capped.list[0].pts[3]).toBe(1000)
    expect(capped.note).toBe(LIMITS.time)
    expect(rawOf(capped.list)[0].slice(4).map((p) => (p as number[])[3])).toEqual([500, 1])
  })
  it('the scrub runs through the longest motion\'s cycle, in seconds', () => {
    expect(cycleSeconds([{ c: 1, b: 20 }, { c: 1, b: 4 }])).toBe(20)
    expect(cycleSeconds([])).toBe(1)
  })
  it('whatever an edit makes, a reader reads back unchanged', () => {
    let list: Motion[] = []
    for (const id of ['spin', 'elevator', 'path', 'orbit'] as const) list = addPreset(list, id, 777).list
    list = setSpeed(list, 1, 7.3).list
    list = setAmount(list, 3, 1170).list
    list = addPoint(list, 2).list
    list = setPoint(list, 2, 1, 'y', -540).list
    const raw = rawOf(list)
    expect(readAnim(raw).map(writeMotion)).toEqual(raw)
  })
})
