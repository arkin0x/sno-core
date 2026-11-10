/** Values by slot: built-ins, genes, lets and rule parameters, at the indices the DNA's `slots` gives them. */
export type SeedEnv = number[];
/** The names in use where an expression stands, each with its slot. */
export type SeedScope = ReadonlyMap<string, number>;
/** A compiled expression, with its node count `n` and depth `d` (§3.4). */
export interface SeedExpr {
    (env: SeedEnv): number;
    readonly n: number;
    readonly d: number;
}
/** A text that breaks a rule of §3: a reader MUST NOT grow it. */
export declare class SeedoError extends Error {
    constructor(message: string);
}
/** The whitespace §3.1 trims from the ends of a line. */
export declare const WS = "[\\t\\n\\v\\f\\r ]";
export declare const trimWS: (s: string) => string;
export declare const clampValue: (v: number) => number;
/**
 * Compile one expression. `scope` maps each name in use where it stands to its
 * slot; `where` prefixes every error. Throws SeedoError on any text §3.4
 * refuses, and refuses nesting past the depth limit before its stack grows.
 */
export declare function compileExpr(src: string, scope: SeedScope, where: string): SeedExpr;
//# sourceMappingURL=expr.d.ts.map