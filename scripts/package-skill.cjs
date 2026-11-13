#!/usr/bin/env node
'use strict';
/**
 * Builds dist/flutter-senior-review-<version>.zip for marketplaces that take a SKILL.md zip
 * (Agensi, manual installs). Uses the system `zip` command; no npm dependencies.
 *
 *   npm run package:skill
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const { version } = require(path.join(ROOT, 'package.json'));
const SKILLS = ['flutter-write', 'flutter-review', 'flutter-port'];
const dist = path.join(ROOT, 'dist');
const stage = path.join(dist, 'stage');
const out = path.join(dist, `flutter-senior-review-${version}.zip`);

// One zip with all three skills: they share the same rules and are meant to be installed together.
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const s of SKILLS) {
  fs.cpSync(path.join(ROOT, 'skills', s), path.join(stage, s), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(stage, s, 'LICENSE'));
  fs.writeFileSync(path.join(stage, s, 'VERSION'), `${version}\n`);
}
fs.rmSync(out, { force: true });
execFileSync('zip', ['-qr', out, ...SKILLS], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });
console.log(`built ${path.relative(ROOT, out)}`);
