/**
 * A small, sandboxed formula language for database properties (no eval, no globals).
 *   prop("Price") * prop("Qty")
 *   if(prop("Done"), "✓", "…")
 *   dateBetween(prop("Due"), now(), "days")
 * Operators: + - * / % == != > < >= <= and or not, parentheses. Strings use "..." or '...'.
 */

export type FValue = number | string | boolean | null;

type Token = { t: "num"; v: number } | { t: "str"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError(`Unexpected "${c}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; s += src[j++] ?? ""; }
      if (src[j] !== c) throw new FormulaError("Unclosed text in quotes");
      out.push({ t: "str", v: s });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("+-*/%()<>,!".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new FormulaError(`Unexpected "${c}"`);
  }
  return out;
}

type Node =
  | { k: "lit"; v: FValue }
  | { k: "call"; name: string; args: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node };

const PREC: Record<string, number> = { or: 1, "||": 1, and: 2, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parseFormula(src: string): Node {
  if (src.length > 2000) throw new FormulaError("Formula is too long");
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => { const t = peek(); return !!t && ((t.t === "op" && t.v === v) || (t.t === "id" && t.v === v)); };
  const expect = (v: string) => { if (!isOp(v)) throw new FormulaError(`Expected "${v}"`); p++; };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaError("Formula ends too early");
    if (t.t === "num") return { k: "lit", v: t.v };
    if (t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "op" && t.v === "(") { const e = expr(0); expect(")"); return e; }
    if (t.t === "op" && (t.v === "-" || t.v === "!")) return { k: "un", op: t.v, a: primary() };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" };
      if (t.v === "not") return { k: "un", op: "!", a: primary() };
      if (isOp("(")) {
        p++;
        const args: Node[] = [];
        if (!isOp(")")) { do { args.push(expr(0)); } while (isOp(",") && ++p); }
        expect(")");
        return { k: "call", name: t.v, args };
      }
      throw new FormulaError(`Unknown name "${t.v}"`);
    }
    throw new FormulaError(`Unexpected "${t.v}"`);
  };
  const expr = (min: number): Node => {
    let left = primary();
    for (;;) {
      const t = peek();
      if (!t || (t.t !== "op" && t.t !== "id")) break;
      const prec = PREC[t.v];
      if (!prec || prec <= min) break;
      p++;
      left = { k: "bin", op: t.v, a: left, b: expr(prec) };
    }
    return left;
  };
  const tree = expr(0);
  if (p < toks.length) throw new FormulaError("Unexpected text after the formula");
  return tree;
}

const num = (v: FValue) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : v === null || v === "" ? 0 : Number(v));
const str = (v: FValue) => (v === null ? "" : typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)) : String(v));
const truthy = (v: FValue) => !!v && v !== "false";
const DAY = 86_400_000;

export function evaluateFormula(src: string, getProp: (name: string) => FValue, now = Date.now()): FValue {
  const tree = parseFormula(src);
  let steps = 0;
  const ev = (n: Node): FValue => {
    if (++steps > 10_000) throw new FormulaError("Formula is too complex");
    switch (n.k) {
      case "lit": return n.v;
      case "un": { const a = ev(n.a); return n.op === "-" ? -num(a) : !truthy(a); }
      case "bin": {
        if (n.op === "and" || n.op === "&&") return truthy(ev(n.a)) && truthy(ev(n.b));
        if (n.op === "or" || n.op === "||") return truthy(ev(n.a)) || truthy(ev(n.b));
        const a = ev(n.a), b = ev(n.b);
        switch (n.op) {
          case "+": return typeof a === "string" || typeof b === "string" ? str(a) + str(b) : num(a) + num(b);
          case "-": return num(a) - num(b);
          case "*": return num(a) * num(b);
          case "/": return num(b) === 0 ? null : num(a) / num(b);
          case "%": return num(b) === 0 ? null : num(a) % num(b);
          case "==": return str(a) === str(b);
          case "!=": return str(a) !== str(b);
          case ">": return typeof a === "number" || typeof b === "number" ? num(a) > num(b) : str(a) > str(b);
          case "<": return typeof a === "number" || typeof b === "number" ? num(a) < num(b) : str(a) < str(b);
          case ">=": return typeof a === "number" || typeof b === "number" ? num(a) >= num(b) : str(a) >= str(b);
          case "<=": return typeof a === "number" || typeof b === "number" ? num(a) <= num(b) : str(a) <= str(b);
        }
        throw new FormulaError(`Unknown operator ${n.op}`);
      }
      case "call": {
        const args = () => n.args.map(ev);
        const arity = (k: number) => { if (n.args.length < k) throw new FormulaError(`${n.name}() needs ${k} value${k === 1 ? "" : "s"}`); };
        switch (n.name) {
          case "prop": { arity(1); return getProp(str(ev(n.args[0]))); }
          case "if": { arity(3); return truthy(ev(n.args[0])) ? ev(n.args[1]) : ev(n.args[2]); }
          case "empty": { arity(1); const v = ev(n.args[0]); return v === null || v === "" || v === 0 || v === false; }
          case "concat": return args().map(str).join("");
          case "join": { const [sep, ...rest] = args(); return rest.map(str).join(str(sep)); }
          case "length": { arity(1); return str(ev(n.args[0])).length; }
          case "lower": return str(args()[0] ?? "").toLowerCase();
          case "upper": return str(args()[0] ?? "").toUpperCase();
          case "contains": { arity(2); const [a, b] = args(); return str(a).toLowerCase().includes(str(b).toLowerCase()); }
          case "replaceAll": { arity(3); const [a, b, c] = args(); return str(a).split(str(b)).join(str(c)); }
          case "toNumber": { const v = num(args()[0] ?? null); return Number.isFinite(v) ? v : null; }
          case "format": return str(args()[0] ?? null);
          case "round": { const [v, d] = args(); const f = 10 ** num(d ?? 0); return Math.round(num(v) * f) / f; }
          case "floor": return Math.floor(num(args()[0] ?? 0));
          case "ceil": return Math.ceil(num(args()[0] ?? 0));
          case "abs": return Math.abs(num(args()[0] ?? 0));
          case "sqrt": return Math.sqrt(num(args()[0] ?? 0));
          case "pow": { const [a, b] = args(); return num(a) ** num(b); }
          case "min": return Math.min(...args().map(num));
          case "max": return Math.max(...args().map(num));
          case "sum": return args().reduce<number>((t, v) => t + num(v), 0);
          case "now": return new Date(now).toISOString().slice(0, 16);
          case "today": return new Date(now).toISOString().slice(0, 10);
          case "dateBetween": {
            arity(2);
            const [a, b, unit] = args();
            const ms = Date.parse(str(a)) - Date.parse(str(b));
            if (Number.isNaN(ms)) return null;
            const per = { minutes: 60_000, hours: 3_600_000, days: DAY, weeks: 7 * DAY, months: 30.44 * DAY, years: 365.25 * DAY }[str(unit ?? "days")] ?? DAY;
            return Math.trunc(ms / per);
          }
          case "dateAdd": {
            arity(2);
            const [a, amount, unit] = args();
            const t = Date.parse(str(a));
            if (Number.isNaN(t)) return null;
            const per = { days: DAY, weeks: 7 * DAY, hours: 3_600_000 }[str(unit ?? "days")] ?? DAY;
            return new Date(t + num(amount) * per).toISOString().slice(0, 10);
          }
          case "formatDate": { const t = Date.parse(str(args()[0] ?? null)); return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en", { dateStyle: "medium" }); }
        }
        throw new FormulaError(`Unknown function ${n.name}()`);
      }
    }
  };
  return ev(tree);
}

export const FORMULA_FUNCTIONS = [
  "prop", "if", "empty", "concat", "join", "length", "lower", "upper", "contains", "replaceAll", "toNumber", "format",
  "round", "floor", "ceil", "abs", "sqrt", "pow", "min", "max", "sum", "now", "today", "dateBetween", "dateAdd", "formatDate",
];
