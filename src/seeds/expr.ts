/**
 * SEEDO expressions (§3.4): tokens, the grammar, the size and depth limits,
 * and the integer semantics. An expression compiles to a function of an
 * environment of slots: every name in use is given an index when the DNA is
 * parsed, so evaluating a name is an array read, not a property lookup.
 */
import { SEEDO_LIMITS, SEEDO_RESERVED } from './constants.js'

/** Values by slot: built-ins, genes, lets and rule parameters, at the indices the DNA's `slots` gives them. */
export type SeedEnv = number[]

/** The names in use where an expression stands, each with its slot. */
export type SeedScope = ReadonlyMap<string, number>

/** A compiled expression, with its node count `n` and depth `d` (§3.4). */
export interface SeedExpr {
  (env: SeedEnv): number
  readonly n: number
  readonly d: number
}

/** A text that breaks a rule of §3: a reader MUST NOT grow it. */
export class SeedoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SeedoError'
  }
}

/** The whitespace §3.1 trims from the ends of a line. */
export const WS = '[\\t\\n\\v\\f\\r ]'
const TRIM_RE = new RegExp('^' + WS + '+|' + WS + '+$', 'g')
export const trimWS = (s: string): string => s.replace(TRIM_RE, '')

const V = SEEDO_LIMITS.value
export const clampValue = (v: number): number => v > V ? V : v < -V ? -V : v

const mk = (fn: (e: SeedEnv) => number, n: number, d: number): SeedExpr => {
  const f = fn as SeedExpr & { n: number; d: number }
  f.n = n; f.d = d
  return f
}
const bin = (fn: (e: SeedEnv) => number, l: SeedExpr, r: SeedExpr): SeedExpr => mk(fn, l.n + r.n + 1, 1 + Math.max(l.d, r.d))

const CMP = ['==', '!=', '<', '<=', '>', '>=']
const DIGITS = /^\d+$/
const NAME_START = /^[A-Za-z_]/

/**
 * Compile one expression. `scope` maps each name in use where it stands to its
 * slot; `where` prefixes every error. Throws SeedoError on any text §3.4
 * refuses, and refuses nesting past the depth limit before its stack grows.
 */
export function compileExpr(src: string, scope: SeedScope, where: string): SeedExpr {
  const toks: string[] = []
  const re = new RegExp(WS + '*(\\d+|[A-Za-z_][A-Za-z_0-9]*|==|!=|<=|>=|[-+*/%<>()])', 'y')
  const s = trimWS(src)
  while (re.lastIndex < s.length) {
    const at = re.lastIndex
    const m = re.exec(s)
    if (!m) throw new SeedoError(where + ': cannot read "' + s.slice(at) + '"')
    toks.push(m[1])
  }
  let i = 0
  const peek = (): string | undefined => toks[i]
  const next = (): string | undefined => toks[i++]
  // The parser recurses only through "(", unary "-" and "not"; each adds at least one to the depth,
  // so a text that nests past the limit is invalid and is refused before the stack grows.
  let level = 0
  const enter = (): void => { if (++level > SEEDO_LIMITS.exprDepth) throw new SeedoError(where + ': an expression is deeper than ' + SEEDO_LIMITS.exprDepth) }

  function or(): SeedExpr {
    let a = and()
    while (peek() === 'or') { next(); const l = a, r = and(); a = bin((e) => (l(e) || r(e)) ? 1 : 0, l, r) }
    return a
  }
  function and(): SeedExpr {
    let a = not()
    while (peek() === 'and') { next(); const l = a, r = not(); a = bin((e) => (l(e) && r(e)) ? 1 : 0, l, r) }
    return a
  }
  function not(): SeedExpr {
    if (peek() === 'not') { next(); enter(); const a = not(); level--; return mk((e) => a(e) ? 0 : 1, a.n + 1, a.d + 1) }
    return cmp()
  }
  function cmp(): SeedExpr {
    const a = add()
    const op = peek()
    if (op !== undefined && CMP.includes(op)) {
      next()
      const b = add()
      switch (op) {
        case '==': return bin((e) => a(e) === b(e) ? 1 : 0, a, b)
        case '!=': return bin((e) => a(e) !== b(e) ? 1 : 0, a, b)
        case '<': return bin((e) => a(e) < b(e) ? 1 : 0, a, b)
        case '<=': return bin((e) => a(e) <= b(e) ? 1 : 0, a, b)
        case '>': return bin((e) => a(e) > b(e) ? 1 : 0, a, b)
        default: return bin((e) => a(e) >= b(e) ? 1 : 0, a, b)
      }
    }
    return a
  }
  function add(): SeedExpr {
    let a = mul()
    while (peek() === '+' || peek() === '-') {
      const op = next(), l = a, r = mul()
      a = op === '+' ? bin((e) => clampValue(l(e) + r(e)), l, r) : bin((e) => clampValue(l(e) - r(e)), l, r)
    }
    return a
  }
  function mul(): SeedExpr {
    let a = un()
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(), l = a, r = un()
      if (op === '*') a = bin((e) => clampValue(l(e) * r(e)), l, r)
      else if (op === '/') a = bin((e) => { const d = r(e); return d === 0 ? 0 : Math.trunc(l(e) / d) }, l, r)
      else a = bin((e) => { const d = r(e); if (d === 0) return 0; const v = l(e) % d; return v < 0 ? v + Math.abs(d) : v }, l, r)
    }
    return a
  }
  function un(): SeedExpr {
    if (peek() === '-') { next(); enter(); const a = un(); level--; return mk((e) => -a(e), a.n + 1, a.d + 1) }
    return atom()
  }
  function atom(): SeedExpr {
    const t = next()
    if (t === undefined) throw new SeedoError(where + ': expression ends early')
    if (t === '(') {
      enter()
      const a = or()
      level--
      if (next() !== ')') throw new SeedoError(where + ': missing )')
      // parentheses are no node and add one to the depth: no wrapper, the same function one deeper
      ;(a as { d: number }).d = a.d + 1
      return a
    }
    if (DIGITS.test(t)) { const v = clampValue(parseInt(t, 10)); return mk(() => v, 1, 1) }
    if (SEEDO_RESERVED.includes(t)) throw new SeedoError(where + ': unexpected "' + t + '"')
    if (NAME_START.test(t)) {
      const slot = scope.get(t)
      if (slot === undefined) throw new SeedoError(where + ': unknown name "' + t + '"')
      return mk((e) => e[slot], 1, 1)
    }
    throw new SeedoError(where + ': unexpected "' + t + '"')
  }

  const f = or()
  if (i < toks.length) throw new SeedoError(where + ': unexpected "' + toks[i] + '"')
  if (f.n > SEEDO_LIMITS.exprNodes) throw new SeedoError(where + ': an expression has more than ' + SEEDO_LIMITS.exprNodes + ' nodes')
  if (f.d > SEEDO_LIMITS.exprDepth) throw new SeedoError(where + ': an expression is deeper than ' + SEEDO_LIMITS.exprDepth)
  return f
}
