# sno-core

The SNO shard format and the geometry around it, as one copy.

`snocrash` and `ONOSENDAI` are two clients for the same objects. They were
forked by copy-paste, and for a while each carried its own hand-typed copy of
these files. That is not a style problem. A block's top face was listed the
wrong way round in one copy and not the other, so the same object drew solid in
one client and inside out in the other, and the fix reached one repo and stayed
there for a week. This package is where that class of bug goes to stop.

## The format it implements

SNO is specified in [DECK-0003](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0003-sno.md),
a deck of the [Cyberspace protocol](https://github.com/arkin0x/cyberspace). A
standalone SNO is event kind `33331`, addressable, one per author per `d` tag.
The deck ships a dependency-free reference validator,
[`sno-reference.py`](https://github.com/arkin0x/cyberspace/blob/master/decks/sno-reference.py),
which is the arbiter when this package and the spec disagree.

Section numbers in the comments here refer to that deck.

**Fields it does not know are carried, not dropped.** `fromPayload` keeps any
payload field this version does not read in `ShardModel.extra`, and
`toPayload` writes it back after the fields it computes, which it never lets a
carried copy replace. So an app on an older sno-core can open an object a newer
version of the format wrote, edit it and publish it again without stripping
what it did not understand. (DECK-0003 §5 has readers ignore unknown fields;
carrying them through an edit is this package's choice on top of that.) The
legacy `type` field is the one exception: it is dropped, as §1.1a asks. When a
later version learns a field, `normalizeStored` lifts it out of `extra` for
models saved before, so call it on every model you load from storage. A copy
that should carry the shape alone drops `extra`.

**Opacity.** `ShardModel.opacity` is the payload's `opacity`, a whole percent 1
to 99 (absent or 100 is fully opaque, and is never written). A malformed value
reads as opaque rather than refusing the object. `drawnOpacity(model)` is what a
renderer multiplies by: the percent as a fraction, never below
`OPACITY_FLOOR` (10%). A placed object uses its own, never its parent's, and an
avatar ignores it (DECK-0003 §1.11).

**Carried objects.** `ShardModel.objects` is the payload's `objects`
(DECK-0003 §1.10): the payloads of placed objects that travel inside the
object that places them instead of as events of their own, keyed by the
address their `a` reference names, held exactly as they came. A table that is
not one reads as absent, and a bad entry never refuses its parent: it is a
placeholder for its own placements.

Only keys under the pubkey of the event a table travels in count, and **a
reader that does not know that pubkey honours none**. Say whose it is with
`withAuthor(model, pubkey)` where the model is read from its event (it sets the
local-only `ShardModel.author`, never written, and drops every other key; for
an unsigned item in a bag, pass the bag's signer), or with `{ author }` to
`resolveParts`. `objectFromEvent` (the feed) does it for you.

`resolveParts` looks each placement up in the table of the object being drawn
first, at every depth, then in the table of the event the placing object came
in (an `a` fetch: the address's pubkey; an `e` fetch: the pubkey your fetch
returns in a `Fetched`, else none), and fetches only what neither holds. It
draws at most `MAX_PLACED` (20,000) placements per call; the rest are
placeholders (`missing: 'budget'`). A client that spends one share on its own objects and another on strangers' passes `budgetFor(author, parent)`, which must be sticky (under a placement on the strangers' share, every placement and read stays on it) and picks the budget each placement is charged to from the author of the object it places and the budget its parent was charged to; a level cut short has one placeholder per budget it ran out of. It is asked once per author and parent budget for the whole resolve, so its budgets should be a small fixed set (one per share); however many it names, one resolve draws at most `MAX_NODES` (40,000) placements, and its placeholders for spent budgets are counted apart (`MAX_NODES` more, then one per object drawn), so one share's cuts never stop another share's placements. Each distinct object read (fetched, or parsed from a table) is charged to its placement's budget: to the budget's own `models: { left }` when it has one (shared as the budget is), else to `MAX_MODELS` (1,000) of the resolve's own for that budget, and to the resolve's `models` (2 x `MAX_MODELS` when left out, enough for two shares; a backstop, so pass one at least the sum of your shares' reads); past either, a placement of an object not yet read is a placeholder (`missing: 'objects'`), and nothing more is fetched. So a stranger's objects spend the strangers' reads, never yours.

Writers: `carryObject` adds one, flattened into the one table with only the
writer's own keys; `carryAll` carries what a lookup chooses at any depth,
walking an address again when it is met nearer the top (and, with `prune`,
drops what nothing reached); `uncarry` removes one; `removeParts` drops a
carried object with the last placement that reaches it, and keeps everything
while any fetched placement is left, since what a fetched object places is
looked up in the table too. `toPayload` writes the table flat, keys in code
point order, and omits it when empty.

## What is in it

| Module | What it is |
| --- | --- |
| `shards` | The model, the wire payload ([DECK-0003](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0003-sno.md) §1), tick packing, face colors, validation |
| `snoPalette` | The 256-color built-in, palette parsing (events and pasted text), index lookup, remapping |
| `stamps` | The seven stamps, their geometry, the cull between two that touch |
| `triangulate` | Ear clipping and the Newell normal |
| `orient` | The outward guess: winding a mesh outward (it never says which faces to draw: a reader draws them all) |
| `winding` | Setting a face's front, which readers obey (DECK-0003 §1.4): FLIP FACE, FLIP SURFACE, AUTO, and new faces wound as they are made |
| `outline` | The edges of a set of faces |
| `fingerprint` | An object's shape as canonical text, one letter-only token per triangle, for a similarity fingerprint such as Fanfares' `X` tag: the same under vertex and face order, winding, translation and recoloring, different under rotation, scale and mirroring |
| `parts` | One object placing others (DECK-0003 §1.10): resolving placements through a client's fetch, with the depth, loop and placeholder rules, and where each one stands |
| `clip` | Cutting a mesh to a box, and the color interpolated across the cut |
| `hsv` | Hue, saturation and brightness |
| `scale` | A gibson count as a human distance, and the size of a cell |
| `pose` | The two pose operations the format owns: `wrapSpin` and `applyPose` |
| `importFile` | A 3D file picked by a person as a shard: PLY, STL, OBJ with its MTL, glTF or GLB, MagicaVoxel VOX. Format detection, size and time caps, and the request and answer a client's Web Worker passes |
| `meshToShard` | Any mesh as an ordinary shard: fitted to the grid, quantized onto the lattice and welded, cleaned of faces with no area, colors snapped to the palette, and simplified by vertex clustering until the payload fits the byte budget |
| `mesh`, `ply`, `stl`, `obj`, `gltf`, `vox` | The mesh every importer produces, the untrusted-input rules they share, and one pure parser per format. No dependencies and no network: a glTF buffer is read from the file, a data URI, or a file picked with it, never fetched |
| `seeds` | Seeds ([DECK-0008](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0008-seeds.md)): SEEDO parsing with every validity rule, terroir, the clock and the planted-height clamp, growing a bloom to a SNO payload and its hash, mixing, and the price of caps. A port of the DECK's reference interpreter, run against every section of its vectors (below) |
| `feed` | Published objects read from relays (the Shard Feed): the filter (never a tag filter), each relay read on its own with deadlines, newest per address, paging each relay to its own end, objects for sale (`listingFromEvent`: an encrypted 33331 whose `encrypted` element [3] is an `https:` NIP-FF-1 key service, any seller's, with one price in `SATS` and a short printable `d`, carried as `listings` with its title, price and preview pictures, never as geometry; one hidden at a place, `cyberspace:region`, is still left out), where a listing is bought (`sellerLink`: the seller's NIP-89 handler page when it lists kind 33331, else a known key service's app, else njump, with the link's own domain), and the proposed credit tag for a copy. Networking is the client's, passed in |

## What is deliberately not in it

**The bench and the shell.** Both clients draw objects and both have a
workshop, but ONOSENDAI's has DEPLOY, avatar mining and a Cyberspace scale
ladder while snocrash's has PUBLISH and a relay panel. Sharing the shell would
mean sharing every decision either client has yet to make.

**`benchAxes`.** The two clients name their axes in different frames: snocrash
in the published glTF frame, ONOSENDAI in the Cyberspace frame. That is a
semantic difference and it cannot be resolved by moving a file.

**Everything about a planet.** `pose` here is arithmetic. Building a frame from
a latitude, reading a bearing back, folding a view frame in: that is a statement
about the Earth and about Cyberspace axes, and it lives in the client that has
them.

## Using it

```ts
import { flatten, toPayload, type ShardModel } from 'sno-core/shards'
import { BUILT_IN, hexAt } from 'sno-core/snoPalette'
```

Every module is its own entry point, so an import still says which module a name
came from. `sno-core` on its own is a barrel over all of them.

The package ships ES modules with the extensions Node needs on every relative
specifier, and imports the palette JSON with an import attribute, so `dist`
loads under plain Node as well as under a bundler. That matters because a
consumer's test run does not bundle its dependencies: vitest externalizes
node_modules and hands them to Node.

## Seeds, for client authors

`sno-core/seeds` is the one implementation of DECK-0008 the clients share, so
that every reader grows the same bloom. It has no DOM and no network: block
hashes and header times are functions you pass in. Grow blooms in a Web Worker
(§12, Compute); the module runs there unchanged, Safari before 16.4 included
(it uses no regular-expression lookbehind).

**Across the worker boundary, post the DNA's text and parse it in the worker.**
A parsed `Dna` holds compiled functions and cannot be cloned. `tryGrowBloom`
takes the text and returns `{ ok: false, error }` instead of throwing. A mixed
child's computed text can pass 8,192 bytes; a cached one is read back with
`parseChildText`, not `parseDna`.

```ts
import {
  parseDna, capsFromTags, readSeed, capsPrice, effectivePlantedHeight, growBloom, clockHeight,
} from 'sno-core/seeds'

const dna = parseDna(dnaEvent.content)            // throws SeedoError: a seed of it cannot grow
const caps = capsFromTags(dnaEvent.tags)          // null: the DNA is invalid
const read = readSeed(seedEvent)                  // the §8.2 checks, before you fetch the DNA
if (!read.ok || caps === null || read.seed.target < capsPrice(caps)!) return

const clock = clockHeight(tipHeight)              // the tip minus 6
const p = effectivePlantedHeight(read.seed.planted, seedEvent.created_at, clock, headerTime)
if (p.state === 'cannot-grow') return
const bloom = growBloom(dna, {
  coord: read.seed.coord,
  planted: p.state === 'settled' ? p.height : null, // null draws generation 0
  scale: read.seed.scale,
  caps,
}, clock, blockHash)
// bloom.sno is a ShardPayload: draw it as a shard standing at the seed's C (§5.6)
```

- `blockHash(height)` returns 64 hex in the order block explorers display it.
  When it returns nothing for a driving block, the bloom is drawn at the last
  generation it could compute, with `behind: true` and `missingBlock` (§4.1).
  A bloom that is behind is still drawn at the clock's age, so every symbol of
  the generations it reached is fully grown; only the later rewrites are
  missing.
- `headerTime(height)` returns the header's `time` field. A missing header
  leaves the planted height `pending`, never stepped over (§4.2).
- A generation changes once a day of blocks. Cache `growSymbols(...)` per
  generation and call `drawBloom(...)` each block; together they are
  `growBloom`. When the clock moves on, `growSymbols(..., { from: cached })`
  continues from the cached generation.
- On a phone, bound each call: `{ maxSteps }` stops before a generation that
  would pass the budget (every call still grows at least one), and
  `{ signal }` stops at the next generation once aborted. Either returns a
  partial result with `stopped` set; resume with `{ from }`.
  `worstCaseSteps(caps)` is the most a DNA's caps allow (generations times
  symbols), for deciding what to grow at all.
- `drawBloom(..., { json: false })` skips the payload's JSON and SHA-256 (a
  stringify and a hash of up to megabytes); `{ buffers: true }` adds the
  geometry as typed arrays, posted with `bloomTransferList(buffers)` as the
  transfer list.
- Mixing: `readMixedDna` checks a mixed DNA's tags and work (§8.1);
  `mixSchedule` says when it resolves (the anchor checked against your
  `blockHash`, as §6.2 requires, settling, the 36-block delay, depth, parents
  resolved first); `mixWord(outcome
  hash, commit id)` and `mixDna(mother, father, word, { name, hybrid })` give
  the child and its exact text. A preview may pass any 32-bit word (§6.8).
- Errors in a DNA's text are `SeedoError`, with the reference interpreter's
  messages; `tryParseDna` returns them instead of throwing.

The vectors are vendored in `src/seeds/fixtures/` with the spec commit they
came from. A test checks the copy against `../cyberspace` (or
`CYBERSPACE_SPEC_DIR`) whenever a checkout is there (`npm run
check:seeds-vectors`). `npm run bench:seeds`, after `npm run build:dist`,
times growth, and the reference beside it when the checkout is there.

Where the DECK and its reference interpreter disagree, this follows the DECK:
a comment is removed from its first `#` whatever follows it, a CR, U+2028 or
U+2029 included (§3.1); a mixed child's computed text is not held to 8,192 bytes
(§3.1); every name, `__proto__` included, is an ordinary name; and a missing
block or header is reported rather than thrown (§4.1, §4.2). No vector reaches
any of these.

SHA-256 comes from `@noble/hashes`, the package's one runtime dependency,
which the clients already carry through nostr-tools. It is synchronous, which
growth needs, and runs in browsers and workers.

## Consuming it from an app

A git dependency pinned to a tag:

```json
"sno-core": "git+https://github.com/arkin0x/sno-core.git#v0.1.2"
```

`npm` records the resolved commit in the lockfile, so `npm ci` installs exactly
what was reviewed even if the tag is later moved. `dist` is committed, so the
install builds nothing: npm runs a full install of a git dependency
(devDependencies and all) and its `prepare` only when its package.json has a
`build`, `prepare`, `prepack`, `install`, `preinstall` or `postinstall` script,
and this one has none of them (the build is `build:dist`). No `tsc`, no
devDependencies; `typescript` is only a devDependency. That also fixes `npm i -g`
of a package that depends on this one from git, whose nested `prepare` could
not find `tsc`.

Nothing is published to npm. The two consumers are known, the package is public,
and a registry release is a second place to get the version wrong.

## Working on it

```
npm install
npm run typecheck
npm test
npm run build:dist   # rewrites dist/ from src/
npm run check:dist   # rebuilds dist/; exits 1 unless the committed dist/ matches
```

`dist/` is committed. Rebuild it and commit it with every change to `src/`;
`check:dist` (and CI) fails when the two disagree. The build is reproducible:
the same `src/` and the same locked `tsc` give the same bytes.

A change here reaches a client when that client's `package.json` moves to a new
tag and its lockfile is updated. Tag from `main` once the tests pass.
