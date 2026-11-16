import { describe, expect, it } from 'vitest'
import { DEFAULT_FACE, FACE_MODES, drawnFace, readFace, withFace } from './face.js'
import { fromPayload, toPayload, type ShardModel } from './shards.js'

const shard = (extra?: Record<string, unknown>): ShardModel => ({
  id: 'x', name: 'ship', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
  vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }],
  faces: [[0, 1, 2]],
  ...(extra ? { extra } : {}),
})

// Every kind of value in the DECK-0003 §1.18 table, one to one with
// sno-reference.py drawn_face.
describe('face (DECK-0003 §1.18)', () => {
  it('names two modes, path first and the default', () => {
    expect(FACE_MODES).toEqual(['path', 'upright'])
    expect(DEFAULT_FACE).toBe('path')
  })

  it('reads the two names exactly', () => {
    expect(readFace('path')).toBe('path')
    expect(readFace('upright')).toBe('upright')
  })

  it('reads anything else as absent, which is path, never a refusal', () => {
    for (const bad of [undefined, null, 'Upright', 'UPRIGHT', ' upright', 'upright ', '', 'level', 1, 0, true, false, ['upright'], { face: 'upright' }, NaN]) {
      expect(readFace(bad), JSON.stringify(bad)).toBeUndefined()
      expect(drawnFace(shard({ face: bad })), JSON.stringify(bad)).toBe('path')
    }
    expect(drawnFace(shard())).toBe('path')
    expect(drawnFace({})).toBe('path')
  })

  it('writes upright, and leaves the field out for path', () => {
    const up = withFace(shard(), 'upright')
    expect(up.extra).toEqual({ face: 'upright' })
    expect(drawnFace(up)).toBe('upright')
    const back = withFace(up, 'path')
    expect(back.extra).toBeUndefined()
    expect(drawnFace(back)).toBe('path')
    expect(withFace(up, undefined).extra).toBeUndefined()
    expect(withFace(up, 'level' as never).extra).toBeUndefined()
  })

  it('keeps every other carried field when it sets the face', () => {
    const s = withFace(shard({ eye: [0, 159, 0], glow: ['light', 60, 50] }), 'upright')
    expect(s.extra).toEqual({ eye: [0, 159, 0], glow: ['light', 60, 50], face: 'upright' })
    expect(withFace(s, 'path').extra).toEqual({ eye: [0, 159, 0], glow: ['light', 60, 50] })
  })

  it('travels through the payload and back, and leaves a non-string off the wire', () => {
    const p = toPayload(withFace(shard(), 'upright')) as unknown as Record<string, unknown>
    expect(p.face).toBe('upright')
    expect(drawnFace(fromPayload(p as never, 'x')!)).toBe('upright')
    expect((toPayload(shard()) as unknown as Record<string, unknown>).face).toBeUndefined()
    expect((toPayload(shard({ face: 7 })) as unknown as Record<string, unknown>).face).toBeUndefined()
    expect((toPayload(shard({ face: null })) as unknown as Record<string, unknown>).face).toBeUndefined()
  })

  it('carries a name a later revision may add, so an older editor does not lose it', () => {
    for (const later of ['level', 'bank-left', 'still2']) {
      const p = toPayload(shard({ face: later })) as unknown as Record<string, unknown>
      expect(p.face).toBe(later)
      expect(drawnFace(fromPayload(p as never, 'x')!)).toBe('path')
    }
  })

  it('leaves off a string that could not be a name: another case, a space, empty', () => {
    for (const bad of ['Upright', 'UPRIGHT', ' upright', '', '1st', 'up right']) {
      expect((toPayload(shard({ face: bad })) as unknown as Record<string, unknown>).face, JSON.stringify(bad)).toBeUndefined()
    }
  })

  it('reads a version 1 payload\'s face as written, and writes it back', () => {
    const p = toPayload(withFace(shard(), 'upright')) as unknown as Record<string, unknown>
    const v1 = fromPayload({ ...p, v: 1, colors: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] } as never, 'x')!
    expect(drawnFace(v1)).toBe('upright')
    expect((toPayload(v1) as unknown as Record<string, unknown>).face).toBe('upright')
  })
})
