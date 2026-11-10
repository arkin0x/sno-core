/**
 * Reading a DNA's SEEDO text (§3): lines, header lines, the genome, lets, the
 * axiom, rules, the validity limits and the species key. A text that breaks
 * any rule throws SeedoError, with the reference interpreter's message.
 */
import { SEEDO_BUILTINS, SEEDO_KEYWORDS, SEEDO_LIMITS, SEEDO_RESERVED, SEEDO_REVISION, STANDARD_GENES } from './constants.js';
import { compileExpr, SeedoError, trimWS, WS } from './expr.js';
const TURTLE = "+-&^\\/|[]!'";
const LETTER_RE = /^[A-Za-z]$/;
const NAME_RE = /^[A-Za-z_][A-Za-z_0-9]*$/;
const CONTROL_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f]/;
const PRINTABLE_RE = /^[\x20-\x7e\t]*$/;
const SPLIT_WS = new RegExp(WS + '+');
const STD_NAMES = STANDARD_GENES.map((g) => g.name);
export const isLetter = (ch) => LETTER_RE.test(ch);
export const isSymbolChar = (ch) => isLetter(ch) || TURTLE.includes(ch);
/**
 * True when a string holds an unpaired surrogate, which §3.1 refuses. A loop
 * rather than a regular expression with a lookbehind, which Safari before 16.4
 * cannot even compile.
 */
export function hasLoneSurrogate(s) {
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0xd800 && c <= 0xdbff) {
            const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
            if (d >= 0xdc00 && d <= 0xdfff) {
                i++;
                continue;
            }
            return true;
        }
        if (c >= 0xdc00 && c <= 0xdfff)
            return true;
    }
    return false;
}
/** The first `n` code points of a string. */
export const cutCodePoints = (s, n) => [...s].slice(0, n).join('');
/**
 * A line with its comment removed: everything from the first `#` to the end,
 * whatever it holds (§3.1). The reference's `/#.*$/` stops at a CR, U+2028 or U+2029
 * in the comment and then removes nothing; the DECK's text is followed here.
 */
export function stripComment(raw) {
    const h = raw.indexOf('#');
    return h < 0 ? raw : raw.slice(0, h);
}
/** A line's keyword: its first run of characters up to whitespace, after the comment and trim. */
export function lineKeyword(line) {
    return line.split(SPLIT_WS)[0];
}
function splitTop(s) {
    const out = [];
    let d = 0, cur = '';
    for (const ch of s) {
        if (ch === '(')
            d++;
        if (ch === ')')
            d--;
        if (ch === ',' && d === 0) {
            out.push(cur);
            cur = '';
        }
        else
            cur += ch;
    }
    out.push(cur);
    return out;
}
function parseString(src, known, where, maxSymbols = Infinity) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/[\t\v\f\r ]/.test(ch)) {
            i++;
            continue;
        }
        if (!isSymbolChar(ch))
            throw new SeedoError(where + ': "' + ch + '" is not a symbol');
        i++;
        let args = [];
        if (src[i] === '(') {
            let d = 0, j = i;
            for (; j < src.length; j++) {
                if (src[j] === '(')
                    d++;
                if (src[j] === ')') {
                    d--;
                    if (d === 0)
                        break;
                }
            }
            if (j >= src.length)
                throw new SeedoError(where + ': missing )');
            const inner = src.slice(i + 1, j);
            // "()" is no arguments; any empty argument is an error
            args = trimWS(inner) === '' ? [] : splitTop(inner).map((a) => compileExpr(a, known, where));
            if (args.length > SEEDO_LIMITS.params)
                throw new SeedoError(where + ': more than ' + SEEDO_LIMITS.params + ' parameters');
            i = j + 1;
        }
        out.push({ c: ch, args });
        if (out.length > maxSymbols)
            throw new SeedoError(where + ': a successor has more than ' + maxSymbols + ' symbols');
    }
    return out;
}
function intLine(rest, where, kw) {
    if (!/^-?\d+$/.test(rest))
        throw new SeedoError(where + ': ' + kw + ' is a whole number');
    const v = parseInt(rest, 10);
    if (Math.abs(v) > SEEDO_LIMITS.value)
        throw new SeedoError(where + ': ' + kw + ' is out of range');
    return v;
}
const utf8Length = (s) => new TextEncoder().encode(s).length;
/** Read a DNA's SEEDO text. Throws SeedoError when the text is invalid (§3). */
export function parseDna(text, options = {}) {
    if (hasLoneSurrogate(text))
        throw new SeedoError('the text is not well-formed Unicode');
    if (!options.computed && utf8Length(text) > SEEDO_LIMITS.textBytes)
        throw new SeedoError('the text is longer than ' + SEEDO_LIMITS.textBytes + ' bytes');
    const prog = {
        text, revision: 1, name: 'dna', species: '', planted: null, scale: null,
        mutate: 0, sterile: false, angle: 30, width: 2, color: 7,
    };
    let genes = [];
    const lets = [];
    const names = new Set([...SEEDO_BUILTINS, ...STD_NAMES]);
    // every name in use gets a slot: built-ins and standard genes first, then genes and lets as declared
    const slots = new Map([...names].map((n, i) => [n, i]));
    const addName = (n) => { names.add(n); if (!slots.has(n))
        slots.set(n, slots.size); };
    const declared = new Set();
    let axiomSrc = null, axiomLine = '';
    const ruleSrc = [];
    const seen = new Set();
    const lines = text.split('\n');
    for (let n = 0; n < lines.length; n++) {
        const where = 'line ' + (n + 1);
        const line = trimWS(stripComment(lines[n]));
        if (!line)
            continue;
        const kw = lineKeyword(line);
        if (CONTROL_RE.test(line))
            throw new SeedoError(where + ': a control character');
        const isRule = line.includes('->');
        const known = isRule || SEEDO_KEYWORDS.includes(kw);
        if (known && kw !== 'dna' && kw !== 'seed' && kw !== 'species' && !PRINTABLE_RE.test(line))
            throw new SeedoError(where + ': only printable ASCII outside comments and names');
        if (isRule) {
            if (line.split('->').length !== 2)
                throw new SeedoError(where + ': a rule has exactly one "->"');
            ruleSrc.push([line, where]);
            continue;
        }
        const rest = trimWS(line.slice(kw.length));
        const once = (k) => { if (seen.has(k))
            throw new SeedoError(where + ': a second "' + k + '" line'); seen.add(k); };
        if (kw === 'seed' || kw === 'dna') {
            once('dna');
            prog.name = cutCodePoints(rest, 64);
        }
        else if (kw === 'species') {
            once('species');
            prog.species = cutCodePoints(rest, 64);
        }
        else if (kw === 'sterile') {
            prog.sterile = true;
        }
        else if (kw === 'scale') {
            once('scale');
            if (!/^\d+$/.test(rest) || +rest > 84)
                throw new SeedoError(where + ': scale is 0 to 84');
            prog.scale = +rest;
        }
        else if (kw === 'planted') {
            once('planted');
            if (!/^\d+$/.test(rest))
                throw new SeedoError(where + ': planted is a block height');
            prog.planted = parseInt(rest, 10);
        }
        else if (kw === 'mutate') {
            once('mutate');
            prog.mutate = Math.max(0, Math.min(100, intLine(rest, where, kw)));
        }
        else if (kw === 'angle' || kw === 'width' || kw === 'color') {
            once(kw);
            prog[kw] = intLine(rest, where, kw);
        }
        else if (kw === 'gene') {
            const m = /^([A-Za-z_][A-Za-z_0-9]*)[\t ]+(-?\d+)(!?)[\t ]+(-?\d+)(!?)[\t ]+in[\t ]+(-?\d+)\.\.(-?\d+)$/.exec(rest);
            if (!m)
                throw new SeedoError(where + ': gene is "gene name 4! 7 in 1..12"');
            const std = STANDARD_GENES.find((x) => x.name === m[1]);
            if ((names.has(m[1]) && !(std && !declared.has(m[1]))) || SEEDO_RESERVED.includes(m[1]))
                throw new SeedoError(where + ': name "' + m[1] + '" is taken');
            const nums = [m[2], m[4], m[6], m[7]].map(Number);
            if (nums.some((v) => Math.abs(v) > SEEDO_LIMITS.value))
                throw new SeedoError(where + ': gene values are within 1,000,000');
            let lo = nums[2], hi = nums[3];
            if (lo > hi)
                throw new SeedoError(where + ': a gene range runs low to high');
            declared.add(m[1]);
            if (std) {
                lo = Math.max(std.min, lo);
                hi = Math.min(std.max, hi);
                if (lo > hi)
                    throw new SeedoError(where + ': ' + m[1] + ' range is outside ' + std.min + '..' + std.max);
            }
            const cl = (v) => Math.max(lo, Math.min(hi, v));
            genes.push({ name: m[1], a: { value: cl(nums[0]), dominant: m[3] === '!' }, b: { value: cl(nums[1]), dominant: m[5] === '!' }, lo, hi, standard: !!std, implicit: false });
            addName(m[1]);
        }
        else if (kw === 'let') {
            const m = new RegExp('^([A-Za-z_][A-Za-z_0-9]*)' + WS + '*=' + WS + '*(.+)$').exec(rest);
            if (!m)
                throw new SeedoError(where + ': let is "let name = expression"');
            if (names.has(m[1]) || SEEDO_RESERVED.includes(m[1]))
                throw new SeedoError(where + ': name "' + m[1] + '" is taken');
            const inScope = new Map([...slots].filter(([x]) => x !== 'w' && x !== 'W' && x !== 'g'));
            const fn = compileExpr(m[2], inScope, where);
            addName(m[1]);
            lets.push({ name: m[1], slot: slots.get(m[1]), fn });
        }
        else if (kw === 'axiom') {
            once('axiom');
            axiomSrc = rest;
            axiomLine = where;
        }
        else if (kw === 'seedo') {
            once('seedo');
            if (!/^[1-9][0-9]*$/.test(rest))
                throw new SeedoError(where + ': seedo is a revision number from 1');
            if (Number(rest) > SEEDO_REVISION)
                throw new SeedoError(where + ': SEEDO revision ' + rest + ' is newer than this reader (' + SEEDO_REVISION + ')');
            prog.revision = Number(rest);
        }
        // otherwise an unknown line (§3.2): ignored, though it counts toward the size limit
    }
    if (axiomSrc === null)
        throw new SeedoError('no axiom');
    const stdGenes = STANDARD_GENES.map((x) => genes.find((g) => g.name === x.name) ??
        { name: x.name, a: { value: x.def, dominant: false }, b: { value: x.def, dominant: false }, lo: x.lo, hi: x.hi, standard: true, implicit: true });
    genes = stdGenes.concat(genes.filter((g) => !g.standard));
    const axiom = parseString(axiomSrc, slots, axiomLine);
    const paramBase = slots.size;
    if (ruleSrc.length > SEEDO_LIMITS.rules)
        throw new SeedoError('more than ' + SEEDO_LIMITS.rules + ' rules');
    const rules = [];
    const rulesByHead = new Map();
    const headRe = new RegExp('^' + WS + '*(\\S)(?:\\(([^)]*)\\))?' + WS + '*(.*)$');
    for (const [line, where] of ruleSrc) {
        const [left, right] = line.split('->');
        const m = headRe.exec(left);
        if (!m || !isSymbolChar(m[1]))
            throw new SeedoError(where + ': a rule starts with a symbol');
        // "()" or "( )" is no parameters; otherwise every comma-separated part is one name
        const params = m[2] === undefined || trimWS(m[2]) === '' ? [] : m[2].split(',').map(trimWS);
        for (const p of params)
            if (!NAME_RE.test(p) || names.has(p) || SEEDO_RESERVED.includes(p))
                throw new SeedoError(where + ': parameter "' + p + '" is not a free name');
        if (new Set(params).size !== params.length)
            throw new SeedoError(where + ': parameter names repeat');
        if (params.length > SEEDO_LIMITS.params)
            throw new SeedoError(where + ': more than ' + SEEDO_LIMITS.params + ' parameters');
        const known = new Map(slots);
        params.forEach((q, k) => known.set(q, paramBase + k));
        let rest = trimWS(m[3]);
        let cond = null, chance = null;
        const ci = rest.search(/\bchance\b/);
        if (ci >= 0) {
            chance = compileExpr(rest.slice(ci + 6), known, where);
            rest = trimWS(rest.slice(0, ci));
        }
        if (/^if[\t ]/.test(rest))
            cond = compileExpr(rest.slice(3), known, where);
        else if (rest)
            throw new SeedoError(where + ': expected "if" or "chance"');
        const rule = { c: m[1], params, paramSlots: params.map((_, k) => paramBase + k), cond, chance, succ: parseString(right, known, where, SEEDO_LIMITS.successor) };
        rules.push(rule);
        const list = rulesByHead.get(rule.c);
        if (list)
            list.push(rule);
        else
            rulesByHead.set(rule.c, [rule]);
    }
    // §3.8: the conditions and chances of one head and arity hold at most 256 nodes, of the whole DNA at most 1,024
    const perHead = new Map();
    let allNodes = 0;
    for (const r of rules) {
        const n = (r.cond ? r.cond.n : 0) + (r.chance ? r.chance.n : 0);
        const k = r.c + '/' + r.params.length;
        const total = (perHead.get(k) ?? 0) + n;
        perHead.set(k, total);
        allNodes += n;
        if (total > SEEDO_LIMITS.headNodes)
            throw new SeedoError('the rules of ' + k + ' have more than ' + SEEDO_LIMITS.headNodes + ' condition and chance nodes');
    }
    if (allNodes > SEEDO_LIMITS.dnaNodes)
        throw new SeedoError('the rules have more than ' + SEEDO_LIMITS.dnaNodes + ' condition and chance nodes');
    // §3.9 species: the rule alphabet (character and arity) plus the gene names
    const alpha = new Set();
    const addS = (s) => { if (isLetter(s.c))
        alpha.add(s.c + '/' + s.args.length); };
    axiom.forEach(addS);
    for (const r of rules) {
        alpha.add(r.c + '/' + r.params.length);
        r.succ.forEach(addS);
    }
    const speciesKey = [...alpha].sort().join(' ') + ' | ' + genes.map((g) => g.name).sort().join(' ');
    return { ...prog, genes, lets, axiom, rules, rulesByHead, speciesKey, slots, slotCount: paramBase + SEEDO_LIMITS.params };
}
/**
 * Read a mixed DNA's computed child text (§6.6), for example one cached and
 * read back: the same as `parseDna`, without the 8,192-byte limit that binds
 * only written DNAs (§3.1).
 */
export function parseChildText(text) {
    return parseDna(text, { computed: true });
}
/** Parse without throwing: the DNA, or the reason the text is invalid. */
export function tryParseDna(text, options = {}) {
    try {
        return { ok: true, dna: parseDna(text, options) };
    }
    catch (e) {
        if (e instanceof SeedoError)
            return { ok: false, error: e.message };
        throw e;
    }
}
/** A gene's expressed value (§3.3): the dominant allele when exactly one is, else the floor of their mean. */
export function expressGene(g) {
    if (g.a.dominant && !g.b.dominant)
        return g.a.value;
    if (g.b.dominant && !g.a.dominant)
        return g.b.value;
    return Math.floor((g.a.value + g.b.value) / 2);
}
//# sourceMappingURL=parse.js.map