/**
 * fingerprint.test.ts - the canonical geometry text is one spelling per shape:
 * the same under order, translation and recoloring, different under rotation,
 * scale and mirroring, and every triangle reaches the fingerprint whole.
 */

import { MAX_EXTENT } from './shards'
import { describe, it, expect } from 'vitest'
import { canonicalGeometryText } from './fingerprint.js'
import { fromPayload, newShard, toPayload, vertexAt, type ShardModel, type ShardVertex } from './shards.js'
import { BUILT_IN } from './snoPalette.js'

const RED: [number, number, number] = [1, 0, 0]
const BLUE: [number, number, number] = [0, 0, 1]

/** A model from positions in total ticks, in the model's own frame. */
function model(points: Array<[number, number, number]>, faces: Array<[number, number, number]>, color = RED): ShardModel {
  return { ...newShard('t'), mode: 'solid', vertices: points.map((p) => vertexAt(p, color)), faces }
}

/**
 * An asymmetric solid: a lopsided tetrahedron with a sub-unit corner, so that
 * no rotation, mirror or scale maps it onto itself.
 */
const TETRA: Array<[number, number, number]> = [[0, 0, 0], [360, 0, 0], [0, 240, 0], [40, 30, 120]]
const TETRA_FACES: Array<[number, number, number]> = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]]

/** Through the wire and back, the way a client reads a published object. */
function viaWire(s: ShardModel, raw?: (p: ReturnType<typeof toPayload>) => Record<string, unknown>): ShardModel {
  const p = JSON.parse(JSON.stringify(toPayload(s)))
  const back = fromPayload(raw ? raw(p) : p, 'x')
  if (!back) throw new Error('payload refused')
  return back
}

/** A deterministic shuffle (mulberry32), so a failure reproduces. */
function shuffled<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** The same object with its vertex list permuted and every face remapped to follow. */
function permuteVertices(s: ShardModel, seed: number): ShardModel {
  const order = shuffled(s.vertices.map((_, i) => i), seed)
  const where = new Map(order.map((old, neu) => [old, neu]))
  return {
    ...s,
    vertices: order.map((i) => s.vertices[i]),
    faces: s.faces.map((f) => f.map((i) => where.get(i)!) as [number, number, number]),
  }
}

/**
 * NIP-FF-3 minhash-equality-v1, Steps 1 to 4, as simhash-ts 0.2.0 implements
 * them (canonicalizeTextForEquality, tokenizeForEquality, stemEqualityToken).
 * Copied rather than imported so this package keeps no dependencies; if the
 * fingerprint's tokenizer changes, this copy is what must change with it.
 */
function fingerprintTokens(text: string): string[] {
  const canonical = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/\r\n?/g, '\n')
    .replace(/https?:\/\/\S+/giu, ' url ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/[\p{N}]+/gu, ' num ')
    .replace(/\s+/gu, ' ')
    .trim()
  const stem = (t: string): string =>
    t.length > 5 && t.endsWith('ing') ? t.slice(0, -3)
      : t.length > 4 && t.endsWith('ed') ? t.slice(0, -2)
        : t.length > 4 && t.endsWith('es') ? t.slice(0, -2)
          : t.length > 3 && t.endsWith('s') ? t.slice(0, -1)
            : t
  // Every token here is 6 letters or more and none is a stop word, so the
  // length and stop-word filters are checked by the length assertion below.
  return (canonical.match(/[\p{L}\p{N}]+/gu) ?? []).map(stem)
}

describe('canonicalGeometryText: the spelling', () => {
  it('spells one triangle as documented', () => {
    const s = model([[0, 0, 0], [120, 0, 0], [0, 120, 0]], [[0, 1, 2]])
    expect(canonicalGeometryText(s)).toBe('axaxayaxbcaxaybcaxaxaz')
  })

  it('writes every digit as its letter, coordinates in the published frame', () => {
    // Model Z is the wire's negated (DECK-0003 §2), so model -987 is wire +987.
    const s = model([[0, 0, 0], [1234, 0, 0], [0, 56, -987]], [[0, 1, 2]])
    expect(canonicalGeometryText(s)).toBe('axaxayaxfgxjihybcdexaxaz')
  })

  it('is one token per triangle, sorted and joined by single spaces', () => {
    const text = canonicalGeometryText(model(TETRA, TETRA_FACES))
    const tokens = text.split(' ')
    expect(tokens).toHaveLength(TETRA_FACES.length)
    expect([...tokens].sort()).toEqual(tokens)
    for (const t of tokens) expect(t).toMatch(/^[a-j]+x[a-j]+x[a-j]+y[a-j]+x[a-j]+x[a-j]+y[a-j]+x[a-j]+x[a-j]+z$/)
  })

  it('every triangle reaches the fingerprint as exactly one token, unchanged', () => {
    const text = canonicalGeometryText(model(TETRA, TETRA_FACES))
    const tokens = fingerprintTokens(text)
    expect(tokens).toEqual(text.split(' '))
    for (const t of tokens) expect(t.length).toBeGreaterThanOrEqual(4)
  })

  it('an empty object is the empty text', () => {
    expect(canonicalGeometryText(model([], []))).toBe('')
  })
})

describe('canonicalGeometryText: invariance', () => {
  const base = model(TETRA, TETRA_FACES)
  const text = canonicalGeometryText(base)

  it('is the same under any order of vertices and faces (determinism)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const v = permuteVertices(base, seed)
      const f = { ...v, faces: shuffled(v.faces, seed * 7919) }
      expect(canonicalGeometryText(f)).toBe(text)
    }
  })

  it('is the same whichever corner a face starts at and whichever way it winds', () => {
    const rotated = { ...base, faces: base.faces.map(([a, b, c]) => [b, c, a] as [number, number, number]) }
    const flipped = { ...base, faces: base.faces.map(([a, b, c]) => [a, c, b] as [number, number, number]) }
    expect(canonicalGeometryText(rotated)).toBe(text)
    expect(canonicalGeometryText(flipped)).toBe(text)
  })

  it('is the same moved anywhere, by whole units and by ticks', () => {
    for (const d of [[120, 0, 0], [-7, 13, 119], [-7680, 7680, -3]] as Array<[number, number, number]>) {
      const moved = model(TETRA.map((p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]]), TETRA_FACES)
      expect(canonicalGeometryText(moved)).toBe(text)
    }
  })

  it('is the same recolored, by vertex, by face and by palette', () => {
    const recolored = model(TETRA, TETRA_FACES, BLUE)
    const faceColored: ShardModel = { ...base, facecolors: TETRA_FACES.map(() => BLUE) }
    const ownPalette: ShardModel = { ...base, palette: [[255, 0, 0], [0, 0, 255]] }
    expect(canonicalGeometryText(recolored)).toBe(text)
    expect(canonicalGeometryText(faceColored)).toBe(text)
    expect(canonicalGeometryText(viaWire(ownPalette))).toBe(text)
  })

  it('ignores name, extent, unit, mode, up and spin', () => {
    const other: ShardModel = { ...base, name: 'another name', extent: 40, unit: 33, mode: 'points', up: true, spin: 90 }
    expect(canonicalGeometryText(other)).toBe(text)
    expect(canonicalGeometryText(viaWire(other))).toBe(text)
  })

  it('reads a version 1 payload and its version 2 republish the same', () => {
    // v1's frame is the model's own (shards.ts): its vertices are written
    // unflipped and its colours are triples. The same object either way.
    const v2 = viaWire(base)
    const v1 = viaWire(base, (p) => ({
      ...p,
      v: 1,
      vertices: base.vertices.map((v) => v.p),
      ticks: base.vertices.map((v) => v.t ?? [0, 0, 0]),
      colors: (p.colors as number[]).map((i) => BUILT_IN[i].map((n) => n / 255)),
    }))
    expect(canonicalGeometryText(v1)).toBe(text)
    expect(canonicalGeometryText(v2)).toBe(text)
  })

  it('reads ticks the same however the wire spells them', () => {
    const whole = model([[0, 0, 0], [240, 0, 0], [0, 240, 0], [0, 0, 240]], [[0, 1, 2], [0, 2, 3]])
    const canonical = viaWire(whole)
    const spelledOut = viaWire(whole, (p) => ({ ...p, ticks: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] }))
    const absent = viaWire(whole, (p) => { const { ticks: _, ...rest } = p; return rest })
    expect(canonicalGeometryText(spelledOut)).toBe(canonicalGeometryText(canonical))
    expect(canonicalGeometryText(absent)).toBe(canonicalGeometryText(canonical))
  })

  it('is the same welded or unwelded', () => {
    // Every face with its own three vertices, the way expandFaceColors draws them.
    const unwelded: ShardModel = {
      ...base,
      vertices: base.faces.flatMap((f) => f.map((i): ShardVertex => ({ ...base.vertices[i] }))),
      faces: base.faces.map((_, i) => [i * 3, i * 3 + 1, i * 3 + 2]),
    }
    expect(canonicalGeometryText(unwelded)).toBe(text)
  })

  it('ignores vertices that no face uses, wherever they are', () => {
    const stray: ShardModel = { ...base, vertices: [...base.vertices, vertexAt([-5000, 9000, 12], RED)] }
    expect(canonicalGeometryText(stray)).toBe(text)
  })
})

describe('canonicalGeometryText: non-invariance', () => {
  const base = model(TETRA, TETRA_FACES)
  const text = canonicalGeometryText(base)

  it('changes when the shape is rotated', () => {
    // A quarter turn about Y: (x, y, z) -> (z, y, -x), exact on the lattice.
    const turned = model(TETRA.map(([x, y, z]) => [z, y, 0 - x]), TETRA_FACES)
    expect(canonicalGeometryText(turned)).not.toBe(text)
    // A half turn about X: (x, y, z) -> (x, -y, -z).
    const flippedOver = model(TETRA.map(([x, y, z]) => [x, 0 - y, 0 - z]), TETRA_FACES)
    expect(canonicalGeometryText(flippedOver)).not.toBe(text)
  })

  it('changes when the coordinates are scaled', () => {
    const doubled = model(TETRA.map(([x, y, z]) => [x * 2, y * 2, z * 2]), TETRA_FACES)
    expect(canonicalGeometryText(doubled)).not.toBe(text)
  })

  it('changes when the shape is mirrored', () => {
    const mirrored = model(TETRA.map(([x, y, z]) => [0 - x, y, z]), TETRA_FACES)
    expect(canonicalGeometryText(mirrored)).not.toBe(text)
  })

  it('changes when one corner moves by one tick', () => {
    const nudged = model(TETRA.map((p, i) => (i === 3 ? [p[0] + 1, p[1], p[2]] : p)), TETRA_FACES)
    expect(canonicalGeometryText(nudged)).not.toBe(text)
  })
})

describe('canonicalGeometryText: objects with no faces', () => {
  const cloud = model([[0, 0, 0], [120, 0, 0], [0, 360, 7]], [])

  it('writes one corner token per vertex, which no triangle token can equal', () => {
    const text = canonicalGeometryText(cloud)
    expect(text).toBe('axaxhz axdgaxaz bcaxaxhz')
    for (const t of text.split(' ')) expect(t).not.toContain('y')
    expect(fingerprintTokens(text)).toEqual(text.split(' '))
  })

  it('is the same under vertex order and translation, and different under scale', () => {
    const text = canonicalGeometryText(cloud)
    expect(canonicalGeometryText(permuteVertices(cloud, 3))).toBe(text)
    expect(canonicalGeometryText(model([[500, 1, 2], [620, 1, 2], [500, 361, 9]], []))).toBe(text)
    expect(canonicalGeometryText(model([[0, 0, 0], [240, 0, 0], [0, 720, 14]], []))).not.toBe(text)
  })
})

describe('canonicalGeometryText: range', () => {
  it('spells the 64-unit publisher bound, corner to corner, as single tokens', () => {
    const wide = model([[-7680, -7680, -7680], [7680, -7680, -7680], [-7680, 7680, 7680]], [[0, 1, 2]])
    const text = canonicalGeometryText(wide)
    // Model Z is the wire's negated, so (0,0,15360) (0,15360,0) (15360,0,15360) once moved.
    expect(text).toBe('axaxbfdgayaxbfdgaxaybfdgaxaxbfdgaz')
    expect(fingerprintTokens(text)).toEqual([text])
  })

  it('spells the position bound of §1.8 as single tokens too', () => {
    const b = MAX_EXTENT * 120
    const text = canonicalGeometryText(model([[-b, -b, -b], [b, -b, -b], [-b, b, b]], [[0, 1, 2]]))
    expect(fingerprintTokens(text)).toEqual([text])
  })

  it('refuses a coordinate that is not a safe integer instead of spelling it wrong', () => {
    // 1e21 would print as "1e+21"; past 2^53 a number names more than one position.
    const huge: ShardModel = { ...newShard('h'), mode: 'solid', vertices: [
      { p: [0, 0, 0], c: RED }, { p: [1e21, 0, 0], c: RED }, { p: [0, 1, 0], c: RED },
    ], faces: [[0, 1, 2]] }
    expect(() => canonicalGeometryText(huge)).toThrow(RangeError)
  })
})
