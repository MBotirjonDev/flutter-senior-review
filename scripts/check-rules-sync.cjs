#!/usr/bin/env node
'use strict';
// Each skill ships its own copy of rules/RULES.md so it works when installed alone.
// This fails CI when a copy drifts from the source.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'rules', 'RULES.md'), 'utf8');
let bad = 0;
for (const s of ['flutter-write', 'flutter-review', 'flutter-port']) {
  const p = path.join(ROOT, 'skills', s, 'references', 'RULES.md');
  if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== src) { console.error(`out of sync: ${path.relative(ROOT, p)} (cp rules/RULES.md ${path.relative(ROOT, p)})`); bad++; }
}
if (!bad) console.log('rules in sync (3 copies)');
process.exitCode = bad ? 1 : 0;
