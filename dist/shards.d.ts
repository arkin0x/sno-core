/**
 * shards.ts — the shape of a shard, and nothing about where it goes.
 *
 * A shard is a small 3D object: vertices with colors, optional triangles,
 * and a render mode. The mesh is only one way to draw it. Vertices alone can
 * be lights, and a polyline through them blends their colors along the line
 * the way a mesh blends across a face, so the same vertex list carries all
 * three and the mode is a property of the shard, not of the viewer.
 *
 * Vertices sit on an integer grid in model units, and a shard carries the
 * exponent that says what one unit is in gibsons, so a gibson-sized trinket
 * and a sector-sized monument are the same data at different `unit`. Integers
 * because precision is the whole point of this client: a vertex is at a
 * coordinate, not near one.
 *
 * Pure. The builder store mutates copies of these; the world draws them.
 */
import { type Pose } from './pose.js';
import { type Palette } from './snoPalette.js';
export type ShardMode = 'solid' | 'points' | 'lines';
export interface ShardVertex {
    /** Whole units per axis: the point's floor, what the wire's `vertices` carries. */
    p: [number, number, number];
    /** The rest of the position in ticks, 0..119 per axis; absent when the point is whole. */
    t?: [number, number, number];
    /** 0..1 per channel. */
    c: [number, number, number];
}
/**
 * A vertex copied whole, ticks included.
 *
 * The two halves of a position, whole units in `p` and the remainder in `t`,
 * have to travel together. A copy that takes `p` and `c` and forgets `t`
 * silently moves every sub-unit vertex onto the corner of its cell, and
 * vertices that shared a cell land on each other, which turns their faces
 * into triangles with no area that draw nothing at all.
 */
export declare function cloneVertex(v: ShardVertex): ShardVertex;
/**
 * Ticks to a grid unit. A position is stored as whole ticks, so a third, a
 * quarter or a fifth of a unit is exact and they mix freely in one shard:
 * 120 is divisible by every division the workshop offers and by eighths.
 */
export declare const TICKS_PER_UNIT = 120;
/**
 * The grid divisions offered, all of them exact.
 *
 * A vertex is stored in 120ths of a unit (TICKS_PER_UNIT), so a division is
 * only offered when it divides 120 without a remainder: sevenths and ninths
 * would land vertices between ticks and could not be written to the wire.
 * Past 10 the finer steps are 12, 20, 24, 30, 40, 60 and 120, the last being
 * a single tick (arkinox, 2026-10-15). Fiftieths are deliberately absent:
 * 120 / 50 is not whole. 15 is exact too but adds little between 12 and 20.
 */
export declare const DIVISIONS: readonly [1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 24, 30, 40, 60, 120];
export type Division = typeof DIVISIONS[number];
export interface ShardModel {
    id: string;
    name: string;
    /** One model unit is 2^unit gibsons. */
    unit: number;
    /** Half-width of this shard's build grid, in units: the grid runs from -extent to +extent on every axis. */
    extent: number;
    /** A vertex is whole units plus ticks, kept apart as on the wire: see ShardVertex. */
    mode: ShardMode;
    vertices: ShardVertex[];
    /** Triangles as vertex indices; drawn in `solid` mode only. */
    faces: Array<[number, number, number]>;
    /**
     * Stands on the Earth: +Y to the ground's up at the place it is hidden,
     * +Z facing `spin`. False for a shard on the bench and for one placed on
     * cyberspace axes as built (lib/pose.ts).
     */
    up: boolean;
    /** The compass bearing +Z faces when `up`: whole degrees 0..359, clockwise from north. 0 otherwise. */
    spin: number;
    /**
     * A colour of its own for each face, or absent when every face interpolates
     * its corners. Expanded here, one entry per face, and run-length encoded
     * only on the wire: a run is a wire economy, and carrying it in memory would
     * mean every edit had to think about it.
     */
    facecolors?: Array<[number, number, number]>;
    /**
     * The 256 colours this object's indices name (DECK-0003 §1.3a), or absent
     * for the built-in.
     *
     * The index itself is not stored on a vertex. A colour in the model is
     * always exactly a palette entry, because the workshop only offers palette
     * colours, so the index is recoverable at any moment by looking the colour
     * up in whichever palette is current. That keeps one source of truth instead
     * of an index and a colour that can drift apart, and it keeps every renderer
     * and the clipper reading plain RGB, which the clipper needs: it interpolates
     * colour across a cut, and you cannot interpolate an index.
     *
     * Switching palettes is therefore a single pass that reads each index off the
     * old palette and writes the new palette's colour at that index.
     */
    palette?: Array<[number, number, number]>;
    /** What the author called that palette. Local only; the wire carries colours, not names. */
    paletteName?: string;
    /** The objects this one places, as nostr references (DECK-0003 §1.10). Absent: it places none. */
    refs?: Ref[];
    /**
     * Where each placed object stands (§1.10), in this model's frame like the
     * vertices: the wire's with Z negated. See `Part`.
     */
    parts?: Part[];
    /**
     * How opaque the object is drawn, a whole percent (DECK-0003 §1.11). Absent
     * means fully opaque, which is every object written before the field
     * existed. A model from `fromPayload` or `normalizeStored` holds 1 to 99 or
     * nothing (100 and malformed values read as absent); 1 to 9 are kept as
     * written and drawn at the floor by `drawnOpacity`.
     */
    opacity?: number;
    /**
     * The objects this one carries for its placements (DECK-0003 §1.10), keyed by
     * the address an `a` reference names, each value a payload exactly as it came
     * (the wire's form, not a model). Absent when it carries none.
     *
     * Held as payloads rather than models for two reasons. Each entry is checked
     * on its own, only when a placement draws from it (§1.9 rule 16), so a bad
     * entry is a placeholder for its placements and never a reason to refuse this
     * object; and an entry nobody edits is written back exactly as it was read,
     * whatever version of the format wrote it. `carriedModel` (parts.ts) reads one
     * entry as a model, and `carryObject` writes one.
     */
    objects?: Record<string, unknown>;
    /**
     * The pubkey of the event this model was read from, when the reader knows it
     * (parts.ts withAuthor): the only pubkey whose keys of `objects` count
     * (DECK-0003 §1.10). Local only: never on the wire, as `paletteName`.
     */
    author?: string;
    /**
     * The payload's fields this library does not know, kept exactly as they came
     * so that reading an object and writing it back does not strip them. DECK-0003
     * §5 has a reader ignore what it does not recognise; carrying it through an
     * edit is this library's choice on top of that, so that an older editor does
     * not undo a newer one. Absent when there were none.
     *
     * A field added to the format after this version (say a new optional
     * setting) would otherwise vanish the first time anyone with an older client
     * opened the object, nudged one vertex and published: silently, and for
     * everyone who reads the object after them. Carried here, it travels
     * through every edit untouched, and the newer reader still finds it.
     *
     * Never read, only carried. Not validated, because this library cannot know
     * what a field it does not know should look like; a newer reader validates
     * it as its own version of the format says. Carried unchanged even when the
     * geometry is edited, which is right for a setting that does not depend on
     * the geometry (a single number such as an opacity) and would be wrong for
     * one that does (a per-vertex list), so a field of the second kind needs the
     * format's own answer before anyone adds one.
     *
     * A copy or remix built by spreading a model keeps `extra` along with every
     * other setting. A caller that wants the shape alone drops it.
     */
    extra?: Record<string, unknown>;
    updatedAt: number;
}
/**
 * A nostr reference to a placed object, written the way a tag writes one
 * (DECK-0003 §1.10): `a` follows its author's newest version, `e` names one
 * event. The third entry is a relay hint.
 *
 * Writers here always use `a` (arkinox, 2026-09-25): an addressable kind keeps
 * only its newest version on most relays (NIP-01: older versions MAY be
 * discarded), so an `e` to a version that has since been replaced may find
 * nothing. Someone who wants a build no one else can change copies the object
 * and publishes it under their own key. `e` is still read.
 */
export type Ref = [kind: 'a' | 'e', target: string, relay?: string];
/**
 * One placement (DECK-0003 §1.10), kept in the model's frame: the wire's with
 * Z negated, as the vertices are. On the wire it is eight integers; the
 * conversion happens at the payload boundary and nowhere else.
 */
export interface Part {
    /** Index into `refs`. */
    ref: number;
    /** Where the placed object's origin stands, in this model's ticks. */
    at: [number, number, number];
    /** Whole degrees 0..359 about this model's X, then Y, then Z. */
    turn: [number, number, number];
    /** Scale step: drawn at 2^(its own unit + step) base units per model unit. */
    step: number;
}
/** Wire form: what goes in an event's content, public or decrypted. */
export interface ShardPayload {
    /** 1 was this client's own frame; 2 is the published one (DECK-0003 §2). */
    v: 1 | 2;
    name: string;
    unit: number;
    /** Grid half-width the shard was built on; absent in older payloads (8). */
    extent?: number;
    mode: ShardMode;
    /** Whole units per vertex, the floor of the position: what a reader from before ticks sees. */
    vertices: Array<[number, number, number]>;
    /**
     * The rest of each position in ticks, 0..119 per axis, one entry per vertex
     * in order; a negative number -N stands for N vertices of [0, 0, 0] in a
     * row. Absent in older payloads: every position is whole.
     */
    ticks?: Array<[number, number, number] | number>;
    /**
     * One palette index per vertex, parallel to `vertices` (DECK-0003 §1.3).
     *
     * A `v: 1` payload carries a literal `[r, g, b]` triple here instead, which
     * is what every shard written before the palette existed looks like. A
     * writer only ever produces indices.
     */
    colors: Array<number | [number, number, number]>;
    faces: Array<[number, number, number]>;
    /** Which 256 colours the indices name: a name, an naddr, or the list itself (§1.3a). */
    palette?: string | Array<[number, number, number]>;
    /**
     * One palette index per face, in the order `faces` gives them, run-length
     * encoded the way `ticks` is: an entry is either an index or a negative
     * integer -N standing for N further faces of the index before it. Absent
     * means every face interpolates its three vertices, which is the format's
     * default and not the same as colour 0 (DECK-0003 §1.4a).
     */
    facecolors?: number[];
    /** A whole percent 1 to 100; absent means 100 (DECK-0003 §1.11). Omitted when 100. */
    opacity?: number;
    /** Present and true when the shard stands on the Earth where it is hidden (lib/pose.ts). Absent otherwise. */
    up?: true;
    /** With `up`: the compass bearing +Z faces, a whole number 0..359. Ignored without `up`. */
    spin?: number;
    /** The objects this one places (§1.10). */
    refs?: Ref[];
    /** Placements, eight integers each: ref index, x y z in ticks, turns about X Y Z in whole degrees, scale step. */
    parts?: number[][];
    /** The objects this one carries for its placements, keyed by address (§1.10). Omitted when it carries none. */
    objects?: Record<string, unknown>;
}
export declare const MODES: ShardMode[];
/**
 * What a writer calls an object whose author has not named it, or has
 * cleared the name. DECK-0003 §1.1 requires a name that is not blank, and
 * advises a writer to supply a placeholder so that nobody publishes an
 * object every reader refuses by leaving a text box empty.
 */
export declare const PLACEHOLDER_NAME = "Untitled";
/**
 * Whether a name is blank under DECK-0003 §1.9 rule 1a: empty, or nothing but
 * whitespace, which the deck defines as Unicode's White_Space characters.
 * Spelled out rather than left to `trim()`, which also strips U+FEFF, a
 * character the deck does not count and the reference keeps.
 */
export declare function blankName(name: string): boolean;
/**
 * Every payload field this library reads (DECK-0003 §1.1), and `type`, the
 * legacy field it ignores (§1.1a). Anything else is carried in `extra`.
 * `type` is known so that it is dropped rather than carried: a publisher
 * SHOULD NOT write it, and carrying it would write it again on every edit.
 */
export declare const PAYLOAD_FIELDS: readonly ["v", "type", "name", "unit", "extent", "mode", "vertices", "ticks", "colors", "faces", "facecolors", "palette", "up", "spin", "refs", "parts", "opacity", "objects"];
/**
 * `s` with every field in `extra` that this version knows taken out of it:
 * lifted onto the model where there is a lift for it, dropped otherwise
 * (a known field is always the one this library computes). The same model
 * when there is nothing to do.
 */
export declare function liftKnown(s: ShardModel): ShardModel;
/**
 * The fields of `p` this library does not know, as a fresh object, or
 * undefined when there are none. Built with Object.fromEntries, which defines
 * each key as a plain property of its own, so a payload carrying a key named
 * `__proto__` (JSON.parse makes it an ordinary own key) is carried as data and
 * can never reach an object's prototype. The values are deep copies: the
 * model never shares structure with the event it was read from. A value that
 * cannot be copied (a function or a symbol, which no JSON payload can hold)
 * is left behind rather than thrown on.
 */
export declare function unknownFields(p: object): Record<string, unknown> | undefined;
/** Default half-width of the build grid, in units; each shard keeps its own (`extent`). */
export declare const GRID_HALF = 8;
export declare const MIN_EXTENT = 1;
export declare const MAX_EXTENT = 64;
/**
 * The largest `unit` a shard can be built or deployed at.
 *
 * One unit is 2^unit gibsons and there are 2^33 gibsons to a meter, so 2^84 is
 * about 2.4e15 meters, a quarter of a light year: past a sector and well past
 * anything a shard should span. 0 is the floor, one gibson, about 116 pm.
 */
export declare const MAX_UNIT = 84;
/**
 * A unit brought inside the bounds, as a whole number.
 *
 * The workshop's DEPLOY SCALE MULTIPLIER and the deploy bar's SCALE MULTIPLIER
 * are the same quantity set in two places, so they clamp through one function
 * rather than repeating the same two literals and drifting apart.
 */
export declare function clampUnit(unit: number): number;
/**
 * A new shard draws LINES: the first tap glows and the second draws a line,
 * so the very first thing you do is visible. Faces switch it to SOLID when
 * the first stamp with faces lands (see the workshop store).
 */
export declare function newShard(name?: string): ShardModel;
/** A grid point as a map key, so "the same point" is one string compare. */
/** A point's key, from its position in total ticks. */
export declare function pointKey(p: [number, number, number]): string;
/** A vertex's position as total ticks, the form arithmetic and keys use. */
export declare function ticksOf(v: Pick<ShardVertex, 'p' | 't'>): [number, number, number];
/** A vertex from a position in total ticks: whole units, and the rest as ticks only when there is any. */
export declare function vertexAt(total: [number, number, number], c: [number, number, number]): ShardVertex;
export declare function uuid(): string;
/** Integers inside the grid; anything else is not a vertex. */
export declare function validPoint(p: [number, number, number], extent?: number): boolean;
/**
 * A stored model made whole again. Models have always kept `p` in units; for
 * a short while after ticks arrived they kept total ticks there instead, and
 * such a model shows itself by a coordinate no grid could hold (above
 * MAX_EXTENT units). Those are split back into units and ticks.
 */
export declare function normalizeStored(saved: ShardModel): ShardModel;
/** The grid half-width a shard needs to hold every vertex it has. */
export declare function neededExtent(s: Pick<ShardModel, 'vertices'> & Partial<Pick<ShardModel, 'parts'>>): number;
export declare function clampColor(c: [number, number, number]): [number, number, number];
/** A face needs three distinct vertices that exist. */
export declare function validFace(f: [number, number, number], count: number): boolean;
/**
 * The wire's handedness, and why it is not this client's.
 *
 * DECK-0003 §2: an SNO payload is right-handed with Y up and +Z toward the
 * viewer, which is the glTF and three.js convention, so that any tool can read
 * one without a special case. Cyberspace's own +Z is the black sun, away from
 * the viewer, and everything in this client is built in that frame.
 *
 * The two differ by one sign, so the conversion is a negation of Z and it
 * happens here, at the payload boundary, and nowhere else. Nothing inside the
 * client changes: no stored model moves, no renderer changes, nothing already
 * on screen looks different. What changes is that what goes out on the wire is
 * readable by anyone.
 *
 * `v` says which frame a payload is in. `1` is what this client wrote while the
 * format lived only here, and its Z is already this client's, so it is read
 * unchanged. `2` is the published convention and is negated on the way in and
 * on the way out. A publisher writes 2 forever.
 */
export declare const WIRE_VERSION = 2;
/** The 64-unit position bound of DECK-0003 §1.8, in ticks: how far a placement may stand. */
export declare const PART_REACH: number;
/**
 * §1.10 and §1.9 rule 16: the `objects` a payload carries, or undefined for
 * none. Never a refusal: a value that is not a JSON object, null and arrays
 * included, reads as absent, and a key that is not an address
 * (`33331:<64 lowercase hex>:<d>`) is dropped. The values are deep copies of
 * whatever came, unchecked, because each one is checked on its own when a
 * placement draws from it. Built with Object.fromEntries, as unknownFields is,
 * so a key named `__proto__` stays data.
 */
export declare function readObjects(raw: unknown): Record<string, unknown> | undefined;
/** The `a` targets a raw payload's `refs` names, read leniently: what an entry of a table may reach. */
export declare function addressesIn(raw: unknown): string[];
/**
 * A turn seen through the Z mirror between the wire and the model: turns
 * about X and Y change sign, a turn about Z does not. Its own inverse.
 */
export declare function mirrorTurn(t: [number, number, number]): [number, number, number];
/** The least opacity an object is drawn at, in percent: nothing is ever wholly invisible (DECK-0003 §1.11). */
export declare const OPACITY_FLOOR = 10;
/**
 * The `opacity` a payload carries, or undefined for fully opaque.
 *
 * A malformed value (not an integer, outside 1..100, null, a string) is
 * repaired to opaque rather than refused, as `extent` is repaired (§1.11):
 * opaque is always a correct way to draw an object, so a bad value costs the
 * author their translucency and nothing else. 100 reads as absent too, so a
 * model only ever holds 1 to 99.
 */
export declare function readOpacity(raw: unknown): number | undefined;
/**
 * The opacity to draw `s` at, as a fraction from 0.1 to 1: its own percent
 * with the floor applied, or 1 when it has none. A placed object's comes from
 * its own model, never from the object that places it (§1.10), and a reader
 * drawing an avatar ignores it altogether (§3.3).
 */
export declare function drawnOpacity(s: Pick<ShardModel, 'opacity'>): number;
export declare function toPayload(s: ShardModel): ShardPayload;
/**
 * Strict on shape, forgiving on nothing: a payload is what the wire gives
 * back, and a shard with a face pointing at a vertex it does not have would
 * throw inside three.js at draw time, far from anything that could explain it.
 */
/** The ticks column for the wire: runs of whole positions become one negative count. */
export declare function packTicks(rest: Array<[number, number, number]>): Array<[number, number, number] | number>;
/**
 * Face colours packed for the wire (DECK-0003 §1.4a).
 *
 * The same run-length shape as `ticks`, for the same reason: the common case
 * is a run. A stamped block is twelve triangles of one colour, so a solid cube
 * is `[[1, 0, 0], -11]` rather than twelve copies of the same triple. The
 * first entry is always a triple, because a run has nothing to repeat before
 * one.
 */
export declare function packFaceColors(indices: number[]): number[];
/**
 * Face colours read back, one index per face, or null when they do not fit
 * `count` faces or name a colour the palette does not have. A run longer than
 * the faces left is refused before it is expanded.
 *
 * The sign separates an index from a run, which works because an index is
 * never negative. It is the same trick `ticks` uses, and it is why a colour
 * had to become one number before face colours were affordable: a list of
 * triples interleaved with run markers cost more than it saved.
 */
export declare function unpackFaceColors(packed: unknown, count: number, palette: Palette): number[] | null;
/**
 * A shard with its face colours turned into vertex colours, for drawing.
 *
 * A face colour is a hard seam: the three corners of a triangle must all be
 * that colour and nothing may interpolate across the edge into the next one.
 * Shared vertices cannot express that, since a vertex belongs to every face
 * that touches it, so each face gets three corners of its own.
 *
 * Done here, once, before anything else looks at the geometry, so the winding
 * pass, the clipper and the face picker all work on ordinary vertex colours
 * and none of them has to know this feature exists. Face order is preserved,
 * which is what keeps a tap on a face resolving to the same face.
 *
 * This is a render-time expansion and never goes back on the wire, so it is
 * not subject to the format's vertex ceiling.
 */
export declare function expandFaceColors(s: ShardModel): ShardModel;
/**
 * The ticks column read back, one triple per vertex, or null when it does not
 * fit `count` vertices. A run longer than the vertices left is refused before
 * it is expanded, as is a run of none.
 */
export declare function unpackTicks(packed: unknown, count: number): Array<[number, number, number]> | null;
export declare function fromPayload(raw: unknown, id: string, fetchedPalette?: string | null): ShardModel | null;
/** The flat arrays three.js wants, in one place so every drawer agrees. */
/**
 * A model position as the scene draws it. Model axes are cyberspace axes,
 * and the world draws cyberspace with Z negated (lib/space.ts
 * flipHandedness), so model +Z is render -Z here too: the bench and the
 * world show the same object, and the bench's blue arrow points where the
 * world's compass does.
 */
export declare function toRender(p: [number, number, number]): [number, number, number];
/**
 * A vertex through a pose, if there is one: the shard standing where it was
 * placed rather than lying on the axes it was built on (pose.ts). Applied in
 * ticks, before `toRender`, so a pose is a turn of the shape and says nothing
 * about the screen. A client with nowhere to place an object passes none and
 * this is the identity.
 */
export declare function posed(t: [number, number, number], pose?: Pose): [number, number, number];
export declare function flatten(s: ShardModel, pose?: Pose): {
    positions: Float32Array;
    colors: Float32Array;
    index: number[];
};
/** Where the shard's vertices sit on average: what the workshop orbits. */
export declare function centroid(s: ShardModel): [number, number, number];
/** Hex <-> 0..1 triple, for the color input. */
export declare function hexToRgb(hex: string): [number, number, number];
export declare function rgbToHex(c: [number, number, number]): string;
/** A tick count as units for reading: "2", "1/3", "-2 3/4". */
export declare function unitsLabel(ticks: number): string;
//# sourceMappingURL=shards.d.ts.map