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
import { type ShardModel } from './shards.js';
/** A standalone SNO object (DECK-0003 §3.1). */
export declare const SNO_KIND = 33331;
/** How many objects a page asks each relay for. */
export declare const FEED_PAGE = 40;
/**
 * Where published objects are read from by default: the cyberspace relay and
 * the general relays snocrash publishes to. A client adds its own.
 */
export declare const FEED_RELAYS: readonly string[];
/** How long a relay's read stays open, from when it is asked, if it never says it is finished. */
export declare const READ_DEADLINE_MS = 6000;
/** How long a relay gets to open its socket before a read goes on without it. */
export declare const CONNECT_DEADLINE_MS = 3000;
/**
 * How long a relay's auth challenge gets to be answered, on its own clock
 * after the connect. A local key signs at once; an extension or a bunker may
 * be a person approving it, and an auth-gated relay (the cyberspace relay
 * gates reads) skipped for being slow is a feed missing most of its objects.
 */
export declare const AUTH_DEADLINE_MS = 15000;
/** The fields of a nostr event this module reads. */
export interface FeedEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
}
/** An object someone published, with the event it came from. */
export interface FeedObject {
    id: string;
    pubkey: string;
    createdAt: number;
    /** The `d` tag: this object's identity, stable across its edits. */
    d: string;
    /** `33331:<pubkey>:<d>`, the address an `a` tag names. */
    address: string;
    shard: ShardModel;
    /** The event it was read from, as the relay sent it: what a client keeps, republishes or references. */
    event: FeedEvent;
    /** The relays it was read from (createFeed), for a reference's relay hint. */
    seen?: string[];
}
/** A relay filter (NIP-01), as narrow as a feed needs. */
export interface FeedFilter {
    kinds: number[];
    authors?: string[];
    until?: number;
    limit: number;
}
/**
 * A read of authors' deletions (NIP-09, kind 5) of the objects a page
 * brought: one tag filter each (`#a` or `#e`), well inside strfry's three.
 */
export interface DeletionFilter {
    kinds: number[];
    authors: string[];
    '#a'?: string[];
    '#e'?: string[];
    limit: number;
}
/** What a feed read asks: a page of objects, or the deletions of some. */
export type ReadFilter = FeedFilter | DeletionFilter;
/**
 * How many values one deletion filter names, and how many bytes they take in
 * the REQ as sent (JSON, quotes, escapes and commas included, authors too).
 * strfry refuses a filter with more than 200 values in a tag by default, and
 * a REQ larger than the relay's message limit closes the socket; a page of
 * objects stays well inside both, however long their `d` tags are.
 */
export declare const DELETION_FILTER_VALUES = 100;
export declare const DELETION_FILTER_BYTES: number;
/**
 * An address longer than this (as sent, in JSON) is never named in a deletion read. An object's
 * `d` has no length bound in the format (a listing's does, 128 bytes), so an
 * address can be any size; one that long is still checked by its event id
 * (the `#e` read), which catches a deletion that names the event, but not one
 * that names only the address.
 */
export declare const DELETION_ADDRESS_MAX = 1024;
/** How many deletion reads a page runs at once. */
export declare const DELETION_READS_AT_ONCE = 6;
/**
 * The deletion reads for these objects: by address, and by event id, each in
 * chunks of at most DELETION_FILTER_VALUES values and DELETION_FILTER_BYTES
 * bytes, so no single REQ is large enough for a relay to refuse. Each chunk
 * names only the authors of its own objects.
 */
export declare function deletionFilters(objects: readonly Pick<FeedObject, 'pubkey' | 'address' | 'id'>[]): DeletionFilter[];
/**
 * Whether an author deleted an object (NIP-09): a kind 5 by the object's own
 * author naming its event id, or naming its address at or after the event's
 * time (an address deletion removes every version up to that moment). A
 * deletion by anyone else deletes nothing.
 */
export declare function isDeleted(o: Pick<FeedObject, 'pubkey' | 'address' | 'id' | 'createdAt'>, deletions: readonly FeedEvent[]): boolean;
/** The filter for one page of the feed. No tag filters, ever (see the header). */
export declare function feedFilter(opts?: {
    authors?: string[];
    until?: number;
    limit?: number;
}): FeedFilter;
/** An object's address, `33331:<pubkey>:<d>`. */
export declare function objectAddress(pubkey: string, d: string): string;
/**
 * Whether an event has the shape NIP-01 gives it: `tags` an array of arrays
 * of strings, `content` a string. A relay is meant to refuse anything else,
 * but a signature covers whatever was signed, and one relay that passes a
 * `["title", 5]` along must not throw in a reader. Everything here reads tags
 * as strings, so an event that fails this is not read at all.
 */
export declare function wellFormed(ev: Pick<FeedEvent, 'tags' | 'content'>): boolean;
/**
 * An object's `d`, or null when it has none a reader may accept (DECK-0003
 * §3.1): no `d` tag, or an empty one. The first `d` tag is the one that
 * counts, as NIP-01 reads it. A kind 33331 without one is refused, hidden or
 * not, because a relay files every d-less object from one author under the
 * one address `33331:<pubkey>:`, each replacing the last.
 */
export declare function objectD(ev: Pick<FeedEvent, 'tags'>): string | null;
/** The object an event carries, or null when it is not one or is malformed. */
export declare function objectFromEvent(ev: FeedEvent): FeedObject | null;
/** A picture a listing shows before it is bought: one public `imeta` (NIP-92). */
export interface ListingImage {
    /** Always `https:`. */
    url: string;
    /** Always an image type: `image/gif` for the turntable, a still type for the thumbnail. */
    mime: string;
    /** From the imeta's `dim`, `<width>x<height>`, when it has one. */
    width?: number;
    height?: number;
    /** The imeta's `x`, the file's sha256, when it has one. */
    sha256?: string;
    /** The imeta's `alt`. */
    alt?: string;
}
/**
 * A 3D object for sale: a kind 33331 whose payload is sealed (NIP-FF-1) with
 * a key a key service sells. Everything here is what the event shows in
 * public; the shape is not, and nothing here was read from the ciphertext or
 * from `content` as geometry.
 */
export interface FeedListing {
    type: 'listing';
    id: string;
    pubkey: string;
    createdAt: number;
    /** The `d` tag. */
    d: string;
    /** `33331:<pubkey>:<d>`. */
    address: string;
    /** The `title` tag, else the `name` tag, else empty. */
    title: string;
    /** The `price` tag, a positive whole number of sats. */
    priceSats: number;
    /** Element [3] of the `encrypted` tag: where the key is bought, any seller's. Always `https:` with no credentials. */
    keyService: string;
    /** The turntable GIF. */
    preview?: ListingImage;
    /** The still: a PNG, or another still image type. */
    thumb?: ListingImage;
    /** The preview picture's alt text, else the event's `alt` tag. */
    alt?: string;
    /** The event's public `content`: the preview text (NIP-FF-2). Never geometry. */
    text: string;
    /** The event it was read from, as the relay sent it. */
    event: FeedEvent;
    /** The relays it was read from (createFeed), for the naddr's relay hints. */
    seen?: string[];
    /** The app the seller listed it with (NIP-89), when the event names one: where its BUY button can point. */
    app?: ListingApp;
}
/**
 * The app a listing was published with: a NIP-89 handler's coordinate, from
 * the `client` tag's element [2], else an `a` tag naming a kind 31990.
 */
export interface ListingApp {
    /** `31990:<pubkey>:<d>`. */
    address: string;
    pubkey: string;
    d: string;
    /** The `client` tag's element [1], the app's own name for itself, when it has one. */
    name?: string;
    /** A `wss:` relay hint from the same tag, when it has one. */
    relay?: string;
}
/** Something the feed shows: an object, or an object for sale. */
export type FeedItem = FeedObject | FeedListing;
/** Whether a feed item is a listing (no geometry until bought) rather than an object. */
export declare function isListing(item: FeedItem): item is FeedListing;
/**
 * What an `naddr` (NIP-19) for a listing encodes: the kind, the author, the
 * `d`, and up to three relays it was seen on. A client encodes it and opens
 * the seller's page with it.
 */
export declare function listingPointer(l: Pick<FeedListing, 'pubkey' | 'd' | 'seen'>): {
    kind: number;
    pubkey: string;
    identifier: string;
    relays: string[];
};
/** The most a price can be: every bitcoin there will ever be, 21 million times 100 million sats. Anything above is not a price. */
export declare const MAX_PRICE_SATS = 2100000000000000;
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
export declare function listingFromEvent(ev: FeedEvent): FeedListing | null;
/** A NIP-89 handler (kind 31990). */
export declare const HANDLER_KIND = 31990;
/**
 * The app a listing names: the `client` tag's coordinate (NIP-89, element
 * [2]), else the first `a` tag naming a kind 31990. An `a` naming a 33331 is a
 * placement (§1.10), never an app.
 */
export declare function listingApp(tags: readonly string[][]): ListingApp | undefined;
/**
 * The read for an app's handler: its author's kind 31990 with its `d`. One
 * tag filter, well inside strfry's three.
 */
export declare function handlerFilter(app: Pick<ListingApp, 'pubkey' | 'd'>): {
    kinds: number[];
    authors: string[];
    '#d': string[];
    limit: number;
};
/** Where a listing's BUY button goes, and what it says. */
export interface SellerLink {
    /** Who sells it, for "BUY ON <label>": the seller's app, Fanfares, or the key service's domain. */
    label: string;
    /** The page to open. Always `https:`. */
    url: string;
    /** The registrable domain of `url` itself, shown beside the button, so a name cannot hide where it goes. */
    domain: string;
}
/** Where a listing opens when its seller's app is unknown: njump, which shows any event. */
export declare const FALLBACK_VIEWER: (naddr: string) => string;
/** How long a label may be before it is cut. */
export declare const SELLER_LABEL_MAX = 24;
/** The registrable domain of a URL's host (see MULTI_LABEL_SUFFIXES), or the host itself for an IP address or a single label. */
export declare function registrableDomain(url: string): string;
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
export declare function sellerLink(listing: Pick<FeedListing, 'keyService' | 'app'>, naddr: string, handler?: FeedEvent | null): SellerLink;
/** Objects and listings as one list, newest first, the order the feed shows them in. */
export declare function feedItems(state: Pick<FeedState, 'objects' | 'listings'>): FeedItem[];
/** What a subscription to one relay reports. */
export interface RelayHandlers {
    onevent: (ev: FeedEvent) => void;
    /** The relay has sent everything it has for the filter. */
    oneose: () => void;
    /** The relay closed the subscription, or the connection dropped. */
    onclose: (reason?: string) => void;
}
/**
 * How a client subscribes to one relay: its pool, its auth. Returns how to
 * close it. Generic over the filter, so a client can read other filters (a
 * `#d` lookup, profiles) through the same per-relay reader; the feed's own
 * reads use FeedFilter.
 */
export type Subscribe<F = ReadFilter> = (url: string, filter: F, handlers: RelayHandlers) => {
    close: () => void;
};
export interface ReadOptions {
    /** Each relay's read deadline, counted from when it is asked. */
    deadlineMs?: number;
    /** Each relay's deadline to open (`connect`). */
    connectMs?: number;
    /** Each relay's allowance to authenticate (`auth`), on its own clock after the connect. */
    authMs?: number;
    /** Open a relay. False (or a rejection, or `connectMs` passing) means it cannot be read now. */
    connect?: (url: string) => Promise<boolean | void>;
    /**
     * Answer the relay's auth challenge, if it sends one. Best effort: a
     * rejection or `authMs` passing does not stop the read, since a relay that
     * does not gate reads answers anyway and one that does closes the request.
     */
    auth?: (url: string) => Promise<unknown>;
}
/** How one relay's part of a read ended. */
export type RelayEnd = 'eose' | 'closed' | 'unreachable' | 'deadline';
export interface ReadHandle {
    /** Resolves when every relay has finished, with how each one ended. */
    done: Promise<Map<string, RelayEnd>>;
    /** Give up now. Safe to call twice. */
    close: () => void;
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
export declare function readEach<F = ReadFilter>(relays: readonly string[], filter: F, subscribe: Subscribe<F>, onevent: (ev: FeedEvent, url: string) => void, opts?: ReadOptions): ReadHandle;
export interface FeedState {
    /** Newest first, one per address. */
    objects: FeedObject[];
    /** Objects for sale (listingFromEvent), newest first, one per address. `feedItems` merges the two. */
    listings: FeedListing[];
    /** A page is being read. */
    loading: boolean;
    /** Every relay has been read to its end: there is nothing older. */
    exhausted: boolean;
}
export interface FeedOptions {
    relays: readonly string[];
    /** Pages of objects (FeedFilter, no tag filters) and their deletions (DeletionFilter, one each). */
    subscribe: Subscribe<ReadFilter>;
    /** Only these authors' objects (a MINE view); everyone's when absent. */
    authors?: string[];
    pageSize?: number;
    read?: ReadOptions;
    /** Called as objects arrive (batched) and when a page ends. */
    onChange: (state: FeedState) => void;
    /** How long arrivals are gathered before `onChange`; 120 ms. */
    batchMs?: number;
}
export interface Feed {
    /** Read the next page; does nothing while one is being read or when exhausted. */
    more: () => Promise<void>;
    state: () => FeedState;
    /** Stop any read in progress; later pages are not read. */
    close: () => void;
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
export declare function createFeed(opts: FeedOptions): Feed;
/**
 * Whose object a copy was made from (DECK-0003, crediting; ruled by arkinox,
 * 2026-10-08).
 *
 * Every copy and remix carries the NIP-18 quote tag naming the original's
 * address, `["q", "33331:<pubkey>:<d>", "<relay hint>"]`. `q` because it is
 * the standard tag for "this is based on that", it is indexable (a relay can
 * answer "what copies my object"), and it is not `a` or `e`, which on a kind
 * 33331 mean "this object places that one" (§1.10) and would be misread as a
 * placement.
 *
 * A PUBLIC remix (published as its own kind 33331) also carries
 * `["p", "<original author>"]`, so the author's clients tell them. A copy
 * sealed in a bag carries only the `q`: a notification there would point at
 * a hidden placement.
 */
export interface Credit {
    /** `33331:<pubkey>:<d>` of the original. */
    address: string;
    /** A relay the original was seen on, if known. */
    relay?: string;
}
/**
 * The tags a copy carries to credit its original: the `q` always, and with
 * `notify` (a public remix only, never a copy sealed in a bag) the `p` that
 * tells the original's author.
 */
export declare function creditTags(credit: Credit, opts?: {
    notify?: boolean;
}): string[][];
/** The original a copy credits, or null when its tags credit none. */
export declare function readCredit(tags: readonly string[][]): Credit | null;
/** The pubkey of the author a credit names. */
export declare function creditAuthor(credit: Credit): string;
/**
 * A model made from someone else's object (a REMIX) remembers it: kept on the
 * stored model beside the format's fields, never in the payload, and written
 * with `creditTags` by whatever the model goes out as (a copy in a bag: the
 * `q`; a public remix: the `q` and the `p`). Both clients keep their models
 * as JSON and edit them by spreading, so the field survives edits and reloads.
 */
export declare function withCredit(model: ShardModel, credit: Credit): ShardModel;
/** Whose object a model was made from, or undefined for an original. */
export declare function creditOf(model: ShardModel): Credit | undefined;
//# sourceMappingURL=feed.d.ts.map