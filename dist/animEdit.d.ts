/**
 * animEdit.ts: the rules of a motion editor, as data (DECK-0003 §1.14). Pure:
 * presets with familiar names that write the canonical motions, the speed
 * conversion between cycles a minute and `c` cycles every `b` seconds, the
 * flicker warning §1.14 asks an authoring tool for, and every edit, each
 * returning a new motion list that only ever holds what a writer may write.
 *
 * Names live here, never in the data: the menu says SPIN, the payload says
 * `turn`.
 *
 * One frame and one unit. Everything here is in the field's own terms: the
 * DECK-0003 §2 frame (+Z toward the viewer) and ticks (1/120 of a model
 * unit). A client that shows another frame or unit converts at its controls.
 * ONOSENDAI shows cyberspace axes and gibsons (its lib/animEdit.ts, from which
 * this is taken); snocrash shows the §2 frame and model units.
 */
import { type Motion } from './anim.js';
import type { ShardModel } from './shards.js';
/** What each motion is called in an editor: the preset that writes it (a BOB is a small BACK AND FORTH). */
export declare const MOTION_NAMES: Readonly<Record<string, string>>;
export type PresetId = 'spin' | 'bob' | 'pendulum' | 'slide' | 'elevator' | 'orbit' | 'path';
export interface Preset {
    id: PresetId;
    /** The button's label. */
    label: string;
    /** Its tooltip. */
    tip: string;
    /** The motion, in the §2 frame, sized for an object that reaches `size` ticks from its origin. */
    make: (size: number) => unknown[];
}
/**
 * The presets, in menu order, as ONOSENDAI's workshop has them. Speeds are
 * short fractions: SPIN's 1 every 20 s is 3 turns a minute.
 */
export declare const PRESETS: readonly Preset[];
/** How far an object reaches from its origin, in ticks of its own lattice: what a preset sizes to (at least one unit). */
export declare function objectReach(s: Pick<ShardModel, 'vertices'>): number;
/** The plain messages an editor shows when an edit meets a limit. */
export declare const LIMITS: {
    readonly motions: "Up to 4 motions";
    readonly speed: "Top speed is 120 a minute";
    readonly slowest: "That is as slow as it goes";
    readonly points: "Up to 32 points";
    readonly fewPoints: "A path needs 2 points";
    readonly reach: "That is as far as it goes";
    readonly near: "That is as small as it goes";
    readonly time: "A leg takes up to 1000";
    readonly ratio: "Same timing, smaller numbers";
    readonly flicker: "This may flicker more than 3 times a second";
    readonly rest: "Rests take up to 49% at each stop";
};
/** An edit's result: the new list, and a message when a limit changed what was asked. */
export interface Edited {
    list: Motion[];
    note?: string;
}
/** Cycles a minute, signed. */
export declare function perMinute(m: Pick<Motion, 'c' | 'b'>): number;
/**
 * The rate for a speed in cycles a minute (its sign the direction): exactly
 * what is shown, to two decimals, as c cycles every b seconds in lowest
 * terms (3 a minute is 1 every 20 s; 2.5 is 1 every 24 s), clamped to what
 * the field allows (at most two a second, never stopped). A note when clamped.
 */
export declare function rateFor(perMin: number): {
    c: number;
    b: number;
    note?: string;
};
/**
 * Whether a motion may flicker more than three times a second (§1.14: an
 * authoring tool SHOULD warn), from its cycles a second and what it does in
 * one: a turn or an orbit past half a cycle a second (an object with several
 * spokes, the spec's own example); a swing or a slide, two reversals a cycle;
 * a lift, two stops a cycle; a path, one change of course a leg.
 */
export declare function mayFlicker(m: Motion): boolean;
/** The speeds the − and + step through, cycles a minute. */
export declare const SPEED_STEPS: readonly [0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 90, 120];
/** The next speed step up (dir 1) or down (dir −1) from `perMin`'s size, keeping its sign. */
export declare function stepSpeed(perMin: number, dir: 1 | -1): number;
/** A number for showing: up to two decimals, no trailing zeros. */
export declare function showNumber(n: number): string;
/** The motions a raw `anim` holds, as an editor edits them (what a reader reads). */
export declare function listOf(raw: readonly unknown[]): Motion[];
/** The list as the field stores it (canonical, writeMotion). */
export declare function rawOf(list: readonly Motion[]): unknown[][];
/** A preset added at the end, sized for an object reaching `size` ticks. */
export declare function addPreset(list: readonly Motion[], id: PresetId, size: number): Edited;
export declare function removeMotion(list: readonly Motion[], i: number): Edited;
/** Motion i moved one place earlier (dir −1) or later (dir 1). Order is meaning: the first is innermost. */
export declare function moveMotion(list: readonly Motion[], i: number, dir: 1 | -1): Edited;
/** Motion i about (or along) another axis, 0 x, 1 y, 2 z. A path has none. */
export declare function setAxis(list: readonly Motion[], i: number, axis: 0 | 1 | 2): Edited;
/** Motion i at a speed in cycles a minute (its sign the direction), stored as c/b in lowest terms. */
export declare function setSpeed(list: readonly Motion[], i: number, perMin: number): Edited;
/** Whether REVERSE means anything for a motion: a swing or a slide run backward is the same motion at another phase, so the field writes them forward. */
export declare function reversible(m: Pick<Motion, 'word'>): boolean;
/** Motion i run the other way. */
export declare function reverse(list: readonly Motion[], i: number): Edited;
/** Motion i with its phase offset at `deg`, wrapped into 0..359. */
export declare function setPhase(list: readonly Motion[], i: number, deg: number): Edited;
/** What a motion's amount is: degrees for a swing, ticks for a slide, an orbit's radius and a lift's travel, none otherwise. */
export declare function amountKind(m: Pick<Motion, 'word'>): 'degrees' | 'distance' | null;
/** Motion i's amount: degrees for a swing, ticks otherwise (a lift's signed). */
export declare function amountOf(m: Motion): number;
/** Motion i with its amount set (degrees, or whole ticks), clamped to the field's range, with a note when clamped. */
export declare function setAmount(list: readonly Motion[], i: number, value: number): Edited;
/** A lift's rest share at each stop, whole percent 0..49. */
export declare function setRest(list: readonly Motion[], i: number, percent: number): Edited;
/** A path's waypoint: x, y, z in ticks (§2 frame), and its leg's share of the time. */
export interface Waypoint {
    x: number;
    y: number;
    z: number;
    time: number;
}
export declare function pointsOf(m: Motion): Waypoint[];
/** One coordinate (whole ticks) or the time share of point j of path i. */
export declare function setPoint(list: readonly Motion[], i: number, j: number, key: keyof Waypoint, value: number): Edited;
/**
 * A point added after point j, one model unit up from it. With no j, it goes
 * just before the last point, so a path that starts at its rest pose (its last
 * point at the origin, §1.14) keeps doing so.
 */
export declare function addPoint(list: readonly Motion[], i: number, after?: number): Edited;
export declare function removePoint(list: readonly Motion[], i: number, j: number): Edited;
export declare function movePoint(list: readonly Motion[], i: number, j: number, dir: 1 | -1): Edited;
/** The longest cycle among the motions, in seconds: what a scrub runs through once. */
export declare function cycleSeconds(list: readonly Pick<Motion, 'c' | 'b'>[]): number;
/** Whether a rate stays within the field. */
export declare function rateWritable(m: Pick<Motion, 'c' | 'b'>): boolean;
//# sourceMappingURL=animEdit.d.ts.map