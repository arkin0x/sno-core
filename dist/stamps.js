/**
 * stamps.ts — shapes you place with one tap.
 *
 * A stamp is a small parametric shape on the integer grid: a block, a wedge,
 * a pyramid, a column, a ring, a star, an arrow. Each compiles to plain
 * vertices and triangles in the shard's own wire form, so a stamped shard is
 * exactly as portable as a hand-built one and the world needs to know nothing
 * about stamps. SIZE scales a shape in whole units (1 to 4); FACING turns the
 * asymmetric ones (wedge, star, arrow) a quarter turn at a time about Y.
 *
 * A stamp brings its own vertices even where the shard already has one on
 * that point. That is deliberate: colors live on vertices, so sharing a
 * corner between a red block and a blue block would blend the seam, and a
 * seam is where you want the edge crisp. What sharing would have saved is
 * budget, so the two triangles that face each other where two stamps touch
 * are dropped instead: a hidden wall costs nothing. For that to work every
 * box splits each face on the same diagonal, so two boxes meeting face to
 * face produce triangles with identical corners that the cull can match.
 *
 * Pure: a stamp is a function of (kind, size, facing) and where you put it.
 */
import { orientFaces } from './orient.js';
import { GRID_HALF, TICKS_PER_UNIT, pointKey, ticksOf, toRender, vertexAt } from './shards.js';
import { triangulate } from './triangulate.js';
export const STAMPS = ['block', 'wedge', 'pyramid', 'column', 'ring', 'star', 'arrow'];
export const FACING_LABEL = { 0: '+X', 1: '+Z', 2: '−X', 3: '−Z' };
/** The stamps a quarter turn changes. The rest look the same from every side. */
export const FACED = { block: false, wedge: true, pyramid: false, column: false, ring: false, star: true, arrow: true };
export const MIN_SIZE = 1;
export const MAX_SIZE = 4;
/** One-line descriptions for the shape picker. */
export const STAMP_HELP = {
    block: 'A cube, SIZE units on a side, standing on the level.',
    wedge: 'A ramp, SIZE units wide and tall, sloping down toward FACING.',
    pyramid: 'A pyramid twice SIZE wide and tall, its point straight up.',
    column: 'A post one unit wide and twice SIZE tall.',
    ring: 'A closed loop of points, SIZE units out from the tap. Best in POINTS or LINES.',
    star: 'A five point star, twice SIZE across, flat on the level.',
    arrow: 'A flat arrow pointing toward FACING.',
};
/** A quad's two triangles, always split from its first corner to its third. */
function quad(a, b, c, d) {
    return [[a, b, c], [a, c, d]];
}
/**
 * A box from (x0,y0,z0) to (x1,y1,z1).
 *
 * Two things are fixed about the corner order, and they are different things.
 *
 * Each side is listed so its two triangles wind counter-clockwise seen from
 * OUTSIDE the box, which is the direction the renderer, the PLY export and
 * anything else reading the object take as the front. Half of these sides used
 * to be listed the other way round: the box was closed and the points were
 * right, so it looked correct in a viewer that draws both sides, and looked
 * torn in one that does not, which is what the bench does (ShardMesh draws
 * fronts in colour and backs in grey).
 *
 * Each side is also split along the same diagonal its neighbour would choose,
 * so that two boxes sharing a wall produce the same pair of triangles there
 * and the cull in `stamp` can match and drop them. Reversing a side to face
 * outward keeps that diagonal: `quad(a,b,c,d)` and `quad(a,d,c,b)` both split
 * a to c.
 */
function box(x0, x1, y0, y1, z0, z1) {
    const points = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
    ];
    const faces = [
        ...quad(0, 1, 2, 3), // bottom, facing −Y
        ...quad(4, 7, 6, 5), // top, facing +Y
        ...quad(0, 4, 5, 1), // z0 side, facing −Z
        ...quad(3, 2, 6, 7), // z1 side, facing +Z
        ...quad(0, 3, 7, 4), // x0 side, facing −X
        ...quad(1, 5, 6, 2), // x1 side, facing +X
    ];
    return { points, faces };
}
/** Where a shape of side s sits so the tap is at or near its middle: [−⌊s/2⌋, s − ⌊s/2⌋]. */
/**
 * A shape's footprint across the tap, on whole units: an even size sits
 * centred on the tap, an odd size hangs one more unit to the positive side.
 * Corners land on gibsons, as hand-placed vertices do; a finer DIVISION is
 * the way between them.
 */
function span(s) {
    const lo = -Math.floor(s / 2);
    return [lo, lo + s];
}
/**
 * A ring of radius r on the grid, in order around it from +X towards +Z.
 *
 * The midpoint circle algorithm: walk one eighth of the circle in whole
 * steps, at each step taking whichever of two cells lies nearer the true
 * circle (a running error kept in integers), then mirror that eighth into the
 * other seven. The ring is exactly symmetric at every size and one cell
 * thick, with no cell inside it.
 *
 * It replaced snapping 8r even angles to the grid (arkinox, 2026-10-05). That
 * pulled the 45 degree points of a size 2 ring in to (1, 1), so the loop dived
 * toward the centre at every diagonal and drew a cross, and Math.round (which
 * takes 1.5 to 2 but -1.5 to -1) left a size 3 ring lopsided.
 *
 * Size 1 stays the 3 by 3 square it always was: the algorithm alone gives the
 * four side cells, a diamond, because the corners lie outside a circle of
 * radius 1.
 */
function ring(r) {
    const cells = new Map();
    const put = (x, z) => { cells.set(`${x},${z}`, [x, 0, z]); };
    if (r === 1) {
        for (const [x, z] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]])
            put(x, z);
    }
    else {
        let x = r, z = 0, err = 1 - r;
        while (x >= z) {
            for (const [a, b] of [[x, z], [z, x], [-z, x], [-x, z], [-x, -z], [-z, -x], [z, -x], [x, -z]])
                put(a, b);
            z++;
            if (err < 0)
                err += 2 * z + 1;
            else {
                x--;
                err += 2 * (z - x) + 1;
            }
        }
    }
    const turn = (p) => { const a = Math.atan2(p[2], p[0]); return a < 0 ? a + 2 * Math.PI : a; };
    return [...cells.values()].sort((p, q) => turn(p) - turn(q));
}
/**
 * A flat polygon on the level: its triangles, and, only when there are none,
 * the first point again so LINES draws a shut loop. A shape with faces is
 * never drawn as a loop, and the copy would be a second vertex sitting exactly
 * on the first.
 */
function flat(points) {
    const faces = triangulate(points) ?? [];
    return { points: faces.length ? points : [...points, [...points[0]]], faces };
}
/** The shape in its own frame: tap at the origin, level at y = 0, facing +X. */
function local(kind, s) {
    switch (kind) {
        case 'block': {
            const [x0, x1] = span(s);
            const [z0, z1] = span(s);
            return box(x0, x1, 0, s, z0, z1);
        }
        case 'column': return box(0, 1, 0, 2 * s, 0, 1);
        case 'pyramid': return {
            points: [[-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s], [0, 2 * s, 0]],
            faces: [[1, 0, 4], [2, 1, 4], [3, 2, 4], [0, 3, 4], ...quad(0, 1, 2, 3)],
        };
        case 'wedge': {
            const [x0, x1] = span(s);
            const [z0, z1] = span(s);
            return {
                points: [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [x0, s, z0], [x0, s, z1]],
                faces: [...quad(0, 1, 2, 3), ...quad(0, 3, 5, 4), ...quad(1, 4, 5, 2), [1, 0, 4], [3, 2, 5]],
            };
        }
        case 'ring': {
            const pts = ring(s);
            return { points: [...pts, [...pts[0]]], faces: [] };
        }
        case 'star': {
            const pts = [];
            for (let i = 0; i < 10; i++) {
                const r = i % 2 === 0 ? 2 * s : s, a = (i / 10) * Math.PI * 2;
                const p = [Math.round(r * Math.cos(a)), 0, Math.round(r * Math.sin(a))];
                if (!pts.length || pointKey(pts[pts.length - 1]) !== pointKey(p))
                    pts.push(p);
            }
            return flat(pts);
        }
        case 'arrow': return flat([[-s, 0, -s], [s, 0, -s], [s, 0, -2 * s], [3 * s, 0, 0], [s, 0, 2 * s], [s, 0, s], [-s, 0, s]]);
    }
}
/** A quarter turn about Y takes +X to +Z. */
function turn(p, k) {
    let [x, y, z] = p;
    for (let i = 0; i < k; i++)
        [x, z] = [-z, x];
    return [x, y, z];
}
/** The shape turned to FACING and sitting on the origin, before any push into the grid. */
function turned(kind, size, facing) {
    const s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
    const base = local(kind, s);
    const k = FACED[kind] ? facing : 0;
    // Shapes are authored in units; positions are ticks.
    return { points: base.points.map((p) => { const t = turn(p, k); return [t[0] * TICKS_PER_UNIT, t[1] * TICKS_PER_UNIT, t[2] * TICKS_PER_UNIT]; }), faces: base.faces };
}
const moved = (points, by) => points.map((p) => [p[0] + by[0], p[1] + by[1], p[2] + by[2]]);
export const FLOOR = 1;
export function onPlane(points, plane) {
    if (plane === 1)
        return points;
    // `0 - v` rather than `-v`: negating a zero would leave a -0 in the model.
    return points.map(([x, y, z]) => (plane === 0 ? [y, 0 - x, z] : [x, 0 - z, y]));
}
/** The push that brings a shape back inside the grid: zero on an axis it already fits. */
function fit(points, extent = GRID_HALF) {
    const shift = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
        let lo = Infinity, hi = -Infinity;
        for (const p of points) {
            lo = Math.min(lo, p[a]);
            hi = Math.max(hi, p[a]);
        }
        const bound = extent * TICKS_PER_UNIT;
        if (lo < -bound)
            shift[a] = -bound - lo;
        else if (hi > bound)
            shift[a] = bound - hi;
    }
    return shift;
}
/**
 * The shape as it lands: turned to FACING, moved to the tap, and pushed back
 * inside the grid if any of it would poke out. Nothing here is wider than
 * the grid, so the push always succeeds.
 */
export function compile(kind, size, facing, origin, extent = GRID_HALF, plane = FLOOR) {
    const t = turned(kind, size, facing);
    const points = moved(onPlane(t.points, plane), origin);
    return { points: moved(points, fit(points, extent)), faces: t.faces };
}
/** Where a stamp aimed at `origin` lands: `origin` itself unless the grid's edge pushed it back. */
export function landing(kind, size, facing, origin, extent = GRID_HALF, plane = FLOOR) {
    const shift = fit(moved(onPlane(turned(kind, size, facing).points, plane), origin), extent);
    return [origin[0] + shift[0], origin[1] + shift[1], origin[2] + shift[2]];
}
/** The corners of a triangle as one order-free key. */
function triKey(a, b, c) {
    return [pointKey(a), pointKey(b), pointKey(c)].sort().join('|');
}
/**
 * The shard with the stamp added, or null when it would not fit the budget.
 * The stamp's own vertices are appended (never merged, see the header), its
 * triangles are re-indexed, and any triangle that exactly matches an existing
 * one corner for corner is dropped along with the one it matched.
 */
export function stamp(shard, kind, size, facing, origin, color, plane = FLOOR) {
    const shape = compile(kind, size, facing, origin, shard.extent, plane);
    const base = shard.vertices.length;
    const vertices = [
        ...shard.vertices,
        ...shape.points.map((p) => vertexAt(p, [...color])),
    ];
    const existing = new Map();
    shard.faces.forEach((f, i) => {
        const k = triKey(ticksOf(shard.vertices[f[0]]), ticksOf(shard.vertices[f[1]]), ticksOf(shard.vertices[f[2]]));
        existing.set(k, [...(existing.get(k) ?? []), i]);
    });
    const drop = new Set();
    const added = [];
    // Wound outward on the stamp's own points, in the wire's frame, before it
    // meets the shard: a stamp is whole by itself, and its faces' fronts are
    // what readers draw (DECK-0003 §1.4). Compiled, half a block looks in.
    for (const f of orientFaces(shape.points.map(toRender), shape.faces)) {
        const k = triKey(shape.points[f[0]], shape.points[f[1]], shape.points[f[2]]);
        const hits = existing.get(k);
        if (hits && hits.length) {
            drop.add(hits.pop());
            continue;
        }
        added.push([f[0] + base, f[1] + base, f[2] + base]);
    }
    const faces = [...shard.faces.filter((_, i) => !drop.has(i)), ...added];
    return { shard: { ...shard, vertices, faces }, culled: drop.size * 2 };
}
/**
 * The stamp on its own at the origin: what the aim ghost draws, placed at
 * `landing`. It depends on the shape and color only, never on the aim, so the
 * ghost's geometry is built once per shape and merely moved as the pointer
 * crosses cells; building it afresh per cell was the ghost's whole cost.
 */
export function preview(kind, size, facing, color, plane = FLOOR) {
    const shape = { ...turned(kind, size, facing) };
    shape.points = onPlane(shape.points, plane);
    return {
        id: 'ghost',
        name: kind,
        unit: 0,
        extent: GRID_HALF,
        // A ghost on the bench, which is never posed: the bench builds on
        // cyberspace axes and the snap happens at deploy (lib/pose.ts).
        up: false,
        spin: 0,
        mode: shape.faces.length ? 'solid' : 'lines',
        vertices: shape.points.map((p) => vertexAt(p, [...color])),
        faces: shape.faces,
        updatedAt: 0,
    };
}
//# sourceMappingURL=stamps.js.map