/**
 * fingerprint.ts - an object's shape as text, for fingerprinting.
 *
 * A similarity fingerprint (Fanfares' `X` tag, NIP-FF-3 `minhash-equality-v1`)
 * reads text: it tokenizes, hashes each token, and keeps the smallest hashes.
 * To fingerprint an object, its shape has to be written as text first, and in
 * exactly one way, or two copies of the same shape would get two fingerprints.
 * `canonicalGeometryText` is that one way.
 *
 * The text is one token per triangle, sorted, joined by single spaces:
 *
 *  1. Every position is taken in total ticks (DECK-0003 §1.2: whole units times
 *     120 plus the remainder), in the published frame of §2 (+Z toward the
 *     viewer), so a version 1 object and the same object republished as version
 *     2 read the same. Integers throughout, as §1.2 requires of anything that
 *     hashes: no float is ever formed.
 *  2. The shape is moved so its minimum corner is at 0,0,0: the smallest x, y
 *     and z over the vertices the triangles use are subtracted from every
 *     position, so every coordinate is a whole number of ticks from 0 up.
 *  3. Every face is a triangle already (§1.4), so the triangulation is the faces
 *     as `fromPayload` validated them. Each triangle's three corners are sorted
 *     by x, then y, then z, as integers.
 *  4. Each triangle is spelled as one token (below), the tokens are sorted, and
 *     they are joined with single spaces.
 *
 * **The spelling, and why it is letters.** The fingerprint's tokenizer is
 * built for prose. It lowercases, turns every run of digits into the word
 * `num`, turns punctuation into spaces, splits on anything that is not a letter
 * or a digit, drops tokens shorter than four characters, and stems a trailing
 * `s`, `ed`, `es` or `ing`. A coordinate written `120,0,3` would reach it as
 * `num num num`, and every triangle would be the same three words. So a token
 * is lowercase letters only:
 *
 *  - a coordinate is its decimal digits, each digit 0 to 9 written as the
 *    letter `a` to `j`: `0` is `a`, `7` is `h`, `120` is `bca`;
 *  - a corner is its three coordinates joined by `x`;
 *  - a triangle is its three sorted corners joined by `y`, then `z`.
 *
 * The triangle (0,0,0) (120,0,0) (0,120,0) is `axaxayaxbcaxaybcaxaxaz`. The
 * shortest token is 18 letters, so none is dropped as short, none is a stop
 * word, and the closing `z` means no stemming rule ever touches one, so each
 * triangle reaches the hash as exactly the token written here.
 *
 * **An object with no faces** (a point cloud, or a polyline in `lines` mode)
 * has no triangles, and an empty text would give every such object the same
 * fingerprint. It writes one token per vertex instead, the corner alone
 * followed by `z` (`axaxaz`), moved to its minimum corner the same way. A
 * corner token has no `y`, so it can never equal a triangle token.
 *
 * **What the text is the same under (invariance):**
 *  - the order of `vertices` and of `faces`, and which corner of a face is
 *    written first or which way it winds: corners are sorted and so are tokens;
 *  - moving the whole object: the minimum corner is always 0,0,0;
 *  - recoloring: `colors`, `facecolors` and `palette` are not read;
 *  - `name`, `extent`, `unit`, `mode`, `up` and `spin`: not read either. So the
 *    same shape built at another `unit` (a power-of-two size change done the
 *    format's way, §1.6) is the same text;
 *  - welding or unwelding: two vertices at one position spell the same corner;
 *  - how `ticks` is spelled on the wire (§1.2 canonical form or not), since the
 *    text is computed on the decoded positions;
 *  - vertices no face uses, when the object has faces.
 *
 * **What changes it (non-invariance):**
 *  - rotating the shape (other than a turn that maps it onto itself);
 *  - scaling its coordinates: twice the ticks is a different text;
 *  - mirroring it;
 *  - moving any corner of any triangle relative to the others.
 *
 * **What it does not cover.** Placed objects (`refs` and `parts`, §1.10) are
 * other events and are not read: the text is this object's own geometry.
 * Duplicate faces are kept, one token each. minhash-equality-v1 reads tokens
 * one at a time (shingle size 1) as a set, so it sees duplicates as one; a
 * fingerprint that read runs of tokens would not.
 *
 * **Range.** Every coordinate, once moved, must be a safe integer (below
 * 2^53 ticks). A publisher stays within 2^16 units of the origin (DECK-0003
 * §1.8), far inside that; a larger value throws a RangeError rather than
 * being spelled in a way the fingerprint would split.
 *
 * Pure.
 */
import { ticksOf, type ShardModel } from './shards.js'

type Corner = [number, number, number]

/**
 * One whole tick count written as letters: each decimal digit 0..9 as `a`..`j`.
 * Only a safe integer has exactly one decimal spelling: past 2^53 a number
 * stands for more than one position, and from 1e21 `String` writes exponent
 * notation, whose `e`, `+` and `.` would split one triangle into several
 * tokens. So anything else is refused rather than spelled.
 */
function spell(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`canonicalGeometryText: ${n} ticks is not a safe whole number of ticks`)
  }
  let out = ''
  for (const d of String(n)) out += String.fromCharCode(97 + Number(d))
  return out
}

/** A corner as three spelled coordinates joined by `x`. */
function spellCorner(c: Corner): string {
  return `${spell(c[0])}x${spell(c[1])}x${spell(c[2])}`
}

/** Integer order on corners: by x, then y, then z. */
function compareCorners(a: Corner, b: Corner): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * The canonical geometry text of an object: one letter-only token per
 * triangle, sorted and space-joined, as the module comment specifies. The
 * input is a model as `fromPayload` returns it, which has already validated the
 * payload against DECK-0003 §1.9. Feed the result to the fingerprint (for
 * Fanfares, `minhashEquality`) exactly as it is.
 */
export function canonicalGeometryText(s: Pick<ShardModel, 'vertices' | 'faces'>): string {
  // The model is in Cyberspace's frame, the wire's with Z negated (shards.ts,
  // WIRE_VERSION); negate it back so the text is in DECK-0003 §2's frame.
  // `0 - z` rather than `-z`: see toRender.
  const at: Corner[] = s.vertices.map((v) => {
    const t = ticksOf(v)
    return [t[0], t[1], 0 - t[2]]
  })

  const used = s.faces.length > 0 ? s.faces.flat() : at.map((_, i) => i)
  if (used.length === 0) return ''

  const min: Corner = [Infinity, Infinity, Infinity]
  for (const i of used) for (let a = 0; a < 3; a++) min[a] = Math.min(min[a], at[i][a])
  const moved = (i: number): Corner => [at[i][0] - min[0], at[i][1] - min[1], at[i][2] - min[2]]

  const tokens = s.faces.length > 0
    ? s.faces.map((f) => f.map(moved).sort(compareCorners).map(spellCorner).join('y') + 'z')
    : used.map((i) => spellCorner(moved(i)) + 'z')
  // Every token is ASCII, so code-unit order is byte order on every platform.
  tokens.sort()
  return tokens.join(' ')
}
