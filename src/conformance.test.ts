/**
 * conformance.test.ts - sno-core against the DECK-0003 conformance vectors.
 *
 * `vectors/sno-vectors.json` is a copy of `decks/sno-vectors.json` from
 * arkin0x/cyberspace, where every expected result was produced by the spec's
 * reference implementation, `decks/sno-reference.py`. To refresh it, copy the
 * file across again; the `version` field says which one this is.
 *
 * Each vector is an event. This reads it the way ONOSENDAI and snocrash do:
 * the content through JSON.parse and `fromPayload`, and a kind 33331 sealed
 * to a place through `objectFromEvent`, which declines it. It then compares
 * what came back with what the reference says, in the reference's frame
 * (DECK-0003 §2), which is the model frame with Z negated.
 *
 * Where sno-core and the reference disagree, the vector is listed in
 * DIVERGES with the reason, and the test asserts that the disagreement is
 * still there: a fix on either side then fails here and the entry comes out.
 */

import { describe, expect, it } from 'vitest'
import raw from '../vectors/sno-vectors.json' with { type: 'json' }
import { objectFromEvent, type FeedEvent } from './feed.js'
import { fromPayload, mirrorTurn, ticksOf, type ShardModel } from './shards.js'
import type { PaletteEvent } from './snoPalette.js'

interface Vector {
  id: string
  strict: boolean
  detail?: 'summary'
  event: FeedEvent
  palette_event?: PaletteEvent
  expected: Record<string, unknown> & { valid: boolean; status?: string }
}

const doc = raw as unknown as { version: number; vectors: Vector[] }

/**
 * Where sno-core reads a vector differently from the reference, and why.
 * Each is a finding to settle in the spec or here, not a bug to hide.
 */
const DIVERGES: Record<string, string> = {
  // fromPayload reads a vertex with `map(Number)` and a face the same way, so
  // a string, a boolean or null that Number() turns into an integer passes.
  // The reference requires JSON integers (§1.9 rules 6 and 8).
  'invalid/vertex-string': 'a vertex coordinate "1" is coerced to 1 and accepted',
  'invalid/vertex-boolean': 'a vertex coordinate true is coerced to 1 and accepted',
  'invalid/vertex-null': 'a vertex coordinate null is coerced to 0 and accepted',
  'invalid/face-string': 'a face index "1" is coerced to 1 and accepted',
  // unpackFaceColors refuses an empty array outright; the reference accepts
  // [] when there are no faces, since it expands to one index per face.
  'valid/facecolors-empty-no-faces': 'facecolors [] with no faces is refused',
  // neededExtent grows the extent to hold each placement's origin; the
  // reference repairs against the object's own vertices only (§1.8, §1.10).
  'valid/parts-at-bound': 'extent grows to 64 to hold the placements; the reference says 8',
  // Not strict: the spec leaves these open, and the vector says so.
  'latitude/ticks-null': 'ticks null is refused; the reference reads it as absent',
  'latitude/facecolors-null': 'facecolors null is refused; the reference reads it as absent',
  'latitude/v2-triple-colors': 'v2 triples are read literally, as §5 permits; the reference rejects them',
  'latitude/unit-written-0.0': 'JSON.parse cannot tell 0.0 from 0, so it is accepted; the reference rejects it',
  'latitude/vertex-written-2.0': 'JSON.parse cannot tell 2.0 from 2, so it is accepted; the reference rejects it',
}

/** What sno-core makes of a vector's event: null for a refusal, or the model. */
function read(v: Vector): { status: 'object'; model: ShardModel } | { status: 'refused' } | { status: 'hidden' } | { status: 'n/a' } {
  const ev = v.event
  if (ev.kind === 11333 && ev.content === '') return { status: 'n/a' } // the default avatar is the client's, not this library's
  if (ev.kind === 33331 && ev.tags.some((t) => t[0] === 'encrypted')) {
    return objectFromEvent(ev) === null ? { status: 'hidden' } : { status: 'refused' }
  }
  let payload: unknown
  try { payload = JSON.parse(ev.content) } catch { return { status: 'refused' } }
  // fromPayload types its palette as the content string only, but hands it to
  // resolvePalette, which reads a whole event and its `c` tags first (§1.3b).
  // The vectors carry whole events, so the event is what goes in.
  const model = fromPayload(payload, ev.id, (v.palette_event ?? null) as unknown as string | null)
  return model ? { status: 'object', model } : { status: 'refused' }
}

/** A model vertex in the reference's frame, in ticks. `0 - z` so a zero stays +0. */
const wireTicks = (m: ShardModel): number[][] => m.vertices.map((v) => { const [x, y, z] = ticksOf(v); return [x, y, 0 - z] })

/** (b - a) x (c - a) on integer ticks, exactly as the reference computes a front. */
function fronts(points: number[][], faces: number[][]): number[][] {
  return faces.map(([a, b, c]) => {
    const u = [0, 1, 2].map((i) => points[b][i] - points[a][i])
    const w = [0, 1, 2].map((i) => points[c][i] - points[a][i])
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]].map((n) => n + 0)
  })
}

/** Placements back in the reference's frame: the model's are mirrored in Z for a v2 payload (shards.ts readPart). */
function wireParts(m: ShardModel, v: number): number[][] {
  return (m.parts ?? []).map((p) => {
    const at = v === 2 ? [p.at[0], p.at[1], 0 - p.at[2]] : p.at
    const turn = v === 2 ? mirrorTurn(p.turn) : p.turn
    return [p.ref, ...at, ...turn, p.step]
  })
}

/** A relay hint of "" is no hint; sno-core drops it when it reads a reference. */
const bareRefs = (refs: unknown[]): unknown[] => refs.map((r) => (Array.isArray(r) && r[2] === '' ? r.slice(0, 2) : r))

/** Every difference between sno-core's reading and the reference's, as field names. */
function differences(v: Vector): string[] {
  const got = read(v)
  const want = v.expected
  if (got.status === 'n/a') return []
  if (!want.valid) return got.status === 'refused' ? [] : ['valid']
  if (want.status === 'hidden') return got.status === 'hidden' ? [] : ['status']
  if (got.status !== 'object') return ['valid']

  const m = got.model
  const out: string[] = []
  const same = (field: string, a: unknown, b: unknown): void => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(field) }
  same('mode', m.mode, want.mode)
  same('unit', m.unit, want.unit)
  same('extent', m.extent, want.extent)
  same('vertex_count', m.vertices.length, want.vertex_count)
  same('face_count', m.faces.length, want.face_count)
  if (v.detail === 'summary') return out

  const points = wireTicks(m)
  same('positions_ticks', points, want.positions_ticks)
  same('faces', m.faces, want.faces)
  same('fronts', fronts(points, m.faces), want.fronts)

  // A palette colour is a byte on the wire and n / 255 in the model; a v1
  // literal is the clamped number itself.
  const literal = want.color_form === 'literal'
  const colour = (c: number[]): number[] => (literal ? c.map((n) => Math.round(n * 1e9) / 1e9) : c.map((n) => Math.round(n * 255)))
  const expectColour = (c: number[]): number[] => (literal ? c.map((n) => Math.round(n * 1e9) / 1e9) : c)
  same('colors', m.vertices.map((x) => colour(x.c)), (want.colors as number[][]).map(expectColour))
  same('face_colors', m.facecolors ? m.facecolors.map((c) => c.map((n) => Math.round(n * 255))) : null, want.face_colors)

  same('refs', bareRefs(m.refs ?? []), bareRefs(want.refs as unknown[]))
  same('parts', wireParts(m, want.v as number), want.parts)
  return out
}

describe(`DECK-0003 conformance vectors (version ${doc.version})`, () => {
  it('has vectors', () => {
    expect(doc.vectors.length).toBeGreaterThan(100)
  })

  for (const v of doc.vectors) {
    const why = DIVERGES[v.id]
    if (why) {
      it(`${v.id} still diverges: ${why}`, () => {
        expect(differences(v)).not.toEqual([])
      })
    } else {
      it(v.id, () => {
        expect(differences(v)).toEqual([])
      })
    }
  }

  it('lists no divergence for a vector that is not there', () => {
    const ids = new Set(doc.vectors.map((v) => v.id))
    expect(Object.keys(DIVERGES).filter((id) => !ids.has(id))).toEqual([])
  })
})
