/**
 * animClock.test.ts: the clock rules of DECK-0003 §1.14 (correct only past
 * 2 seconds, keep it up to date, drop it again) and the catch-up ease (the
 * shorter way round, at most three seconds, rest pose under reduced motion).
 */
import { describe, expect, it } from 'vitest'
import { readMotion, type Motion } from './anim.js'
import { correctionFor, easeSeconds, newPhaseState, offsetFrom, serverTimeOf, stepPhases, wrapHalf, type ClockReading, type ClockSample } from './animClock.js'

const sample = (offset: number, rtt = 100, resolution = 1): ClockSample => ({ sentMs: 1000, gotMs: 1000 + rtt, serverMs: 1000 + rtt / 2 + offset - resolution / 2, resolutionMs: resolution })
const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('correcting t', () => {
  it('takes the median of the samples, from the midpoint of each round trip', () => {
    expect(offsetFrom([sample(5000), sample(5200), sample(99999)])!.offsetMs).toBeCloseTo(5200, 6)
    expect(offsetFrom([])).toBeNull()
    expect(offsetFrom([{ sentMs: 10, gotMs: 5, serverMs: 1, resolutionMs: 1 }])).toBeNull()
  })
  it('applies a correction only past 2 seconds, keeps it within its doubt, drops it at 2 seconds or less', () => {
    expect(correctionFor([sample(1500)], 0)).toBe(0)
    expect(correctionFor([sample(2000)], 0)).toBe(0)
    expect(correctionFor([sample(2600)], 0)).toBeCloseTo(2600, 6)
    expect(correctionFor([sample(2620)], 2600)).toBe(2600)
    expect(correctionFor([sample(4000)], 2600)).toBeCloseTo(4000, 6)
    expect(correctionFor([sample(300)], 2600)).toBe(0)
    expect(correctionFor([], 2600)).toBe(2600)
    expect(correctionFor([sample(3 * 24 * 3600_000)], 2600)).toBe(2600)
  })
  it('reads X-Server-Time first, then Date (whole seconds) plus Age', () => {
    expect(serverTimeOf(headers({ 'x-server-time': '1795132800123' }))).toEqual({ serverMs: 1795132800123, resolutionMs: 1 })
    expect(serverTimeOf(headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT' }))).toEqual({ serverMs: 1795132800000, resolutionMs: 1000 })
    expect(serverTimeOf(headers({ date: 'Fri, 20 Nov 2026 00:00:00 GMT', age: '3' }))).toEqual({ serverMs: 1795132803000, resolutionMs: 1000 })
    expect(serverTimeOf(headers({}))).toBeNull()
  })
})

describe('catching up without a jump', () => {
  const turn = readMotion(['turn', 'y', 1, 10, 0]) as Motion
  const at = (t: number, nowS: number, version = 0, chosen = false): ClockReading => ({ t, nowS, version, chosen })
  it('wraps the error the shorter way round and bounds the ease to 0.5..3 seconds', () => {
    expect(wrapHalf(0.75)).toBeCloseTo(-0.25, 12)
    expect(wrapHalf(-0.6)).toBeCloseTo(0.4, 12)
    expect(easeSeconds(0.01, 10)).toBe(0.5)
    expect(easeSeconds(0.2, 10)).toBe(2)
    expect(easeSeconds(0.5, 3600)).toBe(3)
  })
  it('draws the true phase on the first frame, then eases into a corrected time', () => {
    const st = newPhaseState(1)
    stepPhases([turn], at(1, 0), false, st)
    expect(st.shown[0]).toBeCloseTo(0.1, 9)
    // The clock is corrected by +2 s: the true phase jumps 0.2, the drawn one eases.
    stepPhases([turn], at(3.0, 0.0, 1), false, st)
    expect(st.shown[0]).toBeCloseTo(0.1, 9)
    stepPhases([turn], at(4.0, 1.0, 1), false, st)
    expect(st.shown[0]).toBeCloseTo(0.4 - 0.2 * (1 - 0.5), 9)
    stepPhases([turn], at(5.0, 2.0, 1), false, st)
    expect(st.shown[0]).toBeCloseTo(0.5, 9)
  })
  it('holds the rest pose under reduced motion, unless the time was chosen by hand', () => {
    const st = newPhaseState(1)
    stepPhases([turn], at(2.5, 0), true, st)
    expect(st.held).toBe(true)
    expect(st.shown[0]).toBe(0)
    stepPhases([turn], at(2.5, 0, 0, true), true, st)
    expect(st.held).toBe(false)
    expect(st.shown[0]).toBeCloseTo(0.25, 9)
  })
  it('draws the true pose at once when reduced motion lets go: the object was drawn as written, no phase to ease from', () => {
    const st = newPhaseState(1)
    stepPhases([turn], at(1, 0), false, st)
    stepPhases([turn], at(2, 1), true, st)
    expect(st.held).toBe(true)
    stepPhases([turn], at(3, 2), false, st)
    expect(st.held).toBe(false)
    expect(st.shown[0]).toBeCloseTo(0.3, 9)
    stepPhases([turn], at(3.5, 2.5), false, st)
    expect(st.shown[0]).toBeCloseTo(0.35, 9)
  })
})
