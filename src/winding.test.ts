import { describe, expect, it } from 'vitest'
import { orientShard } from './orient.js'
import { fromPayload, toPayload, type ShardModel } from './shards.js'
import { stamp } from './stamps.js'
import { newell, type P3 } from './triangulate.js'
import { flipFace, flipSurface, surfaceOf, windAdded, windOutward, wirePoints } from './winding.js'

type Face = [number, number, number]

/** A shard read the way a client reads one: from wire coordinates, through the Z mirror. */
const fromWire = (vertices: P3[], faces: Face[]): ShardModel => {
  const s = fromPayload({ v: 2, name: 't', unit: 1, extent: 8, mode: 'solid', vertices, colors: vertices.map(() => 229), faces }, 't')
  if (!s) throw new Error('payload refused')
  return s
}

/** Each face's normal Y sign, read on the wire, where the format's rule is stated. */
const wireY = (s: ShardModel): number[] => {
  const pts = wirePoints(s)
  return s.faces.map((f) => Math.sign(newell(f.map((i) => pts[i]))[1]))
}

/**
 * arkinox's Disco Floor 1 (2026-09-24), rebuilt from its payload: a 16 by 16
 * plate one step down, wound up, under a checkerboard of 128 unit tiles at
 * height 0, every one wound down by the stamps and pastes that made them.
 */
const discoFloor = (): ShardModel => {
  const v: P3[] = [[8, -1, 8], [8, -1, -8], [-8, -1, -8], [-8, -1, 8]]
  const f: Face[] = [[3, 0, 1], [1, 2, 3]]
  for (let x = -8; x < 8; x++) {
    for (let z = 7; z >= -8; z--) {
      if ((x + z) % 2 === 0) continue
      const b = v.length
      v.push([x, 0, z + 1], [x, 0, z], [x + 1, 0, z], [x + 1, 0, z + 1])
      f.push([b + 1, b + 2, b + 3], [b + 3, b, b + 1])
    }
  }
  return fromWire(v, f)
}

describe('the winding rule', () => {
  it('reads the front on the wire, not in the mirrored model frame', () => {
    // (b - a) x (c - a) = +Y on the wire: counter-clockwise seen from above.
    const s = fromWire([[0, 0, 0], [0, 0, 1], [1, 0, 0]], [[0, 1, 2]])
    expect(wireY(s)).toEqual([1])
    // The model frame negates Z; read there, the same face would look down.
    expect(s.vertices[1].p[2]).toBe(-1)
    // A lone plate facing up is already outward: AUTO leaves it be.
    expect(windOutward(s).faces).toEqual([[0, 1, 2]])
    // And the order goes back out on the wire as it came in.
    expect(toPayload(s).faces).toEqual([[0, 1, 2]])
  })

  it('faces a plate below the origin up, not by which side of the origin it sits', () => {
    for (const y of [-3, 0, 3]) {
      const s = fromWire([[0, y, 0], [1, y, 0], [1, y, 1], [0, y, 1]], [[0, 1, 2], [0, 2, 3]])
      expect(wireY(windOutward(s)), `plate at y=${y}`).toEqual([1, 1])
    }
  })

  it('turns the Disco Floor right way up: tiles and plate both facing up', () => {
    const s = discoFloor()
    expect(s.faces.length).toBe(258)
    const before = wireY(s)
    expect(before.slice(0, 2)).toEqual([1, 1])
    expect(before.slice(2).every((y) => y === -1)).toBe(true)
    expect(wireY(windOutward(s)).every((y) => y === 1)).toBe(true)
    // Nothing inside: no face is buried in a join.
    expect(orientShard(wirePoints(s), s.faces).interior.some(Boolean)).toBe(false)
  })
})

describe('FLIP FACE', () => {
  it('turns one face and leaves the rest, and the order of faces', () => {
    const s = discoFloor()
    const t = flipFace(s, 5)
    expect(wireY(t)[5]).toBe(1)
    expect(t.faces.filter((f, i) => f !== s.faces[i]).length).toBe(1)
    expect(t.faces.length).toBe(s.faces.length)
    expect(s.faces[5]).toEqual(discoFloor().faces[5])
  })
})

describe('FLIP SURFACE', () => {
  it('turns a face and brings the rest of its surface round to agree', () => {
    // A square whose two triangles disagree: the second was wound down.
    const s = fromWire([[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], [[0, 1, 2], [0, 3, 2]])
    expect(wireY(s)).toEqual([1, -1])
    expect(wireY(flipSurface(s, 0))).toEqual([-1, -1])
    expect(wireY(flipSurface(s, 1))).toEqual([1, 1])
  })

  it('stops where the surface ends', () => {
    const s = discoFloor()
    // One tile is two triangles; its neighbours touch it only at corners.
    expect(surfaceOf(s.faces, 2)).toEqual([2, 3])
    const t = flipSurface(s, 2)
    expect(wireY(t).slice(0, 6)).toEqual([1, 1, 1, 1, -1, -1])
  })

  it('turns a whole stamped block inside out, and back', () => {
    const got = stamp(fromWire([], []), 'block', 1, 0, [0, 0, 0], [1, 1, 1])
    if (!got) throw new Error('no stamp')
    const once = flipSurface(got.shard, 0)
    expect(surfaceOf(once.faces, 0).length).toBe(once.faces.length)
    expect(flipSurface(once, 0).faces.map((f) => [...f].sort().join())).toEqual(got.shard.faces.map((f) => [...f].sort().join()))
    expect(outward(flipSurface(once, 0))).toBe(once.faces.length)
    expect(outward(once)).toBe(0)
  })
})

/** How many faces look away from the shard's middle, on the wire. */
const outward = (s: ShardModel): number => {
  const pts = wirePoints(s)
  const c = pts.reduce<P3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0])
  return s.faces.filter((f) => {
    const [a, b, d] = f.map((i) => pts[i])
    const n = newell([a, b, d])
    const m = [(a[0] + b[0] + d[0]) / 3 - c[0], (a[1] + b[1] + d[1]) / 3 - c[1], (a[2] + b[2] + d[2]) / 3 - c[2]]
    return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] > 1e-9
  }).length
}

describe('new faces', () => {
  it('a stamp lands with every face looking out', () => {
    for (const kind of ['block', 'wedge', 'pyramid'] as const) {
      const got = stamp(fromWire([], []), kind, 2, 0, [0, 0, 0], [1, 1, 1])
      if (!got) throw new Error(kind)
      expect(outward(got.shard), kind).toBe(got.shard.faces.length)
    }
  })

  it('a new face joined to an authored one agrees with it; a loose one takes the guess', () => {
    // An authored triangle turned down on purpose, then two new ones: one
    // sharing its edge 1-2 but wound up, one on its own and wound down.
    const s = fromWire(
      [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1], [5, 0, 0], [5, 0, 1], [6, 0, 0]],
      [[0, 2, 1], [1, 3, 2], [4, 6, 5]],
    )
    expect(wireY(s)).toEqual([-1, 1, -1])
    const t = windAdded(s, 1)
    expect(t.faces[0]).toEqual(s.faces[0])
    expect(wireY(t)).toEqual([-1, -1, 1])
  })

  it('leaves the shard alone when nothing is new', () => {
    const s = discoFloor()
    expect(windAdded(s, s.faces.length)).toBe(s)
  })
})
