---
name: flutter-review
description: Reviews existing Flutter and Dart code like a senior engineer and reports findings with severity, file:line and a concrete fix, using a zero-dependency checker plus 40 rules on leaks, async gaps, rebuilds and theming. Use when the user asks to review, audit or check Flutter code, a PR or a diff.
---

# Review Flutter like a senior

You are reviewing code someone already wrote. The rules are in `references/RULES.md` (F01–F40).

## Steps

1. **Run the checker** on the files under review. It is plain Node 18+, no install:
   ```sh
   node scripts/review.cjs lib/ --json
   ```
   It detects F01, F03, F04, F06, F09, F11, F12, F13, F15, F17, F19, F29 and F39. It skips `build/`, `test/` and
   generated files (`*.g.dart`, `*.freezed.dart`, `*.mocks.dart`).
2. **Verify every high finding by reading the code.** The checker is regex-based. A controller
   passed in from the parent, or a `setState` from another library, can look like a finding.
   Drop what is not real and say so.
   **For a PR or branch**, report only what the change introduced:
   ```sh
   node scripts/review.cjs lib/ --json --diff origin/main
   ```
   (or `--diff-file pr.diff` with a saved `git diff -U0`). For GitHub code scanning use `--sarif`.
3. **Read the code for the rules the checker cannot see**: keys (F05), side effects in build()
   beyond controllers and network calls (F03), didUpdateWidget (F16), dropped Futures (F25),
   business logic in widgets (F38).
4. **If the project has an `analysis_options.yaml`**, compare it with the one in this repo and
   mention missing high-value lints (`use_build_context_synchronously`, `cancel_subscriptions`,
   `unawaited_futures`).

## Output

Group by severity, highest first. One finding per line:

```
high   lib/home/home_page.dart:42  F12 setState after await without a mounted check
       fix: add `if (!mounted) return;` after `await repo.load();`
```

Then a short summary: counts per severity and the one change that matters most. For a PR or
diff, review only changed lines plus the code they touch. Do not rewrite files unless asked;
offer the fixes.

## Severity

- **high**: crash, leak or wrong behavior (F03, F05, F11–F13, F15, F17, F19, F25, F27).
- **medium**: jank, rebuild cost, accessibility, dark mode.
- **low**: maintainability.
