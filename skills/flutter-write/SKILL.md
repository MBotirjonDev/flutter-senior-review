---
name: flutter-write
description: Generates new Flutter screens, widgets, state and async flows from scratch while applying 40 senior rules on rebuilds, lifecycle, null safety and theming, then self-checks the result. Use when the user asks to build, add or implement Flutter UI or logic. Not for auditing finished files (use flutter-review) or converting from another framework (use flutter-port).
---

# Write Flutter like a senior

You are writing new Flutter code. The rules are in `references/RULES.md` (F01–F40). Read the
section that matches what you are about to write before you write it, not after.

## Before writing

1. Find the project's conventions and follow them over these rules when they conflict on
   style (state management library, folder layout, naming). Rules marked **high** still apply.
2. Check `pubspec.yaml` for the Flutter/Dart version. `MediaQuery.sizeOf` needs Flutter 3.10+,
   sealed classes and records need Dart 3.
3. If the project has no `analysis_options.yaml`, offer the one from this repo.

## While writing

- **Widgets:** a class per meaningful piece, not `Widget _buildX()` methods (F01). `const`
  everywhere it compiles (F02). build() under 80 lines (F04). Keys on list items (F05).
- **State:** every controller, node and subscription has a matching line in `dispose()` (F11).
  After every `await` in a State: `if (!mounted) return;` before `setState` or `context` (F12, F13).
- **Types:** no `!` to silence the analyzer (F19). Loading/data/error as a sealed class with an
  exhaustive switch (F20), no `default` (F21). Typed models instead of `dynamic` maps (F22).
- **Async:** await or `unawaited(...)` every Future (F25). Catch specific exceptions (F26).
- **Theme:** colors from `Theme.of(context).colorScheme` (F29), text from `textTheme` (F30).
  No fixed heights around text (F31). Tooltips on icon buttons (F33).
- **Structure:** one public widget per file, named after it (F40). Logic in a plain Dart class
  that a unit test can reach (F38).

## After writing

Run the checker on what you wrote and fix every finding before you show the code:

```sh
node <path-to-flutter-review>/scripts/review.cjs lib/
```

If `flutter analyze` is available, run it too. Report what you ran and the result in one line.
Do not claim the code compiles if you did not run the analyzer.
