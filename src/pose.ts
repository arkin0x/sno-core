/**
 * pose.ts - a turn applied to a shard's vertices, and the spin the wire carries.
 *
 * Only the two operations the format itself needs live here. A shard's payload
 * carries `up` and `spin` (DECK-0003), and `spin` has to be written and read
 * back as the same whole number of degrees by every client or the same object
 * faces two ways, so `wrapSpin` belongs to the format rather than to whichever
 * app happens to stand a shard up. `applyPose` is the other half: given the
 * nine numbers a client derives from wherever the object is, it carries a
 * vertex through them, and it is pure arithmetic on the model's own ticks.
 *
 * What is NOT here is everything that decides what the nine numbers should be.
 * Building a frame out of a latitude, reading a bearing back, folding a view
 * frame in: all of that is a statement about the planet and about cyberspace
 * axes, and it stays in the client that has a planet (ONOSENDAI's lib/pose.ts,
 * which re-exports this file's two functions so its callers see one module).
 * snocrash has no places, so it carries poses on the wire and applies none.
 */

export type V3 = [number, number, number]

/**
 * A pose as nine numbers: the three frame vectors the shard's own axes land
 * on, +X then +Y then +Z. Applying it to a vertex (x, y, z) gives
 * x * pose[0..2] + y * pose[3..5] + z * pose[6..8].
 */
export type Pose = readonly [number, number, number, number, number, number, number, number, number]

/**
 * A spin as the wire carries it: a whole number of degrees, 0..359.
 *
 * Rounded and wrapped in one place because a payload that says 360, or -90, or
 * 12.5 has to read back as a spin some other client will write the same way.
 *
 * Added twice rather than tested for a negative, because `-360 % 360` is -0 and
 * a test for `< 0` lets it through. -0 is 0 to JSON and to arithmetic but not
 * to Object.is, so it survives a round trip as a value that compares unequal to
 * the one that made it, which is the kind of difference a payload test finds
 * and a person does not.
 */
export function wrapSpin(spin: number): number {
  return ((Math.round(spin) % 360) + 360) % 360
}

/** A vertex (in any linear unit) carried into the pose. */
export function applyPose(pose: Pose, v: V3): V3 {
  const [x, y, z] = v
  return [
    x * pose[0] + y * pose[3] + z * pose[6],
    x * pose[1] + y * pose[4] + z * pose[7],
    x * pose[2] + y * pose[5] + z * pose[8],
  ]
}
