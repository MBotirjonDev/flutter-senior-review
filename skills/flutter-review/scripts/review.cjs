#!/usr/bin/env node
'use strict';
// flutter-senior-review checker: finds the mechanical rule violations in Dart source.
// Zero dependencies, Node 18+.
// Usage: node review.cjs <path...> [--json | --sarif] [--diff <git-ref> | --diff-file <file>] [--fail-on high|medium|low|none]
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

// Blank out closure bodies and arrow bodies that are passed as arguments, keeping offsets.
function stripClosures(body) {
  const out = body.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  for (const m of body.matchAll(/\([^()]*\)\s*(?:async\s*)?(\{|=>)/g)) {
    const before = body.slice(Math.max(0, m.index - 12), m.index);
    if (/\b(if|for|while|switch|catch)\s*$/.test(before)) continue;
    const start = m.index + m[0].length - m[1].length;
    if (m[1] === '{') { blank(start, matchBrace(body, start) + 1); continue; }
    // Arrow: blank up to the end of the enclosing argument.
    let depth = 0, j = start + 2;
    for (; j < body.length; j++) {
      const c = body[j];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
      else if ((c === ',' || c === ';') && depth === 0) break;
    }
    blank(start, j);
  }
  return out.join('');
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

  // F03: controllers or network calls created inside build().
  for (const m of code.matchAll(/Widget\s+build\s*\(\s*BuildContext\s+\w+\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = code.slice(open, matchBrace(code, open));
    // Ignore code inside callbacks (onPressed: () { ... }, builder: (_) => ...): it does not run on every build.
    const flat = stripClosures(body);
    for (const u of flat.matchAll(/\b(AnimationController|TextEditingController|ScrollController|FocusNode|PageController|TabController|StreamController)\s*\(/g)) {
      add('F03', 'high', open + u.index, `${u[1]} created in build()`, 'Create it in initState and dispose it in dispose().');
    }
    for (const u of flat.matchAll(/\b(?:http\.(?:get|post|put|delete)|dio\.(?:get|post|put|delete)|FirebaseFirestore\.instance\.collection\([^)]*\)\.get)\s*\(/g)) {
      add('F03', 'high', open + u.index, 'network call in build()', 'Load data in initState, a FutureBuilder with a cached Future, or your state layer.');
    }
  }

  // F06: ListView(children: ...) built from a collection.
  for (const m of code.matchAll(/\bListView\s*\(/g)) {
    const args = code.slice(m.index, m.index + 400);
    const ch = /children\s*:\s*([^\n]*)/.exec(args);
    if (ch && /(\.map\s*\(|\bfor\s*\(|List\.generate\s*\()/.test(ch[1] + args.slice(ch.index + ch[0].length, ch.index + ch[0].length + 120))) {
      add('F06', 'medium', m.index, 'ListView(children:) built from a collection', 'Use ListView.builder (or ListView.separated) so items are built lazily.');
    }
  }

  // F15 / F17: initState problems.
  for (const m of code.matchAll(/void\s+initState\s*\(\s*\)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const body = code.slice(open, matchBrace(code, open));
    const flat = stripClosures(body);
    for (const u of flat.matchAll(/\b(Theme|MediaQuery|DefaultTextStyle|Localizations|AppLocalizations|Directionality|ScaffoldMessenger)\.of\s*\(\s*context\b/g)) {
      add('F17', 'high', open + u.index, `${u[1]}.of(context) in initState`, 'Read inherited widgets in didChangeDependencies or build.');
    }
    const asyncMethods = new Set([...code.matchAll(/Future<[^>]*>\s+(_?\w+)\s*\([^)]*\)\s*async\b/g)].map((a) => a[1]));
    for (const u of flat.matchAll(/(^|[;{]\s*)(_?\w+)\s*\(\s*\)\s*;/gm)) {
      if (asyncMethods.has(u[2])) add('F15', 'high', open + u.index + u[1].length, `${u[2]}() started in initState and its errors are dropped`, `Wrap it: unawaited(${u[2]}().catchError(...)) and show the error, or use a FutureBuilder.`);
    }
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
const VERSION = '0.2.0';

// Parse `git diff -U0` output into { file: Set(changed new-side line numbers) }.
function parseDiff(text) {
  const changed = {};
  let file = null;
  for (const line of text.split('\n')) {
    const f = /^\+\+\+ (?:b\/)?(.*)$/.exec(line);
    if (f) { file = f[1] === '/dev/null' ? null : f[1].trim(); if (file) changed[file] = changed[file] || new Set(); continue; }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]), count = h[2] === undefined ? 1 : Number(h[2]);
      for (let n = start; n < start + count; n++) changed[file].add(n);
    }
  }
  return changed;
}

// Keep findings on changed lines. File-level rules (F19, F29) and F04/F11, whose line is the
// start of a block, are kept when any line of that file changed.
const FILE_LEVEL = new Set(['F04', 'F11', 'F19', 'F29']);
function filterByDiff(findings, changed, root = process.cwd()) {
  const norm = (p) => path.relative(root, path.resolve(p)).split(path.sep).join('/');
  return findings.filter((f) => {
    const lines = changed[norm(f.file)];
    if (!lines || !lines.size) return false;
    return FILE_LEVEL.has(f.rule) || lines.has(f.line);
  });
}

function toSarif(findings, root = process.cwd()) {
  const level = { high: 'error', medium: 'warning', low: 'note' };
  const ids = [...new Set(findings.map((f) => f.rule))].sort();
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: {
        name: 'flutter-senior-review',
        version: VERSION,
        informationUri: 'https://github.com/MBotirjonDev/flutter-senior-review',
        rules: ids.map((id) => ({ id, helpUri: `https://github.com/MBotirjonDev/flutter-senior-review/blob/main/rules/RULES.md#${id.toLowerCase()}` })),
      } },
      results: findings.map((f) => ({
        ruleId: f.rule,
        level: level[f.severity],
        message: { text: `${f.message}. Fix: ${f.fix}` },
        locations: [{ physicalLocation: {
          artifactLocation: { uri: path.relative(root, path.resolve(f.file)).split(path.sep).join('/') },
          region: { startLine: f.line },
        } }],
      })),
    }],
  };
}

const USAGE = 'usage: review.cjs <path...> [--json | --sarif] [--diff <git-ref> | --diff-file <file>] [--fail-on high|medium|low|none]';

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  if (args.includes('--version')) { console.log(VERSION); process.exit(0); }
  const failOn = opt('--fail-on') || 'high';
  const valued = new Set(['--fail-on', '--diff', '--diff-file']);
  const paths = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
  if (!paths.length || !RANK[failOn]) { console.error(USAGE); process.exit(2); }
  let findings = review(paths).sort((a, b) => RANK[b.severity] - RANK[a.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  if (opt('--diff') || opt('--diff-file')) {
    let text;
    if (opt('--diff-file')) text = fs.readFileSync(opt('--diff-file'), 'utf8');
    else {
      const cp = require('child_process');
      const top = cp.execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
      text = cp.execFileSync('git', ['diff', '-U0', '--no-color', `${opt('--diff')}...HEAD`, '--', '*.dart'], { encoding: 'utf8', cwd: top, maxBuffer: 64 * 1024 * 1024 });
      findings = filterByDiff(findings, parseDiff(text), top);
      text = null;
    }
    if (text !== null) findings = filterByDiff(findings, parseDiff(text));
  }
  if (args.includes('--sarif')) console.log(JSON.stringify(toSarif(findings), null, 2));
  else if (args.includes('--json')) console.log(JSON.stringify(findings, null, 2));
  else {
    for (const f of findings) console.log(`${f.severity.padEnd(6)} ${f.file}:${f.line}  ${f.rule} ${f.message}\n       fix: ${f.fix}`);
    const by = (s) => findings.filter((f) => f.severity === s).length;
    console.log(`\n${findings.length} findings: ${by('high')} high, ${by('medium')} medium, ${by('low')} low`);
  }
  process.exitCode = findings.some((f) => RANK[f.severity] >= RANK[failOn]) ? 1 : 0;
}

module.exports = { reviewSource, review, mask, parseDiff, filterByDiff, toSarif, VERSION };
