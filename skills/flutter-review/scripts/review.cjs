#!/usr/bin/env node
'use strict';
// flutter-senior-review checker: finds the mechanical rule violations in Dart source.
// Zero dependencies, Node 18+. Usage: node review.cjs <path...> [--json] [--fail-on high|medium|low|none]
const fs = require('fs');
const path = require('path');

const BUILD_MAX_LINES = 80;
const BANG_MAX = 8;
const DISPOSABLE = /^(AnimationController|TextEditingController|ScrollController|FocusNode|PageController|TabController|TransformationController)$/;

// Replace comments and string contents with spaces, keeping offsets and newlines.
function mask(src) {
  const out = src.split('');
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      const raw = src[i - 1] === 'r';
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < src.length) {
        if (!raw && src[j] === '\\') { j += 2; continue; }
        if (src.startsWith(q, j)) break;
        if (!triple && src[j] === '\n') break;
        j++;
      }
      blank(i + q.length, j);
      i = j + q.length;
      continue;
    }
    i++;
  }
  return out.join('');
}

function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return code.length - 1;
}

function lineOf(code, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (code[i] === '\n') n++;
  return n;
}

function reviewSource(file, src) {
  const code = mask(src);
  const findings = [];
  const add = (rule, severity, idx, message, fix) => findings.push({ rule, severity, file, line: lineOf(code, idx), message, fix });

  // F01: private helper methods that return a Widget.
  for (const m of code.matchAll(/^[ \t]+Widget\s+(_\w+)\s*\(/gm)) {
    add('F01', 'medium', m.index, `helper method ${m[1]}() returns a Widget`, 'Extract a private StatelessWidget class so it can be const and rebuild on its own.');
  }

  // F04: long build methods.
  for (const m of code.matchAll(/Widget\s+build\s*\(\s*BuildContext\s+\w+\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(code, open);
    const lines = lineOf(code, close) - lineOf(code, open) + 1;
    if (lines > BUILD_MAX_LINES) add('F04', 'low', m.index, `build() is ${lines} lines`, `Split it into widgets with clear names (target under ${BUILD_MAX_LINES} lines).`);
  }

  // F09: MediaQuery.of(context).size
  for (const m of code.matchAll(/MediaQuery\.of\(\s*\w+\s*\)\.size\b/g)) {
    add('F09', 'medium', m.index, 'MediaQuery.of(context).size rebuilds on every MediaQuery change', 'Use MediaQuery.sizeOf(context).');
  }

  // F11: disposables in State classes that are never disposed.
  for (const m of code.matchAll(/class\s+(\w+)\s+extends\s+State<\w+>[^{]*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = code.slice(open, matchBrace(code, open) + 1);
    const fields = new Map();
    for (const f of body.matchAll(/(?:final|late|var)\s+(?:final\s+)?(\w+)\??\s+(_?\w+)\s*(?:=|;)/g)) {
      if (DISPOSABLE.test(f[1])) fields.set(f[2], f[1]);
    }
    for (const f of body.matchAll(/(?:final|late|var)\s+(?:final\s+)?(_?\w+)\s*=\s*(\w+)\s*\(/g)) {
      if (DISPOSABLE.test(f[2])) fields.set(f[1], f[2]);
    }
    for (const [name, type] of fields) {
      // Owned by the parent: assigned straight from widget.x (but `widget.x ?? Foo()` is still ours).
      if (new RegExp(`\\b${name}\\s*=\\s*widget\\.\\w+\\s*;`).test(body)) continue;
      if (!new RegExp(`\\b${name}\\s*\\??\\.\\s*dispose\\s*\\(`).test(body)) {
        add('F11', 'high', open + body.indexOf(name), `${type} ${name} is never disposed`, `Call ${name}.dispose() in dispose(), before super.dispose().`);
      }
    }
    for (const f of body.matchAll(/StreamSubscription(?:<[^>]*>)?\??\s+(_?\w+)/g)) {
      if (!new RegExp(`\\b${f[1]}\\s*\\??\\.\\s*cancel\\s*\\(`).test(body)) {
        add('F11', 'high', open + f.index, `StreamSubscription ${f[1]} is never cancelled`, `Call ${f[1]}.cancel() in dispose().`);
      }
    }
  }

  // F12 / F13: setState or context after await without a mounted check.
  // Only inside State classes (other libraries have their own setState), or for F13 in
  // functions that take a BuildContext.
  const stateRanges = [...code.matchAll(/class\s+\w+\s+extends\s+State<\w+>[^{]*\{/g)].map((m) => {
    const o = m.index + m[0].length - 1;
    return [o, matchBrace(code, o)];
  });
  const inState = (i) => stateRanges.some(([a, b]) => i > a && i < b);
  const paramsOf = (closeParen) => {
    let depth = 0;
    for (let i = closeParen; i >= 0; i--) {
      if (code[i] === ')') depth++;
      else if (code[i] === '(') { depth--; if (depth === 0) return code.slice(i, closeParen + 1); }
    }
    return '';
  };
  // True when the end of `seg` sits inside a closure opened within `seg`: such code runs
  // later (a callback), not right after the await.
  // A `{` that opens a function literal: `) {` or `) async {`, but not if/for/while/switch/catch
  // blocks and not setState(() { ... }), which runs synchronously.
  const isCallbackBrace = (seg, i) => {
    const m = /\)\s*(?:async\s*)?$/.exec(seg.slice(0, i));
    if (!m) return false;
    let depth = 0, j = m.index;
    for (; j >= 0; j--) {
      if (seg[j] === ')') depth++;
      else if (seg[j] === '(') { depth--; if (depth === 0) break; }
    }
    if (j < 0) return true;
    const word = (/(\w+)\s*$/.exec(seg.slice(0, j)) || [])[1];
    if (['if', 'for', 'while', 'switch', 'catch'].includes(word)) return false;
    if (/setState\s*\(\s*$/.test(seg.slice(0, j))) return false;
    return true;
  };
  const insideClosure = (seg) => {
    const tail = seg.slice(seg.lastIndexOf(';') + 1);
    if (/=>/.test(tail)) return true;
    let depth = 0;
    const opens = [];
    for (let i = 0; i < seg.length; i++) {
      if (seg[i] === '{') {
        opens.push(isCallbackBrace(seg, i));
        depth++;
      }
      else if (seg[i] === '}') { opens.pop(); depth--; }
    }
    return opens.some(Boolean);
  };
  for (const m of code.matchAll(/\)\s*async\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const state = inState(m.index);
    const takesContext = /\bBuildContext\b/.test(paramsOf(m.index));
    if (!state && !takesContext) continue;
    const close = matchBrace(code, open);
    const body = code.slice(open, close);
    const awaits = [...body.matchAll(/\bawait\b/g)].map((a) => a.index);
    if (!awaits.length) continue;
    const check = (re, rule, msg, fix) => {
      for (const u of body.matchAll(re)) {
        const prev = awaits.filter((a) => a < u.index);
        if (!prev.length) continue;
        const between = body.slice(prev[prev.length - 1], u.index);
        // Same statement as the await (e.g. `await context.read<X>()`): context is used before the gap.
        if (!between.includes(';')) continue;
        if (/\bmounted\b/.test(between)) continue;
        if (insideClosure(between)) continue;
        // Skip uses inside a nested closure that is not itself async-after-await (best effort).
        add(rule, 'high', open + u.index, msg, fix);
      }
    };
    if (state) check(/\bsetState\s*\(/g, 'F12', 'setState after await without a mounted check', 'Add `if (!mounted) return;` after the await.');
    check(/(?:\.of\(\s*context\s*[,)]|\bcontext\s*\.\s*(?:go|push|pop|read|watch)\b|show\w*Dialog\s*\(\s*(?:context\s*:\s*)?context\b)/g, 'F13', 'BuildContext used after await without a mounted check', 'Add `if (!context.mounted) return;` after the await.');
  }

  // F19: many null assertions in one file.
  const bangs = [...code.matchAll(/[\w)\]]!(?![=!])/g)];
  if (bangs.length > BANG_MAX) {
    add('F19', 'medium', bangs[0].index, `${bangs.length} null assertions (!) in this file`, 'Handle the null case with ?., ??, an early return or pattern matching.');
  }

  // F29: hard-coded colors in widget files (not theme files).
  if (/Widget\s+build\s*\(/.test(code) && !/theme|colou?rs?/i.test(path.basename(file))) {
    const colors = [...code.matchAll(/\bColor\(\s*0x[0-9a-fA-F]{6,8}\s*\)/g)];
    if (colors.length) add('F29', 'medium', colors[0].index, `${colors.length} hard-coded Color(0x...) values in a widget file`, 'Read colors from Theme.of(context).colorScheme or a ThemeExtension.');
  }

  // F39: print in app code.
  for (const m of code.matchAll(/(?<![\w.])print\s*\(/g)) {
    add('F39', 'low', m.index, 'print() in app code', 'Use debugPrint or a logger.');
  }
  return findings;
}

function collect(target, out = []) {
  const st = fs.statSync(target);
  if (st.isFile()) { if (target.endsWith('.dart')) out.push(target); return out; }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['build', 'test', 'integration_test'].includes(e.name)) continue;
    if (/\.(g|freezed|gr|mocks)\.dart$/.test(e.name)) continue;
    collect(path.join(target, e.name), out);
  }
  return out;
}

function review(paths) {
  return paths.flatMap((p) => collect(p)).flatMap((f) => reviewSource(f, fs.readFileSync(f, 'utf8')));
}

const RANK = { high: 3, medium: 2, low: 1, none: 99 };

if (require.main === module) {
  const args = process.argv.slice(2);
  const failOn = (args[args.indexOf('--fail-on') + 1] && args.includes('--fail-on')) ? args[args.indexOf('--fail-on') + 1] : 'high';
  const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--fail-on');
  if (!paths.length) { console.error('usage: review.cjs <path...> [--json] [--fail-on high|medium|low|none]'); process.exit(2); }
  const findings = review(paths).sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  if (args.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.file}:${f.line}  ${f.rule} ${f.message}\n       fix: ${f.fix}`);
    const by = (s) => findings.filter((f) => f.severity === s).length;
    console.log(`\n${findings.length} findings: ${by('high')} high, ${by('medium')} medium, ${by('low')} low`);
  }
  process.exitCode = findings.some((f) => RANK[f.severity] >= RANK[failOn]) ? 1 : 0;
}

module.exports = { reviewSource, review, mask };
