import { type SeedExpr } from './expr.js';
/** One allele of a gene: its value and whether it is dominant (§3.3). */
export interface Allele {
    value: number;
    dominant: boolean;
}
/** A gene of the genome (§3.3). */
export interface Gene {
    name: string;
    a: Allele;
    b: Allele;
    lo: number;
    hi: number;
    /** One of `size`, `hue` and `tone`. */
    standard: boolean;
    /** A standard gene the text does not declare: both alleles at the default, neither dominant. */
    implicit: boolean;
}
/** A symbol as written in the axiom or a successor: its character and its argument expressions. */
export interface SymbolTemplate {
    c: string;
    args: SeedExpr[];
}
/** A growth rule (§3.7). */
export interface Rule {
    /** The head: a letter or a turtle character. */
    c: string;
    params: string[];
    /** The slot of each parameter. Every rule's parameters share the slots after the DNA's names. */
    paramSlots: number[];
    cond: SeedExpr | null;
    chance: SeedExpr | null;
    succ: SymbolTemplate[];
}
/** A `let` line (§3.5). */
export interface Let {
    name: string;
    slot: number;
    fn: SeedExpr;
}
/** A parsed, valid DNA. */
export interface Dna {
    /** The text as written: it is what a mix copies lines from (§6.6). */
    text: string;
    /** The SEEDO revision it declares, 1 when it declares none (§3.2). */
    revision: number;
    name: string;
    species: string;
    /** A `planted` line's value, for a workshop. A reader ignores it when it grows a seed (§3.2). */
    planted: number | null;
    /** A `scale` line's value, for a workshop. A reader ignores it when it grows a seed (§3.2). */
    scale: number | null;
    mutate: number;
    sterile: boolean;
    angle: number;
    width: number;
    color: number;
    /** The genome, in genome order: `size`, `hue`, `tone`, then the text's own genes (§3.3). */
    genes: Gene[];
    lets: Let[];
    axiom: SymbolTemplate[];
    rules: Rule[];
    /** The rules by head character, each list in line order. */
    rulesByHead: ReadonlyMap<string, Rule[]>;
    /** Equal for two DNAs exactly when they are of one species (§3.9). */
    speciesKey: string;
    /** The slot of every name: built-ins, standard genes, the text's genes and lets (§3.4). */
    slots: ReadonlyMap<string, number>;
    /** The length of an environment: every name's slot, then four for rule parameters. */
    slotCount: number;
}
export interface ParseDnaOptions {
    /**
     * The text is a mixed DNA's computed child text (§6.6), which the 8,192-byte
     * limit does not bound (§3.1). A written DNA's text always is. A child text
     * cached and read again goes through `parseChildText`, which sets this.
     */
    computed?: boolean;
}
export declare const isLetter: (ch: string) => boolean;
export declare const isSymbolChar: (ch: string) => boolean;
/**
 * True when a string holds an unpaired surrogate, which §3.1 refuses. A loop
 * rather than a regular expression with a lookbehind, which Safari before 16.4
 * cannot even compile.
 */
export declare function hasLoneSurrogate(s: string): boolean;
/** The first `n` code points of a string. */
export declare const cutCodePoints: (s: string, n: number) => string;
/**
 * A line with its comment removed: everything from the first `#` to the end,
 * whatever it holds (§3.1). The reference's `/#.*$/` stops at a CR, U+2028 or U+2029
 * in the comment and then removes nothing; the DECK's text is followed here.
 */
export declare function stripComment(raw: string): string;
/** A line's keyword: its first run of characters up to whitespace, after the comment and trim. */
export declare function lineKeyword(line: string): string;
/** Read a DNA's SEEDO text. Throws SeedoError when the text is invalid (§3). */
export declare function parseDna(text: string, options?: ParseDnaOptions): Dna;
/**
 * Read a mixed DNA's computed child text (§6.6), for example one cached and
 * read back: the same as `parseDna`, without the 8,192-byte limit that binds
 * only written DNAs (§3.1).
 */
export declare function parseChildText(text: string): Dna;
/** Parse without throwing: the DNA, or the reason the text is invalid. */
export declare function tryParseDna(text: string, options?: ParseDnaOptions): {
    ok: true;
    dna: Dna;
} | {
    ok: false;
    error: string;
};
/** A gene's expressed value (§3.3): the dominant allele when exactly one is, else the floor of their mean. */
export declare function expressGene(g: Pick<Gene, 'a' | 'b'>): number;
//# sourceMappingURL=parse.d.ts.map