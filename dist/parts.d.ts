/**
 * parts.ts - one object placing others (DECK-0003 §1.10).
 *
 * The payload side (reading and writing `refs` and `parts`, rules 11 and 12)
 * lives in shards.ts with the rest of the wire. This is what a reader does
 * with them once read: fetch each placed object, follow its own parts no
 * deeper than four levels, treat a loop as missing, and say where each one
 * stands. Fetching is the client's, passed in, because this package does no
 * networking; the rules about what to do with what comes back are here, so
 * both clients draw the same thing.
 *
 * Anything that cannot be drawn becomes a placeholder, never a rejection of
 * the parent: another author's event is not this object's to guarantee.
 *
 * An object may also carry the objects it places, in `objects` (§1.10). The
 * table of the object being drawn is looked in first, at every depth, then the
 * table of the event the placing object travels in when it was fetched as its
 * own; an address a table holds is never fetched, even when its entry is bad.
 * Only keys under the pubkey of the event a table travels in count, and a
 * reader that does not know that pubkey honours none.
 */
import { type Part, type Ref, type ShardModel } from './shards.js';
/** How many levels of placement a reader follows from the object it draws (§1.10). */
export declare const MAX_PART_DEPTH = 4;
/** Why a placement is drawn as a placeholder. */
export type Missing = 
/** The fetch found nothing, or failed. */
'unreachable'
/** Something came back and failed §1.9. */
 | 'invalid'
/** More than MAX_PART_DEPTH levels down. */
 | 'deep'
/** The object is already one of its own parents. */
 | 'cycle'
/** Its unit plus the step leaves 0..84. */
 | 'scale'
/** Past MAX_PLACED, the most placements one resolve draws. */
 | 'budget'
/** Past the distinct objects this resolve may read (MAX_MODELS): too many different objects, not too many placements. */
 | 'objects';
/**
 * The most placements one resolve draws, at every depth together, placeholders
 * for loops and for levels past the depth bound included; past it, what is
 * left of each object's placements is one placeholder ('budget'), so a resolve
 * returns at most this many placements plus one marker per object cut short. Four levels of a few dozen placements each multiply fast: a
 * 3.4 KB table was measured placing 838,000 objects (204 MB before a single
 * mesh). A reader MAY bound its own work this way (DECK-0003 §1.10, §6).
 */
export declare const MAX_PLACED = 20000;
/**
 * With `budgetFor`, the most placements one resolve draws, whatever budgets
 * budgetFor names, and apart from them the most placeholders it charges for
 * spent budgets: a placeholder never takes a placement's place, so one
 * share's cuts never stop another share's placements. Past either, an object
 * cut short shows one placeholder ('budget') more, uncharged. So a resolve
 * returns at most MAX_NODES placements, MAX_NODES placeholders, and one more
 * placeholder per object drawn (at most three times MAX_NODES nodes in all).
 * Without budgetFor the one budget bounds a resolve already (at most its
 * `left` placements and one placeholder per object drawn), and this does not
 * apply.
 */
export declare const MAX_NODES: number;
/**
 * The most distinct objects one budget reads in a resolve: fetches started
 * and carried entries parsed, together. Memory goes with the distinct objects
 * a resolve holds, not with how often each is placed (a floor of 129 tiles is
 * one), so past this a placement of an object not yet read is a placeholder
 * ('objects'), and nothing more is fetched; one already read is still drawn.
 *
 * Each read is charged to the budget its placement is charged to: to the
 * budget's own `models`, when it has one (`{ left, models: { left } }`,
 * shared as the budget is), else to MAX_MODELS of the resolve's own for that
 * budget. So with budgetFor, a stranger's objects spend the strangers' reads,
 * never yours. Every read, whatever its budget, is charged to the resolve's
 * `models` too (ResolveOptions.models; 2 x MAX_MODELS when left out).
 *
 * Within an object, reads are reserved in placement order before anything is
 * awaited, and a tree carried in tables is read depth first, so both are the
 * same every time; among objects fetched separately, the order is the order
 * their fetches answer in. A whole kit of pieces is a few dozen.
 */
export declare const MAX_MODELS = 1000;
/** A placement with what it places, or why it is a placeholder. */
export interface Placed {
    part: Part;
    ref: Ref;
    /** The placed object, or null for a placeholder. */
    model: ShardModel | null;
    missing?: Missing;
    /**
     * True when a table answered for this placement (§1.10): the object was drawn
     * from, or its bad entry is a placeholder from, the `objects` of the object
     * being drawn or of a fetched object above it. Absent when it was fetched.
     */
    carried?: true;
    /** Its own placements, resolved the same way. */
    children: Placed[];
}
/**
 * What a fetch hands back when it knows whose event it read: the payload, and
 * the pubkey of the event, so that an object fetched by `e` keeps its own table
 * (§1.10: keys only under the pubkey of the event a table travels in). A fetch
 * by `a` needs none, since the address names its author.
 */
export declare class Fetched {
    readonly payload: unknown;
    readonly pubkey: string;
    constructor(payload: unknown, pubkey: string);
}
/**
 * What a client passes in: the payload the reference names (parsed JSON), or a
 * Fetched with the event's pubkey, or null when there is none.
 */
export type FetchRef = (ref: Ref) => Promise<unknown>;
/** One string per placed object, whatever relay hint came with it: for caching and for finding loops. */
export declare function refKey(ref: Ref): string;
/** An `a` target's three parts, for a relay filter: kind, author and `d`. */
export declare function parseAddress(target: string): {
    kind: number;
    pubkey: string;
    d: string;
} | null;
/**
 * The tags a public kind 33331 carrying this object SHOULD also have, one per
 * reference, unchanged (§1.10), so a relay can answer "what places this
 * object" with `#a` or `#e`. Only references a placement uses.
 */
export declare function refTags(s: Pick<ShardModel, 'refs' | 'parts'>): string[][];
/**
 * The table `s` carries (§1.10), as a reader uses it: only keys under `author`,
 * the pubkey of the event it travels in (a key under any other pubkey is
 * ignored and its address fetched). Null, an author nobody knows, honours no
 * key at all: never every key. Never refuses: a table that is not one reads
 * as empty. The values are unchecked payloads.
 */
export declare function carriedTable(s: Pick<ShardModel, 'objects'>, author: string | null): Record<string, unknown>;
/**
 * `model` as read from an event whose pubkey is `pubkey` (or null when it is not
 * known): `author` set, and only the table keys under it kept, so that every
 * draw after this takes the table as it is (§1.10). For a signed event that is
 * its pubkey; for an unsigned item in a bag, the bag's signer, never the
 * item's own claim. The same model when nothing changes.
 *
 * Never pass the local user's pubkey for a payload that was not read from an
 * event that user signed (text pasted, a file, an import): anyone can write
 * keys under anyone's name, so such a payload's table is trusted for no one;
 * pass null.
 */
export declare function withAuthor(model: ShardModel, pubkey: string | null): ShardModel;
/**
 * One entry of a table read as a model, checked by §1.9 on its own, with any
 * `objects` of its own ignored (a table is flat), and with the id
 * `a:<address>`, the reference's key, as a fetched object has. Undefined when the table does
 * not hold `address`, null when it holds a bad entry, which is a placeholder
 * for each placement naming it and is still not fetched.
 */
export declare function carriedModel(table: Record<string, unknown>, address: string, read?: (payload: unknown, key: string) => ShardModel | null): ShardModel | null | undefined;
/** How resolveParts is called. */
export interface ResolveOptions {
    /** The model as a published object: it counts as the first parent, so an object placing itself is a loop. */
    self?: Ref;
    /**
     * The pubkey of the event `model` travels in (or of its author, for an object
     * not yet published): only keys of its table under it count (§1.10). Null
     * says it is not known, and no key counts. Left out, it is `model.author`
     * (withAuthor), else the pubkey an `a` `self` names, else null: a table is
     * never honoured on no one's word.
     */
    author?: string | null;
    /**
     * How a payload, fetched or from a table, becomes a model: `fromPayload` by
     * default. A client that keeps one model per payload object for the whole
     * app passes its own; it must answer as fromPayload does, null for a payload
     * §1.9 refuses.
     */
    read?: (payload: unknown, key: string) => ShardModel | null;
    /**
     * The placements this resolve may still draw, shared: pass one object to
     * several resolves and they draw MAX_PLACED, or whatever `left` starts at,
     * between them (a client resolving every shard around a walker at once).
     * Left out, each call has MAX_PLACED of its own. One it cannot write
     * (frozen, or `left` not a writable number) is read once, as this call's
     * own: not shared, but the resolve does not throw.
     */
    budget?: {
        left: number;
        models?: {
            left: number;
        };
    };
    /**
     * The distinct objects this resolve may read, whatever budget each is
     * charged to (MAX_MODELS), shared as `budget` is. Left out, 2 x MAX_MODELS
     * of its own: enough for two shares of MAX_MODELS each (yours and
     * strangers'). It is a backstop, not a share, so it should be at least the
     * sum of the shares' reads: a caller with more shares, or whose budgets
     * carry `models` larger than MAX_MODELS, passes one that covers them, or the
     * backstop cuts a share that still has reads left.
     */
    models?: {
        left: number;
    };
    /**
     * Which budget a placement is charged to: given the author of the object it
     * places (the pubkey its `a` address names; null for an `e`, whose author is
     * not known until it is fetched) and the budget its parent placement was
     * charged to (`budget` for the object being drawn), the budget to charge.
     * Left out, every placement is charged to `budget`. A client that spends one
     * share on its own objects and another on strangers' passes this, so a
     * trusted object placing a stranger's charges that child, and all under it,
     * to the strangers' share.
     *
     * It MUST be sticky: once a placement is charged to a stranger's share,
     * every placement under it is charged to that share too (given a parent on
     * the strangers' share, answer that share, whoever the author), and so are
     * the objects those placements read (each read goes to its placement's
     * budget). Otherwise a stranger reaches your share, for placements and for
     * reads, by placing your objects under theirs.
     *
     * Asked once per author and parent budget for the whole resolve, not per
     * placement: its first answer for an author under a parent is the one every
     * later placement of theirs there is charged to. Its budgets must come from
     * a small fixed set the caller holds (one per share), never one per author:
     * each budget spent cuts an object short with a placeholder of its own.
     * However many it names, a resolve draws no more than MAX_NODES (and its
     * placeholders are bounded apart from that: see MAX_NODES). An answer that
     * is not a budget (not an object with a writable number `left`), or a
     * throw, charges the parent's.
     * A `left` under 1 is spent.
     */
    budgetFor?: (author: string | null, parent: {
        left: number;
    }) => {
        left: number;
    };
}
/**
 * Every placement of `model`, resolved. One fetch per distinct object, however
 * many times it is placed: a floor of 129 tiles fetches the tile once.
 *
 * Each placement's address is looked up first in `model`'s own table, at any
 * depth, then in the table of the event the placing object travels in when
 * that is another one (an object fetched by its `a` address, whose keys must be
 * under that address's pubkey; an object fetched by `e`, under the pubkey the
 * fetch says in a Fetched, and none when it does not say), and only what
 * neither holds is fetched (§1.10). No more than MAX_PLACED placements are
 * drawn, the rest placeholders. The third argument may be a bare `self`
 * reference, as it was before tables existed.
 */
export declare function resolveParts(model: ShardModel, fetch: FetchRef, options?: Ref | ResolveOptions): Promise<Placed[]>;
/**
 * The payload an object is carried as in a table: its own payload with its own
 * `objects` taken off, because a table is flat (§1.10).
 */
export declare function carriedPayload(object: ShardModel): Record<string, unknown>;
/**
 * `root` carrying `object` under `address` (§1.10), replacing any entry there.
 * A writer flattens: whatever `object` carries itself goes into `root`'s table
 * too, under keys the table does not already hold (the root's table is looked
 * in first, so an entry it holds already is the one that is drawn), and only
 * keys under the pubkey `address` names, the writer's own (a publisher MUST
 * write no other). `address` is not checked against `root`'s refs here.
 */
export declare function carryObject(root: ShardModel, address: string, object: ShardModel): ShardModel;
/** `root` without the entry for `address`; the table goes when it is empty. */
export declare function uncarry(root: ShardModel, address: string): ShardModel;
/** What a writer's lookup says about one address: the object, and whether to carry it or only look inside it. */
export interface CarryChoice {
    object: ShardModel;
    /** True: carry it in the root's table. False: leave it a reference, but carry what it places where `lookup` says so. */
    carry: boolean;
}
/**
 * `root` carrying every object `lookup` chooses, at any depth, flattened into
 * `root`'s one table (§1.10): the writer's half of the rule a reader follows.
 * Walks `root`'s placements and then the placements of each object `lookup`
 * returns, no deeper than MAX_PART_DEPTH, each address at the shallowest depth
 * any placement reaches it (an address met first deep down and again nearer
 * the top is walked again from there, so what it places is carried too), and
 * never into an address already among the parents. An address the table already holds is
 * kept as it is (and walked through), so an edited copy is never replaced by
 * the object it was copied from. `lookup` is given the reference as written,
 * relay hint included, and returns null for one to leave alone, for example
 * someone else's object or a live link. The caller checks the size.
 * Synchronous, so a writer can carry and check the size before anything else
 * in its flow yields: a lookup answers from what is in hand.
 *
 * With `prune`, entries of the table that the walk did not reach go, since no
 * placement draws them and they would be carried to every reader for nothing
 * (§1.10). A reference `lookup` left alone is not walked into, so an entry
 * reached only through one is dropped too, which is why pruning is asked for
 * rather than done: a table another client wrote may carry objects placed
 * beneath a reference this writer does not walk.
 */
export declare function carryAll(root: ShardModel, lookup: (ref: Ref) => CarryChoice | null, options?: {
    prune?: boolean;
}): ShardModel;
/** A row-major 3x3. */
export type M3 = [number, number, number, number, number, number, number, number, number];
/**
 * The rotation a turn names: about X, then Y, then Z, all fixed axes, so
 * Rz Ry Rx. The same formula serves the wire's frame and the model's,
 * because mirroring each factor through Z is exactly mirrorTurn.
 */
export declare function turnMatrix(t: [number, number, number]): M3;
/**
 * The turn a rotation matrix is, back in whole degrees about X, then Y, then
 * Z. At a quarter turn about Y, X and Z turn about the same line and only
 * their sum is fixed, so the Z turn is taken as 0 there.
 */
export declare function turnFromMatrix(r: M3): [number, number, number];
/**
 * Where a placed object stands, as a 4x4 matrix in column-major order (what
 * three.js `Matrix4.fromArray` takes), in the frame renderers draw in: the
 * wire's (shards.ts toRender). It carries a point of the placed object, as
 * `toRender` gives it in the placed object's own model units, to the parent's
 * model units. Then the parent's own scale applies to both alike.
 *
 * The turn is about the parent's X, then Y, then Z (§1.10), so its matrix is
 * Rz Ry Rx. The scale is 2^(its unit + step - the parent's unit): the placed
 * object is drawn at 2^(its unit + step) base units per model unit, and the
 * parent's model unit is 2^(its unit).
 */
export declare function partMatrix(part: Part, parentUnit: number, placedUnit: number): number[];
/**
 * A placement turned a quarter about a pivot, the way the workshop's TURN
 * turns points: in the plane of axes `a` and `b`, taking `a` toward `b`.
 * Its origin swings about the pivot exactly as a vertex would, and its own
 * turn takes the same quarter, so a placed object turns with the points
 * around it. Model frame in, model frame out. Null when the origin would
 * leave the 64-unit bound.
 */
export declare function quarterTurnPart(part: Part, a: 0 | 1 | 2, b: 0 | 1 | 2, pivot: [number, number]): Part | null;
/**
 * The object with one more placement, naming `ref`. A reference already in
 * `refs` is reused rather than repeated (§1.10: refs names each object once).
 * Returns the new placement's index too.
 */
export declare function addPart(s: ShardModel, ref: Ref, place: Omit<Part, 'ref'>): {
    shard: ShardModel;
    index: number;
};
/**
 * The object without the placements at `indices`; references no placement uses
 * any more go, and the rest renumber. A carried object (§1.10) whose reference
 * goes goes with it, unless something left can still reach it: another entry
 * of the table, or any placement that is fetched, since what a fetched object
 * places is looked up in this table too and cannot be seen from here.
 */
export declare function removeParts(s: ShardModel, indices: Iterable<number>): ShardModel;
/** An axis-aligned box in the frame renderers draw in, in the object's own model units. */
export interface Bounds {
    min: [number, number, number];
    max: [number, number, number];
}
/**
 * What the object occupies once its parts are placed: its own vertices, each
 * placed object's bounds carried through its placement, and a placeholder's
 * unit cube, centred on where it stands. What a preview frames and what a
 * parent's extent grows to hold (§1.10). Null for nothing at all.
 */
export declare function placedBounds(s: ShardModel, placed: Placed[]): Bounds | null;
//# sourceMappingURL=parts.d.ts.map