/**
 * feed.ts - published objects, read from relays: the Shard Feed's data layer.
 *
 * Both clients show everyone's published SNO objects (DECK-0003 §3.1, kind
 * 33331), newest first: snocrash on its front page, ONOSENDAI inside the
 * Builder's PLACE OBJECT picker. Each used to read them its own way, and the
 * reliability fixes reached one and not the other. This is the one copy of
 * what a feed read is:
 *
 * - **Which events:** `feedFilter`, kind 33331, optionally one author, paged
 *   with `until`. Never a tag filter: the cyberspace relay (strfry) refuses a
 *   filter with more than three (`too many tags in filter`), and a feed needs
 *   none.
 * - **Reading relays one at a time:** `readEach`. Each relay is prepared
 *   (connected, authenticated) and asked on its own, with a deadline for the
 *   connection and one for the read. Waiting for every relay's handshake
 *   before asking any of them let one hung socket leave the whole feed empty
 *   (snocrash #22, 2026-09-28); here the first relay to answer paints.
 * - **What an object is:** `objectFromEvent`, through `fromPayload`. An
 *   object is addressable, one per author and `d`, so only the newest event
 *   for each address counts, whichever relay sent it and in whatever order.
 * - **Paging:** `createFeed`, a page at a time as the reader scrolls, each
 *   relay followed to its own end so a dense relay cannot make a sparse one
 *   skip events.
 * - **Deletions:** after each page, its authors' kind 5 deletions of what it
 *   brought, by address and by id (one tag filter each), and a deleted
 *   object is not shown (NIP-09, `isDeleted`).
 * - **What a sale listing is:** `listingFromEvent`. A 33331 for sale is
 *   partially encrypted (NIP-FF-1, DECK-0003 §3.4) with a key any seller's
 *   key service sells: its shape is sealed until someone buys the key, and
 *   what is public is a title, a price and a preview picture. The feed
 *   carries those as `listings`, apart from `objects`, because a listing has
 *   no geometry to draw or place. `sellerLink` says where to buy one: the
 *   seller's app through its NIP-89 handler, when the client has fetched it.
 *
 * Like parts.ts, this package does no networking: the client passes in how
 * to subscribe to one relay, and keeps its own pool, auth and relay list.
 * The rules about what to ask and what to do with what comes back are here,
 * so both clients show the same feed.
 *
 * Also here, because both clients write it: the tag that credits the
 * original when an object is copied (`creditTags`, `readCredit`).
 */
import { fromPayload } from './shards.js';
import { withAuthor } from './parts.js';
/** A standalone SNO object (DECK-0003 §3.1). */
export const SNO_KIND = 33331;
/** How many objects a page asks each relay for. */
export const FEED_PAGE = 40;
/**
 * Where published objects are read from by default: the cyberspace relay and
 * the general relays snocrash publishes to. A client adds its own.
 */
export const FEED_RELAYS = [
    'wss://cyberspace.nostr1.com',
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nos.lol',
];
/** How long a relay's read stays open, from when it is asked, if it never says it is finished. */
export const READ_DEADLINE_MS = 6000;
/** How long a relay gets to open its socket before a read goes on without it. */
export const CONNECT_DEADLINE_MS = 3000;
/**
 * How long a relay's auth challenge gets to be answered, on its own clock
 * after the connect. A local key signs at once; an extension or a bunker may
 * be a person approving it, and an auth-gated relay (the cyberspace relay
 * gates reads) skipped for being slow is a feed missing most of its objects.
 */
export const AUTH_DEADLINE_MS = 15000;
/**
 * How many values one deletion filter names, and how many bytes they take in
 * the REQ as sent (JSON, quotes, escapes and commas included, authors too).
 * strfry refuses a filter with more than 200 values in a tag by default, and
 * a REQ larger than the relay's message limit closes the socket; a page of
 * objects stays well inside both, however long their `d` tags are.
 */
export const DELETION_FILTER_VALUES = 100;
export const DELETION_FILTER_BYTES = 16 * 1024;
/**
 * An address longer than this (as sent, in JSON) is never named in a deletion read. An object's
 * `d` has no length bound in the format (a listing's does, 128 bytes), so an
 * address can be any size; one that long is still checked by its event id
 * (the `#e` read), which catches a deletion that names the event, but not one
 * that names only the address.
 */
export const DELETION_ADDRESS_MAX = 1024;
/** How many deletion reads a page runs at once. */
export const DELETION_READS_AT_ONCE = 6;
/**
 * The deletion reads for these objects: by address, and by event id, each in
 * chunks of at most DELETION_FILTER_VALUES values and DELETION_FILTER_BYTES
 * bytes, so no single REQ is large enough for a relay to refuse. Each chunk
 * names only the authors of its own objects.
 */
export function deletionFilters(objects) {
    const filters = [];
    // A pool that verifies events never passes a malformed id or pubkey, but a
    // feed's subscribe need not verify: one that is not 64 hex is left out.
    const sound = objects.filter((o) => HEX64.test(o.id) && HEX64.test(o.pubkey));
    const chunked = (tag, pairs) => {
        const seen = new Set();
        let values = [];
        let authors = new Set();
        let bytes = 0;
        const flush = () => {
            if (values.length === 0)
                return;
            filters.push({ kinds: [5], authors: [...authors], [tag]: values, limit: Math.max(50, values.length * 2) });
            values = [];
            authors = new Set();
            bytes = 0;
        };
        for (const [value, pubkey] of pairs) {
            if (seen.has(value))
                continue;
            seen.add(value);
            // Each value's own bytes, plus its author's when the chunk does not yet name them.
            let cost = jsonBytes(value) + (authors.has(pubkey) ? 0 : jsonBytes(pubkey));
            if (values.length >= DELETION_FILTER_VALUES || (values.length > 0 && bytes + cost > DELETION_FILTER_BYTES)) {
                flush();
                cost = jsonBytes(value) + jsonBytes(pubkey);
            }
            values.push(value);
            authors.add(pubkey);
            bytes += cost;
        }
        flush();
    };
    chunked('#a', sound.filter((o) => jsonBytes(o.address) <= DELETION_ADDRESS_MAX).map((o) => [o.address, o.pubkey]));
    chunked('#e', sound.map((o) => [o.id, o.pubkey]));
    return filters;
}
const HEX64 = /^[0-9a-f]{64}$/;
/** A value's bytes in a REQ: its JSON (quotes and escapes), and the comma after it. */
const jsonBytes = (s) => new TextEncoder().encode(JSON.stringify(s)).length + 1;
/**
 * Whether an author deleted an object (NIP-09): a kind 5 by the object's own
 * author naming its event id, or naming its address at or after the event's
 * time (an address deletion removes every version up to that moment). A
 * deletion by anyone else deletes nothing.
 */
export function isDeleted(o, deletions) {
    return deletions.some((d) => d.kind === 5 && d.pubkey === o.pubkey && d.tags.some((t) => (t[0] === 'e' && t[1] === o.id) || (t[0] === 'a' && t[1] === o.address && d.created_at >= o.createdAt)));
}
/** The filter for one page of the feed. No tag filters, ever (see the header). */
export function feedFilter(opts = {}) {
    const filter = { kinds: [SNO_KIND], limit: opts.limit ?? FEED_PAGE };
    if (opts.authors && opts.authors.length > 0)
        filter.authors = [...opts.authors];
    if (opts.until !== undefined)
        filter.until = opts.until;
    return filter;
}
/** An object's address, `33331:<pubkey>:<d>`. */
export function objectAddress(pubkey, d) {
    return `${SNO_KIND}:${pubkey}:${d}`;
}
/**
 * Whether an event has the shape NIP-01 gives it: `tags` an array of arrays
 * of strings, `content` a string. A relay is meant to refuse anything else,
 * but a signature covers whatever was signed, and one relay that passes a
 * `["title", 5]` along must not throw in a reader. Everything here reads tags
 * as strings, so an event that fails this is not read at all.
 */
export function wellFormed(ev) {
    if (typeof ev.content !== 'string' || !Array.isArray(ev.tags))
        return false;
    for (const t of ev.tags) {
        if (!Array.isArray(t))
            return false;
        for (const x of t)
            if (typeof x !== 'string')
                return false;
    }
    return true;
}
/**
 * An object's `d`, or null when it has none a reader may accept (DECK-0003
 * §3.1): no `d` tag, or an empty one. The first `d` tag is the one that
 * counts, as NIP-01 reads it. A kind 33331 without one is refused, hidden or
 * not, because a relay files every d-less object from one author under the
 * one address `33331:<pubkey>:`, each replacing the last.
 */
export function objectD(ev) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    return typeof d === 'string' && d !== '' ? d : null;
}
/** The object an event carries, or null when it is not one or is malformed. */
export function objectFromEvent(ev) {
    if (ev.kind !== SNO_KIND || !wellFormed(ev))
        return null;
    const d = objectD(ev);
    if (d === null)
        return null;
    // A sealed object's content is a preview, not a payload. Sealed to a place
    // (DECK-0003 §3.4), it is not the feed's to show; sealed for sale, it is a
    // listing (listingFromEvent), with no shape until it is bought.
    if (ev.tags.some((t) => t[0] === 'encrypted'))
        return null;
    let shard = null;
    try {
        shard = fromPayload(JSON.parse(ev.content), `${ev.pubkey}:${d}`);
    }
    catch {
        return null;
    }
    // An object may be nothing but the arrangement of others (§1.9 rule 13).
    if (!shard || (shard.vertices.length === 0 && !shard.parts?.length))
        return null;
    // What it carries counts only under its author's pubkey (DECK-0003 §1.10): a
    // key under anyone else's would draw the publisher's shape as theirs.
    shard = withAuthor(shard, ev.pubkey);
    return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at, d, address: objectAddress(ev.pubkey, d), shard, event: ev };
}
/** Whether a feed item is a listing (no geometry until bought) rather than an object. */
export function isListing(item) {
    return item.type === 'listing';
}
/**
 * What an `naddr` (NIP-19) for a listing encodes: the kind, the author, the
 * `d`, and up to three relays it was seen on. A client encodes it and opens
 * the seller's page with it.
 */
export function listingPointer(l) {
    return { kind: SNO_KIND, pubkey: l.pubkey, identifier: l.d, relays: (l.seen ?? []).slice(0, 3) };
}
/** `s` as the URL parser writes it when it is an `https:` URL with no credentials in it, else null. */
function httpsUrl(s) {
    if (!s)
        return null;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
    }
    catch {
        return null;
    }
}
/**
 * A listing's `d`: present, printable ASCII, at most 128 bytes. The bound is
 * what keeps an naddr encodable: nip19 corrupts an identifier over 255 bytes
 * and throws on a long enough one, and both clients encode it while drawing a
 * card. (A UUIDv4, NIP-FF-2's rule, is Fanfares' to enforce, not a reader's.)
 */
const LISTING_D = /^[\x20-\x7e]{1,128}$/;
/** The most a price can be: every bitcoin there will ever be, 21 million times 100 million sats. Anything above is not a price. */
export const MAX_PRICE_SATS = 2_100_000_000_000_000;
/**
 * Padded base64: whole groups of four, with at most two `=` at the end. Not
 * written as a repeated group of four, which V8 runs by backtracking, one
 * stack frame a group, and which throws past a few megabytes of ciphertext.
 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isBase64 = (s) => s.length % 4 === 0 && BASE64.test(s);
/** NIP-FF-1 `aes-256-gcm`: a 12-byte IV, a 16-byte tag, and at least one byte of payload. */
const MIN_CIPHERTEXT_BYTES = 12 + 16 + 1;
/** Still image types a thumbnail may be. SVG is left out: it is a document, not a picture. */
const STILL = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif']);
/** The public pictures among an event's imeta tags: the first GIF and the first still. */
function listingImages(tags) {
    const out = {};
    for (const t of tags) {
        if (t[0] !== 'imeta')
            continue;
        const f = new Map();
        for (const part of t.slice(1)) {
            const at = part.indexOf(' ');
            const key = at < 0 ? part : part.slice(0, at);
            if (!f.has(key))
                f.set(key, at < 0 ? '' : part.slice(at + 1).trim());
        }
        // An encrypted file (NIP-FF-1 §Encrypted Files) is not a preview.
        if (f.has('encrypted'))
            continue;
        const url = httpsUrl(f.get('url'));
        const mime = (f.get('m') ?? '').toLowerCase();
        if (!url)
            continue;
        const gif = mime === 'image/gif';
        if (!gif && !STILL.has(mime))
            continue;
        if (gif ? out.preview : out.thumb)
            continue;
        const img = { url, mime };
        const dim = /^(\d{1,5})x(\d{1,5})$/.exec(f.get('dim') ?? '');
        if (dim && +dim[1] > 0 && +dim[2] > 0) {
            img.width = +dim[1];
            img.height = +dim[2];
        }
        const x = f.get('x');
        if (x && /^[0-9a-f]{64}$/.test(x))
            img.sha256 = x;
        const alt = f.get('alt');
        if (alt)
            img.alt = alt;
        if (gif)
            out.preview = img;
        else
            out.thumb = img;
    }
    return out;
}
/**
 * The listing an event carries, or null when it is not one.
 *
 * A kind 33331 with an `encrypted` tag is one of two things, told apart by
 * element [3]: `cyberspace:region` is an object hidden at a place (DECK-0003
 * §3.4), which no feed shows; an `https:` key service URL, any seller's, is an
 * object for sale (NIP-FF-1), which it does, when it carries:
 *
 * - exactly one `encrypted` tag: `aes-256-gcm`, its ciphertext (NIP-FF-1:
 *   base64 of IV, payload and tag), and an `https:` key service with no
 *   credentials in it;
 * - exactly one `["price", "<positive whole sats>", "SATS"]`, at most
 *   `MAX_PRICE_SATS`;
 * - a `d` of printable ASCII, at most 128 bytes.
 *
 * NIP-FF-1 plus a price, not the whole of NIP-FF-2: a `zap` tag and a UUIDv4
 * `d` are Fanfares' rules, which its own key service enforces, and another
 * seller's key service need not share them. Anything else is left out.
 * `content` is the preview text and is never read as a payload.
 */
export function listingFromEvent(ev) {
    if (ev.kind !== SNO_KIND || !wellFormed(ev))
        return null;
    const encs = ev.tags.filter((t) => t[0] === 'encrypted');
    if (encs.length !== 1)
        return null;
    const [, scheme, ciphertext, keyService] = encs[0];
    // Any seller's https key service. cyberspace:region (hidden at a place) or a missing [3] is not one.
    if (!httpsUrl(keyService))
        return null;
    if (scheme !== 'aes-256-gcm')
        return null;
    if (typeof ciphertext !== 'string' || !isBase64(ciphertext))
        return null;
    if ((ciphertext.length / 4) * 3 - (ciphertext.endsWith('==') ? 2 : ciphertext.endsWith('=') ? 1 : 0) < MIN_CIPHERTEXT_BYTES)
        return null;
    const d = objectD(ev);
    if (d === null || !LISTING_D.test(d))
        return null;
    // One price, ["price", "<positive whole sats>", "SATS"], the literal SATS: another unit read as sats would misstate the price.
    const prices = ev.tags.filter((t) => t[0] === 'price');
    if (prices.length !== 1)
        return null;
    const [, amount, unit] = prices[0];
    if (!/^[1-9]\d{0,15}$/.test(amount ?? '') || unit !== 'SATS')
        return null;
    const priceSats = Number(amount);
    if (!Number.isSafeInteger(priceSats) || priceSats > MAX_PRICE_SATS)
        return null;
    const tag = (name) => (ev.tags.find((t) => t[0] === name)?.[1] ?? '').trim();
    const { preview, thumb } = listingImages(ev.tags);
    const alt = preview?.alt ?? thumb?.alt ?? (tag('alt') || undefined);
    const listing = {
        type: 'listing',
        id: ev.id,
        pubkey: ev.pubkey,
        createdAt: ev.created_at,
        d,
        address: objectAddress(ev.pubkey, d),
        title: tag('title') || tag('name'),
        priceSats,
        keyService,
        text: typeof ev.content === 'string' ? ev.content : '',
        event: ev,
    };
    if (preview)
        listing.preview = preview;
    if (thumb)
        listing.thumb = thumb;
    if (alt)
        listing.alt = alt;
    const app = listingApp(ev.tags);
    if (app)
        listing.app = app;
    return listing;
}
/* --------------------------------------------------------------------------
 * Where a listing is bought: the seller's app (NIP-89)
 * ------------------------------------------------------------------------ */
/** A NIP-89 handler (kind 31990). */
export const HANDLER_KIND = 31990;
const HANDLER_ADDRESS = /^31990:([0-9a-f]{64}):([\x20-\x7e]{1,128})$/;
/** A `wss:` relay URL, else undefined. */
function wssUrl(s) {
    if (!s)
        return undefined;
    try {
        return new URL(s).protocol === 'wss:' ? s : undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * The app a listing names: the `client` tag's coordinate (NIP-89, element
 * [2]), else the first `a` tag naming a kind 31990. An `a` naming a 33331 is a
 * placement (§1.10), never an app.
 */
export function listingApp(tags) {
    const client = tags.find((t) => Array.isArray(t) && t[0] === 'client');
    const fromClient = client && typeof client[2] === 'string' ? HANDLER_ADDRESS.exec(client[2]) : null;
    const a = fromClient ? undefined : tags.find((t) => Array.isArray(t) && t[0] === 'a' && typeof t[1] === 'string' && HANDLER_ADDRESS.test(t[1]));
    const m = fromClient ?? (a ? HANDLER_ADDRESS.exec(a[1]) : null);
    if (!m)
        return undefined;
    const app = { address: m[0], pubkey: m[1], d: m[2] };
    const name = typeof client?.[1] === 'string' ? client[1].trim() : undefined;
    if (name)
        app.name = name;
    const relay = wssUrl(fromClient ? client?.[3] : a?.[2]);
    if (relay)
        app.relay = relay;
    return app;
}
/**
 * The read for an app's handler: its author's kind 31990 with its `d`. One
 * tag filter, well inside strfry's three.
 */
export function handlerFilter(app) {
    return { kinds: [HANDLER_KIND], authors: [app.pubkey], '#d': [app.d], limit: 5 };
}
/**
 * Key services whose app has no handler listing kind 33331 yet, and the page
 * that sells for them. Fanfares only, until its own handler lists 33331.
 */
const KNOWN_KEY_SERVICES = [
    { hosts: ['api.fanfares.live', 'staging.api.fanfares.live'], label: 'Fanfares', page: (naddr) => `https://fanfares.io/naddr/${naddr}` },
];
/** Where a listing opens when its seller's app is unknown: njump, which shows any event. */
export const FALLBACK_VIEWER = (naddr) => `https://njump.me/${naddr}`;
/** How long a label may be before it is cut. */
export const SELLER_LABEL_MAX = 24;
/**
 * Suffixes under which anyone may hold a name, so the registrable domain is
 * one label further left: a short, hand-kept part of the Public Suffix List
 * (the common country second levels and the shared hosts a key service or a
 * web app is likely to sit on). An unlisted one reads as its last two labels,
 * which can name the host rather than its tenant; `domain` is a hint beside
 * the button, and the link itself is the URL.
 */
const MULTI_LABEL_SUFFIXES = new Set([
    'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'com.br', 'com.mx', 'com.ar', 'co.za', 'co.in', 'co.kr', 'com.cn', 'com.tw', 'com.sg', 'com.tr',
    'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'herokuapp.com', 'fly.dev', 'onrender.com', 'web.app', 'firebaseapp.com', 'glitch.me', 'deno.dev', 'railway.app', 'replit.app', 'surge.sh', 'nostr1.com', 'nsite.lol', 'ngrok.app', 'ngrok-free.app', 'trycloudflare.com', 'r2.dev', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com',
]);
/**
 * The second levels most country domains sell names under (`shop.co.il`,
 * `shop.com.pl`): under a two-letter top level, one of these is a suffix, not
 * a name, so the domain is the three labels. Without this, an unlisted country
 * reads as `co.il`, which names nobody.
 */
const COUNTRY_SECOND_LEVELS = new Set(['ac', 'co', 'com', 'edu', 'gob', 'gov', 'go', 'ltd', 'mil', 'ne', 'net', 'nic', 'or', 'org', 'plc', 'sch']);
/** The registrable domain of a URL's host (see MULTI_LABEL_SUFFIXES), or the host itself for an IP address or a single label. */
export function registrableDomain(url) {
    let host;
    try {
        host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    }
    catch {
        return '';
    }
    if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith('['))
        return host;
    const labels = host.split('.');
    if (labels.length <= 2)
        return host;
    const [second, top] = labels.slice(-2);
    const lastTwo = `${second}.${top}`;
    const suffix = MULTI_LABEL_SUFFIXES.has(lastTwo) || (/^[a-z]{2}$/.test(top) && COUNTRY_SECOND_LEVELS.has(second));
    return suffix ? labels.slice(-3).join('.') : lastTwo;
}
/**
 * A name fit for a button: control, direction and invisible characters out,
 * spaces collapsed, cut to `SELLER_LABEL_MAX` characters. Cut by code point,
 * so an emoji at the cut is dropped whole rather than left half a pair.
 */
function labelOf(s) {
    const clean = (typeof s === 'string' ? s : '')
        .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\ufff9-\ufffb]/g, '')
        .replace(/\s+/g, ' ').trim();
    const chars = Array.from(clean);
    return chars.length > SELLER_LABEL_MAX ? `${chars.slice(0, SELLER_LABEL_MAX - 1).join('').trimEnd()}…` : clean;
}
/** The handler's display name: `name`, else `display_name`, from its content JSON (NIP-89 metadata). */
function handlerName(content) {
    try {
        const meta = JSON.parse(content);
        for (const k of ['name', 'display_name'])
            if (typeof meta?.[k] === 'string' && meta[k].trim())
                return meta[k];
    }
    catch { /* no metadata */ }
    return undefined;
}
/**
 * The page a valid handler opens for this listing, or null. Valid means: a
 * kind 31990 by the pubkey the listing's app coordinate names, with its `d`,
 * advertising `["k", "33331"]`, and a `web` template holding `<bech32>` for
 * an naddr (typed `naddr`, or untyped), whose filled URL is `https:` with no
 * credentials. The caller has already checked the event's signature.
 */
function handlerPage(app, handler, naddr) {
    if (handler.kind !== HANDLER_KIND || handler.pubkey !== app.pubkey)
        return null;
    if (handler.tags.find((t) => t[0] === 'd')?.[1] !== app.d)
        return null;
    if (!handler.tags.some((t) => t[0] === 'k' && t[1] === String(SNO_KIND)))
        return null;
    const webs = handler.tags.filter((t) => t[0] === 'web' && typeof t[1] === 'string' && t[1].includes('<bech32>') && (t[2] === undefined || t[2] === '' || t[2] === 'naddr'));
    // An explicit naddr template is the one meant for an address; an untyped one is a catch-all.
    webs.sort((a, b) => Number(b[2] === 'naddr') - Number(a[2] === 'naddr'));
    for (const w of webs) {
        const url = httpsUrl(w[1].split('<bech32>').join(naddr));
        if (url)
            return url;
    }
    return null;
}
/**
 * Where to buy a listing, and what the button says (NIP-89).
 *
 * 1. With the seller's handler (fetched by the listing's app coordinate,
 *    signature already checked): its `web` page for the naddr, labelled with
 *    its display name, else the listing's `client` name.
 * 2. Without one, a key service on the known list (Fanfares): that app's page.
 * 3. Otherwise njump, which shows any event, labelled with the key service's
 *    domain, so the buyer sees whose key service sells it.
 *
 * `naddr` is the listing's NIP-19 address (`listingPointer`, encoded by the
 * client: this package does no bech32). `domain` is always the registrable
 * domain of the URL the button opens, never a name the event chose.
 */
export function sellerLink(listing, naddr, handler) {
    if (listing.app && handler && wellFormed(handler)) {
        const url = handlerPage(listing.app, handler, naddr);
        if (url) {
            const domain = registrableDomain(url);
            return { label: labelOf(handlerName(handler.content)) || labelOf(listing.app.name) || domain, url, domain };
        }
    }
    let host = '';
    try {
        host = new URL(listing.keyService).hostname.toLowerCase();
    }
    catch { /* listingFromEvent admits https only */ }
    const known = KNOWN_KEY_SERVICES.find((k) => k.hosts.includes(host));
    if (known) {
        const url = known.page(naddr);
        return { label: known.label, url, domain: registrableDomain(url) };
    }
    const url = FALLBACK_VIEWER(naddr);
    return { label: labelOf(registrableDomain(listing.keyService)) || 'njump', url, domain: registrableDomain(url) };
}
/** Objects and listings as one list, newest first, the order the feed shows them in. */
export function feedItems(state) {
    return [...state.objects, ...state.listings].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
}
/**
 * Read one filter from several relays, each on its own, handing each event
 * over as it lands with the relay it came from.
 *
 * Each relay runs on its own clocks: `connectMs` to open, `authMs` to answer
 * a challenge, then `deadlineMs` to finish once asked. No relay waits on
 * another, and a slow signer does not eat into the read's own time.
 *
 * The same event may arrive from more than one relay; the caller decides
 * what to do about that, because the right answer depends on what it is
 * collecting.
 */
export function readEach(relays, filter, subscribe, onevent, opts = {}) {
    const urls = [...new Set(relays)];
    const ends = new Map();
    const subs = new Map();
    const timers = new Set();
    let finished = false;
    let settle = () => { };
    const done = new Promise((resolve) => { settle = resolve; });
    const stop = () => {
        if (finished)
            return;
        finished = true;
        for (const t of timers)
            clearTimeout(t);
        for (const url of urls)
            if (!ends.has(url))
                ends.set(url, 'deadline');
        for (const sub of subs.values()) {
            try {
                sub.close();
            }
            catch { /* already closed */ }
        }
        settle(ends);
    };
    const end = (url, how) => {
        if (finished || ends.has(url))
            return;
        ends.set(url, how);
        const sub = subs.get(url);
        if (sub && how === 'deadline') {
            try {
                sub.close();
            }
            catch { /* already closed */ }
        }
        if (ends.size >= urls.length)
            stop();
    };
    if (urls.length === 0)
        stop();
    for (const url of urls) {
        void (async () => {
            const opened = opts.connect ? await within(opts.connect(url).then((r) => r !== false, () => false), opts.connectMs ?? CONNECT_DEADLINE_MS, false) : true;
            if (finished)
                return;
            if (!opened) {
                end(url, 'unreachable');
                return;
            }
            if (opts.auth)
                await within(opts.auth(url).then(() => true, () => true), opts.authMs ?? AUTH_DEADLINE_MS, true);
            if (finished)
                return;
            try {
                subs.set(url, subscribe(url, filter, {
                    onevent: (ev) => { if (!finished && !ends.has(url))
                        onevent(ev, url); },
                    oneose: () => end(url, 'eose'),
                    onclose: () => end(url, 'closed'),
                }));
            }
            catch {
                end(url, 'unreachable');
                return;
            }
            const t = setTimeout(() => end(url, 'deadline'), opts.deadlineMs ?? READ_DEADLINE_MS);
            timers.add(t);
        })();
    }
    return { done, close: stop };
}
/** A promise, or `fallback` once `ms` passes without it. */
async function within(p, ms, fallback) {
    let timer;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms); });
    try {
        return await Promise.race([p, late]);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * A feed that pages as it is asked to.
 *
 * Each relay is followed to its own end. A page asks every relay still open
 * for `pageSize` objects from that relay's own oldest second so far, that
 * second included, so events sharing it past the page's end are not lost; a
 * page that brings nothing new steps one second past it, and a second such
 * page means the relay has nothing older (or ignores `until`), so it is not
 * asked again. A short page alone does not end a relay: the client may have
 * dropped events that failed verification, or the relay may cap `limit`
 * below the page (a page whose every new event failed verification still
 * looks like the end). A relay that finishes a page with no events at all
 * has nothing older. More events in one second than a relay sends in one
 * answer can still be missed, which `until` alone cannot avoid. One that cannot be read at all, or runs out its time
 * without a single event, is asked again next page, and left out after a
 * second miss in a row. Following each relay on its own cursor is what keeps a busy
 * relay from pushing a quiet one's objects past the next page's `until`.
 */
export function createFeed(opts) {
    const size = opts.pageSize ?? FEED_PAGE;
    const newest = new Map();
    const parsed = new Map();
    const listed = new Map();
    /** Which relays sent each event. */
    const seenOn = new Map();
    /** Each relay's oldest event so far; absent before its first page. */
    const cursor = new Map();
    /**
     * Whether a relay's next page asks from its oldest second inclusive (the
     * usual case: events in that second past the page's end are not lost) or
     * from the second before (after a page that brought nothing new, the
     * second is spent).
     */
    const inclusive = new Map();
    /** Event ids each relay has sent, to tell a new page from a repeat. */
    const sentBy = new Map();
    /** How many pages in a row a relay could not be read at all. */
    const misses = new Map();
    /** Authors' deletions (NIP-09) of objects read so far, and the events already checked for them. */
    const deletions = [];
    const deletionIds = new Set();
    const checked = new Set();
    const open = new Set(opts.relays);
    let loading = false;
    let closed = false;
    const reading = new Set();
    let batch;
    /** What an event is: an object, a listing, or neither; each event read once. */
    // An event that throws is neither: one bad event must not stop every emit after it.
    const safely = (read) => { try {
        return read();
    }
    catch {
        return null;
    } };
    const itemOf = (ev) => {
        if (!parsed.has(ev.id))
            parsed.set(ev.id, safely(() => objectFromEvent(ev)));
        const o = parsed.get(ev.id);
        if (o)
            return o;
        if (!listed.has(ev.id))
            listed.set(ev.id, safely(() => listingFromEvent(ev)));
        return listed.get(ev.id) ?? null;
    };
    const newestFirst = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1);
    const state = () => {
        const objects = [];
        const listings = [];
        for (const ev of newest.values()) {
            const item = itemOf(ev);
            // What its author deleted is not shown.
            if (!item || isDeleted(item, deletions))
                continue;
            const seen = [...(seenOn.get(ev.id) ?? [])];
            if (isListing(item))
                listings.push({ ...item, seen });
            else
                objects.push({ ...item, seen });
        }
        return { objects: objects.sort(newestFirst), listings: listings.sort(newestFirst), loading, exhausted: open.size === 0 };
    };
    const emit = () => { batch = undefined; if (!closed)
        opts.onChange(state()); };
    const more = async () => {
        if (loading || closed || open.size === 0)
            return;
        loading = true;
        emit();
        // Relays that share a cursor share a read; a first page has none.
        const groups = new Map();
        for (const url of open) {
            const c = cursor.get(url);
            const until = c === undefined ? undefined : inclusive.get(url) === false ? c - 1 : c;
            groups.set(until, [...(groups.get(until) ?? []), url]);
        }
        const counts = new Map();
        const fresh = new Map();
        const reads = [...groups].map(([until, urls]) => {
            const handle = readEach(urls, feedFilter({ authors: opts.authors, until, limit: size }), opts.subscribe, (ev, url) => {
                if (ev.kind !== SNO_KIND)
                    return;
                counts.set(url, (counts.get(url) ?? 0) + 1);
                const mine = sentBy.get(url) ?? new Set();
                // New, and inside what was asked: a relay that ignores `until` and
                // keeps sending newer objects must not count them as progress.
                if (!mine.has(ev.id)) {
                    mine.add(ev.id);
                    if (until === undefined || ev.created_at <= until)
                        fresh.set(url, (fresh.get(url) ?? 0) + 1);
                }
                sentBy.set(url, mine);
                const seen = seenOn.get(ev.id) ?? new Set();
                seen.add(url);
                seenOn.set(ev.id, seen);
                const prevOldest = cursor.get(url);
                if (prevOldest === undefined || ev.created_at < prevOldest)
                    cursor.set(url, ev.created_at);
                // Counted toward the relay's page, so paging moves past it, but not held.
                if (!wellFormed(ev))
                    return;
                const d = ev.tags.find((t) => t[0] === 'd')?.[1];
                if (!d)
                    return;
                const key = `${ev.pubkey}:${d}`;
                const held = newest.get(key);
                // Relays repeat each other and an older edit can arrive after a newer
                // one: the newest event for an address is the object.
                if (held && (held.created_at > ev.created_at || (held.created_at === ev.created_at && held.id <= ev.id)))
                    return;
                newest.set(key, ev);
                if (batch === undefined)
                    batch = setTimeout(emit, opts.batchMs ?? 120);
            }, opts.read);
            reading.add(handle);
            return handle.done.finally(() => { reading.delete(handle); });
        });
        const results = await Promise.all(reads);
        for (const ends of results) {
            for (const [url, how] of ends) {
                const got = counts.get(url) ?? 0;
                if ((how === 'unreachable' || how === 'closed' || how === 'deadline') && got === 0) {
                    // Could not be read at all, or ran out its time with nothing: asked
                    // again next page, and left out only after a second miss in a row.
                    // A slow connect, a signer prompt longer than the read, or a relay
                    // that first answers after the deadline is not "nothing older"; a
                    // second page (with the auth now cached) gets its objects. A relay
                    // that never sends EOSE still ends after two (verification review).
                    const n = (misses.get(url) ?? 0) + 1;
                    misses.set(url, n);
                    if (n >= 2)
                        open.delete(url);
                    continue;
                }
                misses.delete(url);
                // Finished with nothing at all: nothing older to ask for.
                if (how === 'eose' && got === 0) {
                    open.delete(url);
                    continue;
                }
                // A short page is not the end on its own: `got` counts only what
                // reached the feed, and a client's pool drops an event whose
                // signature fails before the feed sees it, so a full page can arrive
                // short; so can the page of a relay that caps `limit` below what it
                // was asked. Short or full, a relay ends after a page with nothing
                // new from its oldest second and then one with nothing new past it.
                if ((fresh.get(url) ?? 0) === 0) {
                    // Events, but every one a repeat: either more than a page share the
                    // boundary second, so step past it, or the relay ignores `until`
                    // and would send the same page forever, so stop asking it.
                    if (inclusive.get(url) === false)
                        open.delete(url);
                    else
                        inclusive.set(url, false);
                }
                else {
                    inclusive.set(url, true);
                }
            }
        }
        // The authors' deletions of what this page brought, from the relays that
        // answered it: an object deleted by its author is hidden (NIP-09).
        const answered = [...new Set(results.flatMap((ends) => [...ends].filter(([url, how]) => how === 'eose' || (counts.get(url) ?? 0) > 0).map(([url]) => url)))];
        const unchecked = [];
        for (const ev of newest.values()) {
            if (checked.has(ev.id))
                continue;
            checked.add(ev.id);
            const item = itemOf(ev);
            if (item)
                unchecked.push(item);
        }
        if (answered.length > 0 && unchecked.length > 0 && !closed) {
            // A few reads at a time, so a page of long addresses never opens a
            // burst of REQs on one socket (strfry allows 20 subscriptions).
            const filters = deletionFilters(unchecked);
            for (let i = 0; i < filters.length && !closed; i += DELETION_READS_AT_ONCE) {
                await Promise.all(filters.slice(i, i + DELETION_READS_AT_ONCE).map((f) => {
                    const handle = readEach(answered, f, opts.subscribe, (ev) => {
                        // One deletion can name objects in several chunks, and come from several relays.
                        if (ev.kind === 5 && !deletionIds.has(ev.id)) {
                            deletionIds.add(ev.id);
                            deletions.push(ev);
                        }
                    }, opts.read);
                    reading.add(handle);
                    return handle.done.finally(() => { reading.delete(handle); });
                }));
            }
        }
        loading = false;
        clearTimeout(batch);
        emit();
    };
    return {
        more,
        state,
        close: () => { closed = true; clearTimeout(batch); for (const r of reading)
            r.close(); },
    };
}
/**
 * The tags a copy carries to credit its original: the `q` always, and with
 * `notify` (a public remix only, never a copy sealed in a bag) the `p` that
 * tells the original's author.
 */
export function creditTags(credit, opts = {}) {
    const tags = [['q', credit.address, credit.relay ?? '']];
    const author = creditAuthor(credit);
    if (opts.notify && /^[0-9a-f]{64}$/.test(author))
        tags.push(['p', author]);
    return tags;
}
/** The original a copy credits, or null when its tags credit none. */
export function readCredit(tags) {
    const t = tags.find((tag) => tag[0] === 'q' && /^33331:[0-9a-f]{64}:/.test(tag[1] ?? ''));
    if (!t)
        return null;
    return t[2] ? { address: t[1], relay: t[2] } : { address: t[1] };
}
/** The pubkey of the author a credit names. */
export function creditAuthor(credit) {
    return credit.address.split(':')[1] ?? '';
}
/**
 * A model made from someone else's object (a REMIX) remembers it: kept on the
 * stored model beside the format's fields, never in the payload, and written
 * with `creditTags` by whatever the model goes out as (a copy in a bag: the
 * `q`; a public remix: the `q` and the `p`). Both clients keep their models
 * as JSON and edit them by spreading, so the field survives edits and reloads.
 */
export function withCredit(model, credit) {
    return { ...model, credit };
}
/** Whose object a model was made from, or undefined for an original. */
export function creditOf(model) {
    return model.credit;
}
//# sourceMappingURL=feed.js.map