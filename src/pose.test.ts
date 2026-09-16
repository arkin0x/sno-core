/**
 * pose.test.ts - the two pose operations the format itself owns.
 *
 * Everything that decides what a pose should be is a statement about a planet
 * and lives in the client that has one; these two are arithmetic, and they are
 * here because a payload written by one client has to read back the same in
 * another.
 */

import { describe, it, expect } from 'vitest'
import { applyPose, wrapSpin, type Pose, type V3 } from './pose'

describe('wrapSpin', () => {
  it('lands every spin in 0..359, so two clients write the same one', () => {
    expect(wrapSpin(0)).toBe(0)
    expect(wrapSpin(90)).toBe(90)
    expect(wrapSpin(360)).toBe(0)
    expect(wrapSpin(450)).toBe(90)
    expect(wrapSpin(-90)).toBe(270)
    expect(wrapSpin(-360)).toBe(0)
  })

  it('rounds, because the wire carries whole degrees', () => {
    expect(wrapSpin(12.4)).toBe(12)
    expect(wrapSpin(12.6)).toBe(13)
    expect(wrapSpin(359.6)).toBe(0)
  })
})

describe('applyPose', () => {
  const identity: Pose = [1, 0, 0, 0, 1, 0, 0, 0, 1]

  it('leaves a vertex alone under the identity', () => {
    expect(applyPose(identity, [3, -4, 5])).toEqual([3, -4, 5])
  })

  it('reads the nine numbers as the images of the model axes, in order', () => {
    // +X to +Y, +Y to +Z, +Z to +X: a vertex is the sum of its parts.
    const cycle: Pose = [0, 1, 0, 0, 0, 1, 1, 0, 0]
    expect(applyPose(cycle, [1, 0, 0])).toEqual([0, 1, 0])
    expect(applyPose(cycle, [0, 1, 0])).toEqual([0, 0, 1])
    expect(applyPose(cycle, [0, 0, 1])).toEqual([1, 0, 0])
    expect(applyPose(cycle, [2, 3, 5])).toEqual([5, 2, 3])
  })

  it('is linear, so it can be applied in ticks and scaled afterward', () => {
    const p: Pose = [0, 1, 0, -1, 0, 0, 0, 0, 1]
    const v: V3 = [7, 11, 13]
    const doubled = applyPose(p, [v[0] * 2, v[1] * 2, v[2] * 2])
    expect(doubled).toEqual(applyPose(p, v).map((n) => n * 2))
  })
})
