---
name: flutter-port
description: Ports a screen or feature from React, React Native, SwiftUI, Jetpack Compose or a web page into idiomatic Flutter, mapping state, effects, lists and styling to their Flutter equivalents instead of translating line by line. Use when the user wants to convert, migrate or rewrite code from another framework into Flutter.
---

# Port to Flutter like a senior

You are converting code from another framework. A literal translation produces Flutter that
compiles and leaks. The rules are in `references/RULES.md` (F01–F40).

## Map concepts, not syntax

| Source | Flutter |
|---|---|
| React component / Compose `@Composable` / SwiftUI `View` | `StatelessWidget`, or `StatefulWidget` only if it owns state (F14) |
| `useState` / `remember { mutableStateOf }` / `@State` | a field in `State`, or the project's state library |
| `useEffect(() => ..., [])` / `LaunchedEffect(Unit)` / `.onAppear` | `initState` with error handling (F15) |
| `useEffect` cleanup / `DisposableEffect` / `.onDisappear` | `dispose()` (F11) |
| `useEffect` on a prop / `LaunchedEffect(key)` | `didUpdateWidget` (F16) |
| `useContext` / `CompositionLocal` / `@Environment` | `InheritedWidget`, `Theme.of`, provider; read in `didChangeDependencies` (F17) |
| `array.map` in JSX / `LazyColumn` / `List` | `ListView.builder` with keys (F05, F06) |
| CSS / `Modifier` / view modifiers | `ThemeData`, `ColorScheme`, `TextTheme` (F29, F30), not inline styles |
| `fetch().then(setState)` | `await`, then `if (!mounted) return;` (F12) |
| `navigate('/x', {state: obj})` | a route with an ID in the path (F35, F36) |
| optional chaining `a?.b ?? c` | the same in Dart; never `!` to make the port compile (F19) |

## Steps

1. Read the whole source first. List its state, side effects, data flow and navigation.
2. Write the Flutter version by meaning, one widget class per component (F01, F40).
3. Keep behavior the same. Keep the visual design unless asked, but express it through the theme.
4. Run the checker on the result and fix every finding:
   ```sh
   node <path-to-flutter-review>/scripts/review.cjs lib/
   ```
5. Report what has no direct equivalent (a web-only API, a platform view, an animation library)
   and what you chose instead.
