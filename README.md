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

## What is in it

| Module | What it is |
| --- | --- |
| `shards` | The model, the wire payload ([DECK-0003](https://github.com/arkin0x/cyberspace/blob/master/decks/DECK-0003-sno.md) §1), tick packing, face colors, validation |
| `snoPalette` | The 256-color built-in, palette parsing (events and pasted text), index lookup, remapping |
| `stamps` | The seven stamps, their geometry, the cull between two that touch |
| `triangulate` | Ear clipping and the Newell normal |
| `orient` | The outward guess: winding a mesh outward, and finding the faces buried inside a join |
| `winding` | Setting a face's front, which readers obey (DECK-0003 §1.4): FLIP FACE, FLIP SURFACE, AUTO, and new faces wound as they are made |
| `outline` | The edges of a set of faces |
| `clip` | Cutting a mesh to a box, and the color interpolated across the cut |
| `hsv` | Hue, saturation and brightness |
| `scale` | A gibson count as a human distance, and the size of a cell |
| `pose` | The two pose operations the format owns: `wrapSpin` and `applyPose` |

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

## Consuming it from an app

A git dependency pinned to a tag:

```json
"sno-core": "git+https://github.com/arkin0x/sno-core.git#v0.1.2"
```

`npm` records the resolved commit in the lockfile, so `npm ci` installs exactly
what was reviewed even if the tag is later moved. `prepare` builds `dist` at
install time, which is why `typescript` is a runtime dependency rather than a
dev one: npm installs a git dependency's `dependencies`, and `prepare` has to be
able to run.

Nothing is published to npm. The two consumers are known, the package is public,
and a registry release is a second place to get the version wrong.

## Working on it

```
npm install
npm run typecheck
npm test
npm run build
```

A change here reaches a client when that client's `package.json` moves to a new
tag and its lockfile is updated. Tag from `main` once the tests pass.
