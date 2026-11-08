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
import { MAX_UNIT, PART_REACH, addressesIn, fromPayload, mirrorTurn, readObjects, ticksOf, toPayload, toRender } from './shards.js';
/** How many levels of placement a reader follows from the object it draws (§1.10). */
export const MAX_PART_DEPTH = 4;
/**
 * The most placements one resolve draws, at every depth together, placeholders
 * for loops and for levels past the depth bound included; past it, what is
 * left of each object's placements is one placeholder ('budget'), so a resolve
 * returns at most this many placements plus one marker per object cut short. Four levels of a few dozen placements each multiply fast: a
 * 3.4 KB table was measured placing 838,000 objects (204 MB before a single
 * mesh). A reader MAY bound its own work this way (DECK-0003 §1.10, §6).
 */
export const MAX_PLACED = 20_000;
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
export const MAX_NODES = 2 * MAX_PLACED;
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
export const MAX_MODELS = 1_000;
/**
 * What a fetch hands back when it knows whose event it read: the payload, and
 * the pubkey of the event, so that an object fetched by `e` keeps its own table
 * (§1.10: keys only under the pubkey of the event a table travels in). A fetch
 * by `a` needs none, since the address names its author.
 */
export class Fetched {
    payload;
    pubkey;
    constructor(payload, pubkey) {
        this.payload = payload;
        this.pubkey = pubkey;
    }
}
/** One string per placed object, whatever relay hint came with it: for caching and for finding loops. */
export function refKey(ref) {
    return `${ref[0]}:${ref[1]}`;
}
/** An `a` target's three parts, for a relay filter: kind, author and `d`. */
export function parseAddress(target) {
    // A `d` is any string, as NIP-01 allows, line breaks included (the `s` flag),
    // as the reference reads it (sno-reference.py, re.S).
    const m = /^(\d+):([0-9a-f]{64}):(.*)$/s.exec(target);
    return m ? { kind: Number(m[1]), pubkey: m[2], d: m[3] } : null;
}
/**
 * The tags a public kind 33331 carrying this object SHOULD also have, one per
 * reference, unchanged (§1.10), so a relay can answer "what places this
 * object" with `#a` or `#e`. Only references a placement uses.
 */
export function refTags(s) {
    if (!s.refs || !s.parts)
        return [];
    const used = new Set(s.parts.map((p) => p.ref));
    return s.refs.filter((_, i) => used.has(i)).map((r) => r.filter((x) => typeof x === 'string'));
}
/** The pubkey an address names, or null when the target is not one. */
/** Whether `b` is a budget a resolve can charge: an object with a writable number `left`. */
function usable(b) {
    if (!b || typeof b !== 'object')
        return false;
    const d = Object.getOwnPropertyDescriptor(b, 'left');
    return !!d && d.writable === true && typeof d.value === 'number';
}
function pubkeyOf(target) {
    return parseAddress(target)?.pubkey ?? null;
}
/**
 * The table `s` carries (§1.10), as a reader uses it: only keys under `author`,
 * the pubkey of the event it travels in (a key under any other pubkey is
 * ignored and its address fetched). Null, an author nobody knows, honours no
 * key at all: never every key. Never refuses: a table that is not one reads
 * as empty. The values are unchecked payloads.
 */
export function carriedTable(s, author) {
    const t = s.objects;
    if (!author || !t || typeof t !== 'object' || Array.isArray(t))
        return {};
    // Not copied: read only, and resolved once per draw.
    return Object.fromEntries(Object.entries(t).filter(([k, v]) => {
        const a = v === undefined ? null : parseAddress(k);
        return a !== null && a.kind === 33331 && a.pubkey === author;
    }));
}
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
export function withAuthor(model, pubkey) {
    const kept = model.objects ? carriedTable(model, pubkey) : null;
    const sameTable = !model.objects || Object.keys(kept ?? {}).length === Object.keys(model.objects).length;
    if (sameTable && (model.author ?? null) === pubkey)
        return model;
    const { objects: _all, author: _was, ...bare } = model;
    return { ...bare, ...(pubkey ? { author: pubkey } : {}), ...(kept && Object.keys(kept).length ? { objects: kept } : {}) };
}
/**
 * One entry of a table read as a model, checked by §1.9 on its own, with any
 * `objects` of its own ignored (a table is flat), and with the id
 * `a:<address>`, the reference's key, as a fetched object has. Undefined when the table does
 * not hold `address`, null when it holds a bad entry, which is a placeholder
 * for each placement naming it and is still not fetched.
 */
export function carriedModel(table, address, read = fromPayload) {
    if (!Object.prototype.hasOwnProperty.call(table, address))
        return undefined;
    const entry = table[address];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        return null;
    // Read under the reference's key, as a fetched object is, so a model has the
    // same id whichever way it came; and from the same object every time for the
    // same entry (flatOf), so a reader that keeps models by payload (`read`)
    // finds the one it made.
    return read(flatOf(entry), `a:${address}`);
}
/** An entry without a table of its own (a table is flat), the same object for the same entry. */
const flats = new WeakMap();
function flatOf(entry) {
    if (!('objects' in entry))
        return entry;
    let flat = flats.get(entry);
    if (!flat) {
        const { objects: _nested, ...rest } = entry;
        flats.set(entry, (flat = rest));
    }
    return flat;
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
export async function resolveParts(model, fetch, options) {
    const opts = Array.isArray(options) ? { self: options } : options ?? {};
    const self = opts.self;
    const author = opts.author !== undefined ? opts.author : model.author ?? (self && self[0] === 'a' ? pubkeyOf(self[1]) : null);
    const read = opts.read ?? fromPayload;
    const root = carriedTable(model, author);
    // A budget this resolve cannot write (frozen, or `left` not a writable
    // number) is read once, as a budget of its own: it is not shared, but the
    // resolve does not throw.
    const given = opts.budget ?? { left: MAX_PLACED };
    const budget = usable(given) ? given : { left: Number(given?.left) || 0 };
    // Distinct objects read, fetched or parsed from a table (MAX_MODELS): each
    // charged to its placement's budget's reads and to the resolve's.
    const overall = usable(opts.models) ? opts.models : { left: 2 * MAX_MODELS };
    const ownReads = new Map();
    const readsOf = (b) => {
        if (usable(b.models))
            return b.models;
        let r = ownReads.get(b);
        if (!r) {
            r = { left: MAX_MODELS };
            ownReads.set(b, r);
        }
        return r;
    };
    /** Whether one more object may be read on `charged`'s account; if so, it is charged. */
    const mayRead = (charged) => {
        const mine = readsOf(charged);
        if (mine.left < 1 || overall.left < 1)
            return false;
        mine.left--;
        overall.left--;
        return true;
    };
    const fetched = new Map();
    const load = (ref, charged) => {
        const key = refKey(ref);
        let got = fetched.get(key);
        if (!got) {
            if (!mayRead(charged))
                return 'objects';
            got = fetch(ref).then((answer) => {
                const payload = answer instanceof Fetched ? answer.payload : answer;
                const m = payload == null ? null : read(payload, key);
                if (!m)
                    return payload == null ? 'unreachable' : 'invalid';
                // The fetched object's own table, keys only under its own pubkey:
                // the address's for an `a`, the event's (if the fetch said) for an `e`.
                const pk = ref[0] === 'a' ? pubkeyOf(ref[1]) : answer instanceof Fetched ? answer.pubkey : null;
                return pk ? { model: m, table: carriedTable(m, pk) } : { model: m };
            }, () => 'unreachable');
            fetched.set(key, got);
        }
        return got;
    };
    // One parse per entry per table, however often it is placed.
    const parsed = new Map();
    const fromTable = (table, address, charged) => {
        let seen = parsed.get(table);
        if (!seen) {
            seen = new Map();
            parsed.set(table, seen);
        }
        if (seen.has(address))
            return seen.get(address);
        if (!Object.prototype.hasOwnProperty.call(table, address))
            return undefined;
        if (!mayRead(charged))
            return 'objects';
        const got = carriedModel(table, address, read);
        if (got !== undefined)
            seen.set(address, got);
        return got;
    };
    const budgetFor = opts.budgetFor;
    // With budgetFor: the placements taken (MAX_NODES), and apart from them the
    // placeholders for spent budgets (MAX_NODES more), so a flood of one share's
    // placeholders never stops another share's placements.
    const ceiling = { left: MAX_NODES };
    const marks = { left: MAX_NODES };
    const authors = new Map();
    const authorOf = (ref) => {
        if (!ref || ref[0] !== 'a')
            return null;
        if (!authors.has(ref[1]))
            authors.set(ref[1], pubkeyOf(ref[1]));
        return authors.get(ref[1]) ?? null;
    };
    // Asked once per author and parent budget for the whole resolve, so the
    // same author under the same parent is always charged to the same budget.
    const charges = new Map();
    const chargeTo = (ref, paid) => {
        const author = authorOf(ref);
        let byAuthor = charges.get(paid);
        if (!byAuthor) {
            byAuthor = new Map();
            charges.set(paid, byAuthor);
        }
        let charged = byAuthor.get(author);
        if (!charged) {
            let b;
            try {
                b = budgetFor(author, paid);
            }
            catch {
                b = paid;
            }
            charged = usable(b) ? b : paid;
            byAuthor.set(author, charged);
        }
        return charged;
    };
    /** What a whole placement of a budget may still draw: a `left` under 1 (or not a number) is spent. */
    const room = (b) => (b.left >= 1 ? Math.floor(b.left) : 0);
    const plans = new Map();
    const planOf = (m, paid) => {
        let byPaid = plans.get(m);
        if (!byPaid) {
            byPaid = new Map();
            plans.set(m, byPaid);
        }
        let plan = byPaid.get(paid);
        if (!plan) {
            const refs = m.refs ?? [];
            const perRef = new Map();
            const groups = new Map();
            (m.parts ?? []).forEach((part, i) => {
                let b = perRef.get(part.ref);
                if (!b) {
                    b = chargeTo(refs[part.ref], paid);
                    perRef.set(part.ref, b);
                }
                let g = groups.get(b);
                if (!g) {
                    g = [];
                    groups.set(b, g);
                }
                g.push(i);
            });
            plan = [...groups].map(([budget, parts]) => ({ budget, parts }));
            byPaid.set(paid, plan);
        }
        return plan;
    };
    /**
     * As if each placement were taken in order: drawn while the ceiling and its
     * budget have room, one placeholder per budget at its first placement that
     * does not fit (charged to `marks`, never to the ceiling), and once the
     * ceiling is spent one placeholder for the rest.
     * The work is what is returned, not every placement: each group gives only
     * the placements its budget has room for and the one after.
     */
    const choose = (m, paid) => {
        const all = m.parts ?? [];
        if (!all.length)
            return { taken: [], cut: [] };
        if (ceiling.left < 1)
            return { taken: [], cut: [all[0]] };
        const plan = planOf(m, paid);
        const taken = [];
        const cut = [];
        // A placeholder is charged to `marks`; once those are spent, this object
        // still shows one, uncharged, so a reader always knows it was cut.
        let spare = true;
        const mark = (i) => {
            if (marks.left >= 1) {
                marks.left--;
                cut.push(all[i]);
            }
            else if (spare) {
                spare = false;
                cut.push(all[i]);
            }
        };
        const events = [];
        plan.forEach(({ budget: b, parts }, g) => {
            const k = Math.min(room(b), parts.length);
            for (let i = 0; i < k; i++)
                events.push([parts[i], g, true]);
            if (k < parts.length)
                events.push([parts[k], g, false]);
        });
        events.sort((x, y) => x[0] - y[0]);
        for (const [i, g, draw] of events) {
            if (!draw) {
                mark(i);
                continue;
            }
            if (ceiling.left < 1) {
                mark(i);
                break;
            }
            ceiling.left--;
            const b = plan[g].budget;
            b.left--;
            taken.push({ part: all[i], charged: b });
        }
        return { taken, cut };
    };
    /** `own` is the table of the event `m` travels in, when that is not the root's; `paid` is the budget `m`'s own placement was charged to. */
    const walk = async (m, depth, chain, own, paid) => {
        const refs = m.refs ?? [];
        const all = m.parts ?? [];
        // Every placement counts toward a budget, a placeholder too, before
        // anything else is decided: a loop or a level past the depth bound is
        // drawn, so it is paid for. Counted here, synchronously, for the whole
        // level at once, so nothing below can start before its share is taken.
        // Each to the budget budgetFor names (or `budget`), and once a budget is
        // spent, what is left of this object's placements on it is one
        // placeholder, not one each: a reader never maps more than it draws.
        let taken;
        let cut;
        if (!budgetFor) {
            const first = all.slice(0, Math.max(0, budget.left));
            budget.left -= first.length;
            taken = first.map((part) => ({ part, charged: budget }));
            cut = first.length < all.length ? [all[first.length]] : [];
        }
        else
            ({ taken, cut } = choose(m, paid));
        const over = (part) => ({ part, ref: refs[part.ref], model: null, missing: 'budget', children: [] });
        const drawn = await Promise.all(taken.map(async ({ part, charged }) => {
            const ref = refs[part.ref];
            const key = refKey(ref);
            if (chain.has(key))
                return { part, ref, model: null, missing: 'cycle', children: [] };
            if (depth > MAX_PART_DEPTH)
                return { part, ref, model: null, missing: 'deep', children: [] };
            let got;
            // The table of the event the placed object travels in, for its own placements.
            let table;
            if (ref[0] === 'a') {
                const inRoot = fromTable(root, ref[1], charged);
                const found = inRoot === undefined && own ? fromTable(own, ref[1], charged) : inRoot;
                if (found === 'objects')
                    return { part, ref, model: null, missing: 'objects', children: [] };
                got = found;
                if (inRoot === undefined && own)
                    table = own;
            }
            const carried = got !== undefined;
            if (got === undefined) {
                const loading = load(ref, charged);
                if (loading === 'objects')
                    return { part, ref, model: null, missing: 'objects', children: [] };
                const answer = await loading;
                if (typeof answer === 'string')
                    return { part, ref, model: null, missing: answer, children: [] };
                got = answer.model;
                table = answer.table;
            }
            const mark = carried ? { carried: true } : {};
            if (got === null)
                return { part, ref, model: null, missing: 'invalid', ...mark, children: [] };
            if (got.unit + part.step < 0 || got.unit + part.step > MAX_UNIT)
                return { part, ref, model: null, missing: 'scale', ...mark, children: [] };
            const children = got.parts ? await walk(got, depth + 1, new Set([...chain, key]), table, charged) : [];
            return { part, ref, model: got, ...mark, children };
        }));
        return cut.length ? [...drawn, ...cut.map(over)] : drawn;
    };
    return walk(model, 1, new Set(self ? [refKey(self)] : []), undefined, budget);
}
/**
 * The payload an object is carried as in a table: its own payload with its own
 * `objects` taken off, because a table is flat (§1.10).
 */
export function carriedPayload(object) {
    const { objects: _nested, ...flat } = toPayload(object);
    return flat;
}
/**
 * `root` carrying `object` under `address` (§1.10), replacing any entry there.
 * A writer flattens: whatever `object` carries itself goes into `root`'s table
 * too, under keys the table does not already hold (the root's table is looked
 * in first, so an entry it holds already is the one that is drawn), and only
 * keys under the pubkey `address` names, the writer's own (a publisher MUST
 * write no other). `address` is not checked against `root`'s refs here.
 */
export function carryObject(root, address, object) {
    const table = { ...(root.objects ?? {}) };
    const writer = pubkeyOf(address);
    for (const [k, v] of Object.entries(readObjects(object.objects) ?? {})) {
        if (!Object.prototype.hasOwnProperty.call(table, k) && k !== address && pubkeyOf(k) === writer)
            table[k] = v;
    }
    table[address] = carriedPayload(object);
    return { ...root, objects: Object.fromEntries(Object.entries(table)) };
}
/** `root` without the entry for `address`; the table goes when it is empty. */
export function uncarry(root, address) {
    if (!root.objects || !Object.prototype.hasOwnProperty.call(root.objects, address))
        return root;
    const rest = Object.entries(root.objects).filter(([k]) => k !== address);
    const { objects: _gone, ...bare } = root;
    return rest.length ? { ...bare, objects: Object.fromEntries(rest) } : bare;
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
export function carryAll(root, lookup, options = {}) {
    let out = root;
    // The shallowest depth each address was walked at, and what it was walked as.
    const shallowest = new Map();
    const walked = new Map();
    const visit = (m, depth, chain) => {
        if (depth > MAX_PART_DEPTH)
            return;
        const used = new Set((m.parts ?? []).map((p) => p.ref));
        for (const [i, ref] of (m.refs ?? []).entries()) {
            if (!used.has(i) || ref[0] !== 'a' || chain.has(ref[1]))
                continue;
            const before = shallowest.get(ref[1]);
            if (before !== undefined && before <= depth)
                continue;
            shallowest.set(ref[1], depth);
            let next = walked.get(ref[1]);
            if (next === undefined) {
                // Asked once per address, however often it is met.
                const held = out.objects ? carriedModel(out.objects, ref[1]) : undefined;
                next = held ?? null;
                if (held === undefined) {
                    const choice = lookup(ref);
                    if (choice?.carry)
                        out = carryObject(out, ref[1], choice.object);
                    next = choice ? choice.object : null;
                }
                walked.set(ref[1], next);
            }
            if (next)
                visit(next, depth + 1, new Set([...chain, ref[1]]));
        }
    };
    visit(root, 1, new Set());
    if (options.prune)
        for (const k of Object.keys(out.objects ?? {}))
            if (!shallowest.has(k))
                out = uncarry(out, k);
    return out;
}
/** Cosine and sine of whole degrees, exact at the quarter turns so a 90 keeps a part on the lattice. */
function cs(deg) {
    const d = ((deg % 360) + 360) % 360;
    if (d === 0)
        return [1, 0];
    if (d === 90)
        return [0, 1];
    if (d === 180)
        return [-1, 0];
    if (d === 270)
        return [0, -1];
    const r = (d * Math.PI) / 180;
    return [Math.cos(r), Math.sin(r)];
}
/**
 * The rotation a turn names: about X, then Y, then Z, all fixed axes, so
 * Rz Ry Rx. The same formula serves the wire's frame and the model's,
 * because mirroring each factor through Z is exactly mirrorTurn.
 */
export function turnMatrix(t) {
    const [ca, sa] = cs(t[0]), [cb, sb] = cs(t[1]), [cc, sc] = cs(t[2]);
    const rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
    const ry = [cb, 0, sb, 0, 1, 0, -sb, 0, cb];
    const rz = [cc, -sc, 0, sc, cc, 0, 0, 0, 1];
    return mul(rz, mul(ry, rx));
}
/** Whole degrees 0..359. */
const whole = (rad) => ((Math.round((rad * 180) / Math.PI) % 360) + 360) % 360;
/**
 * The turn a rotation matrix is, back in whole degrees about X, then Y, then
 * Z. At a quarter turn about Y, X and Z turn about the same line and only
 * their sum is fixed, so the Z turn is taken as 0 there.
 */
export function turnFromMatrix(r) {
    const sy = -r[6];
    if (Math.abs(sy) < 1 - 1e-9)
        return [whole(Math.atan2(r[7], r[8])), whole(Math.asin(sy)), whole(Math.atan2(r[3], r[0]))];
    return sy > 0 ? [whole(Math.atan2(r[1], r[4])), 90, 0] : [whole(Math.atan2(-r[1], r[4])), 270, 0];
}
/** Row-major 3x3 product. */
function mul(a, b) {
    const o = new Array(9).fill(0);
    for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++)
            for (let k = 0; k < 3; k++)
                o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return o;
}
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
export function partMatrix(part, parentUnit, placedUnit) {
    const r = turnMatrix(mirrorTurn(part.turn));
    const s = 2 ** (placedUnit + part.step - parentUnit);
    const [tx, ty, tz] = toRender(part.at);
    return [
        r[0] * s, r[3] * s, r[6] * s, 0,
        r[1] * s, r[4] * s, r[7] * s, 0,
        r[2] * s, r[5] * s, r[8] * s, 0,
        tx, ty, tz, 1,
    ];
}
/**
 * A placement turned a quarter about a pivot, the way the workshop's TURN
 * turns points: in the plane of axes `a` and `b`, taking `a` toward `b`.
 * Its origin swings about the pivot exactly as a vertex would, and its own
 * turn takes the same quarter, so a placed object turns with the points
 * around it. Model frame in, model frame out. Null when the origin would
 * leave the 64-unit bound.
 */
export function quarterTurnPart(part, a, b, pivot) {
    const at = [...part.at];
    const da = part.at[a] - pivot[0], db = part.at[b] - pivot[1];
    at[a] = pivot[0] - db;
    at[b] = pivot[1] + da;
    if (at.some((n) => n < -PART_REACH || n > PART_REACH))
        return null;
    // Q takes the a axis to the b axis and the b axis to minus a.
    const q = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    q[a * 3 + a] = 0;
    q[b * 3 + b] = 0;
    q[b * 3 + a] = 1;
    q[a * 3 + b] = -1;
    return { ...part, at, turn: turnFromMatrix(mul(q, turnMatrix(part.turn))) };
}
/**
 * The object with one more placement, naming `ref`. A reference already in
 * `refs` is reused rather than repeated (§1.10: refs names each object once).
 * Returns the new placement's index too.
 */
export function addPart(s, ref, place) {
    const refs = [...(s.refs ?? [])];
    let i = refs.findIndex((r) => refKey(r) === refKey(ref));
    if (i < 0) {
        i = refs.length;
        refs.push(ref);
    }
    const parts = [...(s.parts ?? []), { ...place, ref: i }];
    return { shard: { ...s, refs, parts }, index: parts.length - 1 };
}
/** Whether a raw payload places anything by `e`, which is always fetched. */
function placesByEvent(raw) {
    const refs = raw && typeof raw === 'object' ? raw.refs : undefined;
    return Array.isArray(refs) && refs.some((r) => Array.isArray(r) && r[0] === 'e');
}
/**
 * The object without the placements at `indices`; references no placement uses
 * any more go, and the rest renumber. A carried object (§1.10) whose reference
 * goes goes with it, unless something left can still reach it: another entry
 * of the table, or any placement that is fetched, since what a fetched object
 * places is looked up in this table too and cannot be seen from here.
 */
export function removeParts(s, indices) {
    const gone = new Set(indices);
    const kept = (s.parts ?? []).filter((_, i) => !gone.has(i));
    const used = [...new Set(kept.map((p) => p.ref))].sort((x, y) => x - y);
    const renumber = new Map(used.map((old, k) => [old, k]));
    const refs = used.map((i) => (s.refs ?? [])[i]);
    const parts = kept.map((p) => ({ ...p, ref: renumber.get(p.ref) }));
    const { refs: _r, parts: _p, ...rest } = s;
    let out = parts.length ? { ...rest, refs, parts } : rest;
    const table = out.objects;
    if (table) {
        // What the table reaches from some addresses, following its own entries.
        const reach = (from) => {
            const seen = new Set();
            const queue = [...from];
            while (queue.length) {
                const a = queue.pop();
                if (seen.has(a))
                    continue;
                seen.add(a);
                if (Object.prototype.hasOwnProperty.call(table, a))
                    queue.push(...addressesIn(table[a]));
            }
            return seen;
        };
        const addresses = (rs) => rs.filter((r) => r[0] === 'a').map((r) => r[1]);
        const still = reach(addresses(refs));
        // A placement still standing that is fetched (an `e`, or an `a` the table
        // does not hold) may place anything, beneath it where this cannot see, and
        // the root's table answers there too: then nothing is dropped.
        const fetchedStill = refs.some((r) => r[0] === 'e') ||
            [...still].some((a) => !Object.prototype.hasOwnProperty.call(table, a)) ||
            [...still].some((a) => Object.prototype.hasOwnProperty.call(table, a) && placesByEvent(table[a]));
        // Only what the removed placements reached, and only when every placement
        // left is one this can see into.
        if (!fetchedStill)
            for (const a of reach(addresses(s.refs ?? [])))
                if (!still.has(a))
                    out = uncarry(out, a);
    }
    return out;
}
/**
 * What the object occupies once its parts are placed: its own vertices, each
 * placed object's bounds carried through its placement, and a placeholder's
 * unit cube, centred on where it stands. What a preview frames and what a
 * parent's extent grows to hold (§1.10). Null for nothing at all.
 */
export function placedBounds(s, placed) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const take = (p) => { for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
    } };
    for (const v of s.vertices)
        take(toRender(ticksOf(v)));
    for (const p of placed) {
        const inner = p.model ? placedBounds(p.model, p.children) : { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
        if (!inner)
            continue;
        const m = partMatrix(p.part, s.unit, p.model ? p.model.unit : s.unit);
        for (const x of [inner.min[0], inner.max[0]])
            for (const y of [inner.min[1], inner.max[1]])
                for (const z of [inner.min[2], inner.max[2]]) {
                    take([0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]));
                }
    }
    return min[0] === Infinity ? null : { min, max };
}
//# sourceMappingURL=parts.js.map