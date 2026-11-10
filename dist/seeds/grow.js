/**
 * Growing a bloom (§4) and drawing it as a SNO payload (§5).
 *
 * A bloom is a pure function of its DNA, its seed (coordinate, effective
 * planted height, scale, caps), the clock height and the block hashes. No DOM,
 * no clock, no randomness: it runs on any thread, a Web Worker included.
 *
 * Growing is two steps, so a client can cache the first: `growSymbols` rewrites
 * the string once per generation (a day of blocks), and `drawBloom` turns it
 * into geometry at the current age, once per block. `growBloom` does both.
 *
 * Across a worker boundary, post the DNA's text and parse it in the worker: a
 * parsed `Dna` holds compiled functions, which cannot be cloned. `tryGrowBloom`
 * takes the text and returns errors instead of throwing.
 */
import { BASE_CAPS, BLOCKS_PER_GENERATION, SEED_ONE, SEED_STEP, SEED_TICK, SEEDO_BUILTINS, SEEDO_LIMITS } from './constants.js';
import { generationAt, grownFraction } from './clock.js';
import { SeedoError } from './expr.js';
import { fdiv, generationRoll, icos, isin, isqrt, symbolRoll, weatherWord } from './fixed.js';
import { cutCodePoints, expressGene, parseDna } from './parse.js';
import { sha256Hex } from './hash.js';
import { terroir } from './terroir.js';
/** The most symbol steps growing a DNA with these caps can take: generations times symbols (§7). */
export function worstCaseSteps(caps = BASE_CAPS) {
    return caps.generations * caps.symbols;
}
/** The buffers to pass as a postMessage transfer list with `BloomBuffers`. */
export function bloomTransferList(b) {
    return [b.positions.buffer, b.colors.buffer, b.faces.buffer];
}
/** The environment of a seed by slot (§4.5): terroir, every gene's expressed value, then every `let`. */
export function envSlots(dna, coord, scale = 0) {
    const t = terroir(coord, scale);
    const env = new Array(dna.slotCount).fill(0);
    const set = (name, v) => { env[dna.slots.get(name)] = v; };
    set('K', t.K);
    set('n0', t.n0);
    set('n1', t.n1);
    set('n2', t.n2);
    set('n3', t.n3);
    set('pl', t.pl);
    for (const g of dna.genes)
        set(g.name, expressGene(g));
    for (const l of dna.lets)
        env[l.slot] = l.fn(env);
    return env;
}
/** The environment of a seed by name, for people and tests: built-ins at 0, genes expressed, lets evaluated. */
export function bloomEnv(dna, coord, scale = 0) {
    const env = envSlots(dna, coord, scale);
    const out = Object.create(null);
    for (const [name, slot] of dna.slots)
        out[name] = env[slot];
    return out;
}
const SLOT_w = SEEDO_BUILTINS.indexOf('w'), SLOT_W = SEEDO_BUILTINS.indexOf('W'), SLOT_g = SEEDO_BUILTINS.indexOf('g');
function rewrite(dna, env, str, gen, word, symbolCap) {
    const out = [];
    let capped = false;
    const e = env.slice();
    e[SLOT_W] = generationRoll(word);
    e[SLOT_g] = gen;
    for (let i = 0; i < str.length; i++) {
        const s = str[i];
        const rules = capped ? undefined : dna.rulesByHead.get(s.c);
        if (!rules) {
            out.push(s);
            continue;
        }
        const w = symbolRoll(word, i);
        e[SLOT_w] = w;
        let hit = null;
        for (const r of rules) {
            if (r.params.length !== s.p.length)
                continue;
            for (let k = 0; k < r.paramSlots.length; k++)
                e[r.paramSlots[k]] = s.p[k];
            if (r.cond && !r.cond(e))
                continue;
            if (r.chance && !(w < r.chance(e)))
                continue;
            hit = r;
            break;
        }
        if (!hit) {
            out.push(s);
            continue;
        }
        // §4.6 step 2, the symbol cap: copy this and every later symbol of the generation unchanged
        if (out.length + hit.succ.length + (str.length - i - 1) > symbolCap) {
            capped = true;
            out.push(s);
            continue;
        }
        let inherited = false;
        for (const t of hit.succ) {
            const p = t.args.map((f) => f(e));
            let b = gen;
            if (!inherited && t.c === s.c) {
                b = s.b;
                inherited = true;
            }
            out.push({ c: t.c, p, b });
        }
    }
    return out;
}
/**
 * Rewrite a seed's string up to the generation the clock calls for (§4.1,
 * §4.6). Throws SeedoError when the axiom is longer than the symbol cap
 * (§3.6). A missing block hash stops growth at the generation before it and
 * says so, as §4.1 asks of a reader that is behind; so do a budget and an
 * abort (`GrowOptions`). Continue later with `{ from: grown }`.
 */
export function growSymbols(dna, seed, clock, blockHash, options = {}) {
    const caps = seed.caps ?? BASE_CAPS;
    if (dna.axiom.length > caps.symbols)
        throw new SeedoError('the axiom is longer than the symbol cap');
    const scale = seed.scale ?? 0;
    const age = seed.planted === null ? 0 : clock - seed.planted;
    const target = seed.planted === null ? 0 : generationAt(age, caps.generations);
    const grownFor = grownForSeed(dna, seed);
    const f = options.from;
    const resume = f !== undefined && f.generation <= target && sameGrowth(f.grownFor, grownFor);
    const env = resume ? f.env : envSlots(dna, seed.coord, scale);
    let str = resume ? f.str : dna.axiom.map((t) => ({ c: t.c, p: t.args.map((x) => x(env)), b: 0 }));
    let generation = resume ? f.generation : 0;
    const weatherBlocks = resume ? f.weatherBlocks.slice() : [];
    let steps = 0;
    let stopped;
    let missingBlock;
    for (let k = generation + 1; k <= target; k++) {
        if (options.signal?.aborted) {
            stopped = 'aborted';
            break;
        }
        if (options.maxSteps !== undefined && steps > 0 && steps + str.length > options.maxSteps) {
            stopped = 'budget';
            break;
        }
        const h = seed.planted + k * BLOCKS_PER_GENERATION;
        const hash = blockHash(h);
        if (!hash) {
            stopped = 'missing-block';
            missingBlock = h;
            break;
        }
        steps += str.length;
        weatherBlocks.push(h);
        str = rewrite(dna, env, str, k, weatherWord(hash), caps.symbols);
        generation = k;
    }
    const grown = { str, generation, targetGeneration: target, complete: generation === target, weatherBlocks, steps, env, grownFor };
    if (stopped !== undefined)
        grown.stopped = stopped;
    if (missingBlock !== undefined)
        grown.missingBlock = missingBlock;
    return grown;
}
function grownForSeed(dna, seed) {
    return { dnaText: dna.text, coord: seed.coord, planted: seed.planted, scale: seed.scale ?? 0, symbolCap: (seed.caps ?? BASE_CAPS).symbols };
}
function sameGrowth(a, b) {
    return a.dnaText === b.dnaText && a.coord === b.coord && a.planted === b.planted && a.scale === b.scale && a.symbolCap === b.symbolCap;
}
/** The generation the clock calls for, for this seed (§4.1): 0 while the planted height is not settled. */
export function targetGeneration(seed, clock) {
    return seed.planted === null ? 0 : generationAt(clock - seed.planted, (seed.caps ?? BASE_CAPS).generations);
}
/**
 * True when a grown string can be drawn for this DNA and seed at this clock:
 * it was grown for the same DNA, coordinate, planted height, scale and symbol
 * cap, and is not past the generation the clock calls for. It may be behind
 * it; `drawBloom` then says so. `drawBloom` refuses a string for which this is
 * false, since it would draw another bloom.
 */
export function growthApplies(grown, dna, seed, clock) {
    return sameGrowth(grown.grownFor, grownForSeed(dna, seed)) && grown.generation <= targetGeneration(seed, clock);
}
const RING = [[0, SEED_ONE], [-14189, -8192], [14189, -8192]];
/** Draw a string with the turtle (§5.2, §5.3, §5.4) at an age in blocks. `env` is the seed's slots (`envSlots`). */
export function drawGeometry(dna, str, age, env, vertexCap) {
    const ONE = SEED_ONE, ONE2 = ONE * ONE, N = BLOCKS_PER_GENERATION;
    const SIZE = Math.max(10, Math.min(400, env[dna.slots.get('size')]));
    const hue = env[dna.slots.get('hue')];
    const HUE = ((hue % 24) + 24) % 24, TONE = env[dna.slots.get('tone')];
    const paint = (c) => {
        c = Math.max(0, Math.min(255, c));
        if (c >= 192)
            return c;
        const sh = Math.max(0, Math.min(7, (c & 7) + TONE));
        return (((c >> 3) + HUE) % 24) * 8 + sh;
    };
    const V = [], C = [], F = [];
    let px = 0, py = 0, pz = 0;
    let H = [0, ONE, 0], L = [-ONE, 0, 0], U = [0, 0, ONE];
    let width = dna.width, color = dna.color;
    const stack = [];
    const R = SEEDO_LIMITS.region * SEED_TICK;
    const fx = (a) => fdiv(a + 8192, ONE);
    const norm = (v) => { const l = isqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [fdiv(v[0] * ONE, l), fdiv(v[1] * ONE, l), fdiv(v[2] * ONE, l)]; };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [fdiv(a[1] * b[2] - a[2] * b[1], ONE), fdiv(a[2] * b[0] - a[0] * b[2], ONE), fdiv(a[0] * b[1] - a[1] * b[0], ONE)];
    const ortho = () => {
        H = norm(H);
        const d = dot(L, H);
        L = norm([L[0] - fdiv(d * H[0], ONE2), L[1] - fdiv(d * H[1], ONE2), L[2] - fdiv(d * H[2], ONE2)]);
        U = cross(H, L);
    };
    const rot = (a, b, deg) => {
        const c = icos(deg), s = isin(deg);
        return [[fx(a[0] * c + b[0] * s), fx(a[1] * c + b[1] * s), fx(a[2] * c + b[2] * s)], [fx(b[0] * c - a[0] * s), fx(b[1] * c - a[1] * s), fx(b[2] * c - a[2] * s)]];
    };
    const cl = (v) => Math.max(-R, Math.min(R, v));
    const vert = (x, y, z) => { V.push(cl(x), cl(y), cl(z)); C.push(paint(color)); return V.length / 3 - 1; };
    const room = (k) => V.length / 3 + k <= vertexCap;
    const ring = (x, y, z, w) => RING.map(([cx, cy]) => vert(x + fdiv((L[0] * cx + U[0] * cy) * w, ONE2), y + fdiv((L[1] * cx + U[1] * cy) * w, ONE2), z + fdiv((L[2] * cx + U[2] * cy) * w, ONE2)));
    const a0age = Math.max(0, age);
    for (const s of str) {
        const a0 = s.p.length ? s.p[0] : null;
        switch (s.c) {
            case 'F':
            case 'f': {
                const len = fdiv(Math.max(0, Math.min(100, a0 === null ? 10 : a0)) * SEED_STEP * grownFraction(s.b, a0age) * SIZE, N * 100);
                if (len === 0)
                    break;
                const nx = px + fx(H[0] * len), ny = py + fx(H[1] * len), nz = pz + fx(H[2] * len);
                const w = fdiv(Math.max(0, Math.min(50, width)) * SEED_STEP * SIZE, 200);
                if (s.c === 'F' && w > 0 && room(6)) {
                    const r0 = ring(px, py, pz, w), r1 = ring(nx, ny, nz, w);
                    for (let j = 0; j < 3; j++) {
                        const k = (j + 1) % 3;
                        F.push([r0[j], r0[k], r1[k]], [r0[j], r1[k], r1[j]]);
                    }
                }
                px = cl(nx);
                py = cl(ny);
                pz = cl(nz);
                break;
            }
            case '+':
            case '-': {
                const d = (a0 === null ? dna.angle : a0) * (s.c === '+' ? 1 : -1);
                [H, L] = rot(H, L, d);
                ortho();
                break;
            }
            case '&':
            case '^': {
                const d = (a0 === null ? dna.angle : a0) * (s.c === '&' ? 1 : -1);
                [H, U] = rot(H, U, -d);
                ortho();
                break;
            }
            case '\\':
            case '/': {
                const d = (a0 === null ? dna.angle : a0) * (s.c === '/' ? 1 : -1);
                [L, U] = rot(L, U, d);
                ortho();
                break;
            }
            case '|':
                [H, L] = rot(H, L, 180);
                ortho();
                break;
            case 'T': {
                const deg = a0 === null ? 5 : a0;
                const D = deg >= 0 ? [0, -ONE, 0] : [0, ONE, 0];
                const dd = Math.abs(deg) % 360;
                const k = dot(D, H);
                const P = [D[0] - fdiv(k * H[0], ONE2), D[1] - fdiv(k * H[1], ONE2), D[2] - fdiv(k * H[2], ONE2)];
                if (P[0] * P[0] + P[1] * P[1] + P[2] * P[2] < 400 * 400)
                    break;
                const Pn = norm(P), c = icos(dd), sn = isin(dd);
                H = [fx(H[0] * c + Pn[0] * sn), fx(H[1] * c + Pn[1] * sn), fx(H[2] * c + Pn[2] * sn)];
                ortho();
                break;
            }
            case '[':
                if (stack.length < SEEDO_LIMITS.stack)
                    stack.push([px, py, pz, H, L, U, width, color]);
                break;
            case ']': {
                const top = stack.pop();
                if (top)
                    [px, py, pz, H, L, U, width, color] = top;
                break;
            }
            case '!':
                width = a0 === null ? dna.width : a0;
                break;
            case "'":
                color = a0 === null ? dna.color : a0;
                break;
            case 'L': {
                const sz = fdiv(Math.max(0, Math.min(50, a0 === null ? 3 : a0)) * SEED_STEP * grownFraction(s.b, a0age) * SIZE, N * 100);
                if (sz === 0 || !room(4))
                    break;
                const h2 = fdiv(sz, 2), q = fdiv(sz, 3);
                const a = vert(px, py, pz);
                const b = vert(px + fx(H[0] * h2 + L[0] * q), py + fx(H[1] * h2 + L[1] * q), pz + fx(H[2] * h2 + L[2] * q));
                const c = vert(px + fx(H[0] * sz), py + fx(H[1] * sz), pz + fx(H[2] * sz));
                const d = vert(px + fx(H[0] * h2 - L[0] * q), py + fx(H[1] * h2 - L[1] * q), pz + fx(H[2] * h2 - L[2] * q));
                F.push([a, b, c], [a, c, d]);
                break;
            }
            case 'O': {
                const r = fdiv(Math.max(0, Math.min(50, a0 === null ? 2 : a0)) * SEED_STEP * grownFraction(s.b, a0age) * SIZE, N * 100);
                if (r === 0 || !room(6))
                    break;
                const xp = vert(px + r, py, pz), xn = vert(px - r, py, pz), yp = vert(px, py + r, pz);
                const yn = vert(px, py - r, pz), zp = vert(px, py, pz + r), zn = vert(px, py, pz - r);
                F.push([xp, yp, zp], [yp, xn, zp], [xn, yn, zp], [yn, xp, zp], [yp, xp, zn], [xn, yp, zn], [yn, xn, zn], [xp, yn, zn]);
                break;
            }
            default: break;
        }
    }
    return { V, C, F };
}
/** The SNO payload of drawn geometry (§5.5), keys in the order the payload hash needs. */
export function toBloomPayload(name, geo, unit) {
    const n = geo.V.length / 3;
    const vertices = [];
    const ticks = [];
    let ext = 1, zr = 0;
    for (let i = 0; i < n; i++) {
        const t = [geo.V[3 * i], geo.V[3 * i + 1], geo.V[3 * i + 2]];
        const w = [Math.floor(t[0] / SEED_TICK), Math.floor(t[1] / SEED_TICK), Math.floor(t[2] / SEED_TICK)];
        const r = [t[0] - w[0] * SEED_TICK, t[1] - w[1] * SEED_TICK, t[2] - w[2] * SEED_TICK];
        vertices.push(w);
        for (let k = 0; k < 3; k++)
            ext = Math.max(ext, Math.abs(w[k]), w[k] + (r[k] ? 1 : 0));
        if (r[0] === 0 && r[1] === 0 && r[2] === 0)
            zr++;
        else {
            if (zr === 1)
                ticks.push([0, 0, 0]);
            else if (zr > 1)
                ticks.push(-zr);
            zr = 0;
            ticks.push(r);
        }
    }
    const allZero = ticks.length === 0;
    if (!allZero) {
        if (zr === 1)
            ticks.push([0, 0, 0]);
        else if (zr > 1)
            ticks.push(-zr);
    }
    // Built key by key: the order is v, name, unit, extent, mode, vertices, ticks, colors, faces.
    const sno = { v: 2, name: cutCodePoints(name, 64), unit };
    const e = Math.min(64, ext);
    if (e !== 8)
        sno.extent = e;
    sno.mode = 'solid';
    sno.vertices = vertices;
    if (!allZero)
        sno.ticks = ticks;
    sno.colors = geo.C.slice();
    sno.faces = geo.F;
    return sno;
}
/** The geometry as transferable typed arrays. */
export function toBloomBuffers(geo) {
    const faces = new Uint32Array(geo.F.length * 3);
    for (let i = 0; i < geo.F.length; i++) {
        const f = geo.F[i];
        faces[3 * i] = f[0];
        faces[3 * i + 1] = f[1];
        faces[3 * i + 2] = f[2];
    }
    return { positions: Int32Array.from(geo.V), colors: Uint8Array.from(geo.C), faces };
}
export function drawBloom(dna, grown, seed, clock, options = {}) {
    const caps = seed.caps ?? BASE_CAPS;
    if (!sameGrowth(grown.grownFor, grownForSeed(dna, seed)))
        throw new Error('drawBloom: the string was grown for another DNA or seed');
    const target = targetGeneration(seed, clock);
    if (grown.generation > target)
        throw new Error('drawBloom: the string is at generation ' + grown.generation + ', past the ' + target + ' this clock calls for');
    const age = seed.planted === null ? 0 : clock - seed.planted;
    const geo = drawGeometry(dna, grown.str, Math.max(0, age), grown.env, caps.vertices);
    const bloom = {
        age,
        generation: grown.generation,
        targetGeneration: target,
        behind: grown.generation < target,
        symbols: grown.str.length,
        weatherBlocks: grown.weatherBlocks,
    };
    // why it stopped, when growth stopped short and nothing has grown it on since
    if (bloom.behind && grown.stopped !== undefined)
        bloom.stopped = grown.stopped;
    if (bloom.behind && grown.missingBlock !== undefined)
        bloom.missingBlock = grown.missingBlock;
    if (options.payload ?? true) {
        const sno = toBloomPayload(dna.name, geo, seed.scale ?? 0);
        bloom.sno = sno;
        if (options.json ?? true) {
            bloom.json = JSON.stringify(sno);
            bloom.sha256 = sha256Hex(bloom.json);
        }
    }
    if (options.buffers)
        bloom.buffers = toBloomBuffers(geo);
    return bloom;
}
export function growBloom(dna, seed, clock, blockHash, options = {}) {
    return drawBloom(dna, growSymbols(dna, seed, clock, blockHash, options), seed, clock, options);
}
export function tryGrowBloom(dna, seed, clock, blockHash, options = {}) {
    try {
        const d = typeof dna === 'string' ? parseDna(dna)
            : 'rulesByHead' in dna ? dna
                : parseDna(dna.text, { computed: dna.computed === true });
        return { ok: true, bloom: growBloom(d, seed, clock, blockHash, options) };
    }
    catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
}
//# sourceMappingURL=grow.js.map