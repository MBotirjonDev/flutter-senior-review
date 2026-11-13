#!/usr/bin/env node
'use strict';
// Thin wrapper so the repo and the flutter-review skill share one checker.
const target = require.resolve('../skills/flutter-review/scripts/review.cjs');
module.exports = require(target);
if (require.main === module) {
  const r = require('child_process').spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exitCode = r.status ?? 1;
}
