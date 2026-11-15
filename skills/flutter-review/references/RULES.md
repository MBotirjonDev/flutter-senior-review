# Flutter senior review rules

40 rules, each with why, a bad snippet and a good snippet. Rules marked **[checked]** are
detected in source by `scripts/review.cjs`; the rest need judgement.

Severity: **high** = crash, leak or wrong behavior; **medium** = jank, rebuild cost or
accessibility; **low** = maintainability.

## Widgets and build()

### F01 Split widgets into classes, not helper methods (medium) [checked]
Why: a `Widget _buildX()` method rebuilds with its parent and cannot be `const`; a class has
its own element, can be `const` and skips rebuilds.
```dart
// Bad
Widget _buildHeader() => Text(title);
// Good
class _Header extends StatelessWidget {
  const _Header({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) => Text(title);
}
```

### F02 Use const constructors wherever possible (medium)
Why: a `const` subtree is canonicalized and skipped on rebuild.
```dart
// Bad
Padding(padding: EdgeInsets.all(16), child: Text('Hi'))
// Good
const Padding(padding: EdgeInsets.all(16), child: Text('Hi'))
```

### F03 Keep build() pure and cheap (high) [checked]
Why: build runs on every frame that needs it. No I/O, no controllers, no subscriptions.
```dart
// Bad
Widget build(BuildContext context) {
  final c = TextEditingController();
  http.get(url);
  return TextField(controller: c);
}
// Good: create controllers in initState, load data outside build.
```

### F04 Keep build() short (low) [checked]
Why: a 150-line build mixes layout, logic and state. Split by meaning.
```dart
// Bad: one build() with 140 lines of nested Columns
// Good: build() composes _Header, _StatsRow, _HabitList
```

### F05 Give list items stable keys (high)
Why: without keys, reordering or removing items reuses the wrong State.
```dart
// Bad
ListView(children: [for (final t in todos) TodoTile(todo: t)])
// Good
ListView(children: [for (final t in todos) TodoTile(key: ValueKey(t.id), todo: t)])
```

### F06 Use ListView.builder for long or unbounded lists (medium) [checked]
Why: `ListView(children: ...)` builds every child up front.
```dart
// Bad
ListView(children: items.map((i) => ItemTile(item: i)).toList())
// Good
ListView.builder(itemCount: items.length, itemBuilder: (_, i) => ItemTile(item: items[i]))
```

### F07 Avoid Opacity and ClipRRect in animated or scrolling paths (medium)
Why: they force offscreen layers. Fade with FadeTransition, round with decoration.
```dart
// Bad
Opacity(opacity: anim.value, child: card)
// Good
FadeTransition(opacity: anim, child: card)
```

### F08 Prefer SizedBox and ColoredBox over bare Container (low)
Why: Container builds several widgets; the narrow widget says what you mean.
```dart
// Bad
Container(height: 16)
// Good
const SizedBox(height: 16)
```

### F09 Use MediaQuery.sizeOf, not MediaQuery.of(context).size (medium) [checked]
Why: `MediaQuery.of` rebuilds on every MediaQuery change (keyboard, padding, text scale).
```dart
// Bad
final w = MediaQuery.of(context).size.width;
// Good
final w = MediaQuery.sizeOf(context).width;
```

### F10 Use LayoutBuilder for widget-level breakpoints (low)
Why: the screen width is not the space your widget has.
```dart
// Good
LayoutBuilder(builder: (context, c) => c.maxWidth > 600 ? const _Wide() : const _Narrow())
```

## State and lifecycle

### F11 Dispose every controller, node and subscription (high) [checked]
Why: AnimationController, TextEditingController, ScrollController, FocusNode, StreamSubscription
leak and keep tickers running.
```dart
// Bad: _controller created in initState, no dispose()
// Good
@override
void dispose() {
  _controller.dispose();
  _sub.cancel();
  super.dispose();
}
```

### F12 Check mounted before setState after await (high) [checked]
Why: the widget may be gone when the Future completes; setState then throws.
```dart
// Bad
final data = await repo.load();
setState(() => _data = data);
// Good
final data = await repo.load();
if (!mounted) return;
setState(() => _data = data);
```

### F13 Do not use BuildContext across async gaps (high) [checked]
Why: after await, the context may belong to a disposed widget.
```dart
// Bad
await save();
Navigator.of(context).pop();
// Good
await save();
if (!context.mounted) return;
Navigator.of(context).pop();
```

### F14 Lift state only as far as needed (medium)
Why: state at the top of the tree rebuilds the whole tree. Keep it next to its readers.
```dart
// Bad: the whole page is a StatefulWidget because one checkbox toggles
// Good: the checkbox row owns its bool
```

### F15 Do not start async work in initState without handling errors (high) [checked]
Why: an exception from an unawaited Future in initState is silently lost.
```dart
// Bad
void initState() { super.initState(); _load(); }
// Good
void initState() {
  super.initState();
  unawaited(_load().catchError((Object e) { if (mounted) setState(() => _error = e); }));
}
```

### F16 Update derived state in didUpdateWidget (medium)
Why: State outlives widget configurations; changing a parameter does not rerun initState.
```dart
// Good
@override
void didUpdateWidget(covariant Counter old) {
  super.didUpdateWidget(old);
  if (old.duration != widget.duration) _c.duration = widget.duration;
}
```

### F17 Read inherited widgets in didChangeDependencies, not initState (high) [checked]
Why: `Theme.of`/`MediaQuery.of` in initState throws or misses updates.
```dart
// Good
@override
void didChangeDependencies() {
  super.didChangeDependencies();
  _reduceMotion = MediaQuery.of(context).disableAnimations;
}
```

### F18 No logic in createState (low)
Why: createState can be called more than once; it must only return a new State.

## Null safety and types

### F19 Do not paper over nulls with `!` (high) [checked]
Why: each `!` is a crash you chose not to handle.
```dart
// Bad
Text(user!.name!)
// Good
final name = user?.name;
if (name == null) return const SizedBox.shrink();
return Text(name);
```

### F20 Model states with sealed classes and switch (medium)
Why: the compiler then checks every case. No `isLoading && error == null && data != null`.
```dart
// Good
sealed class Load<T> {}
final class Loading<T> extends Load<T> {}
final class Loaded<T> extends Load<T> { Loaded(this.data); final T data; }
final class Failed<T> extends Load<T> { Failed(this.error); final Object error; }

Widget view(Load<User> s) => switch (s) {
  Loading() => const CircularProgressIndicator(),
  Loaded(:final data) => Text(data.name),
  Failed(:final error) => ErrorView(error),
};
```

### F21 No default case on sealed or enum switches (medium)
Why: `default` hides the new case you add next month.

### F22 Avoid dynamic (medium)
Why: `dynamic` turns type errors into runtime crashes. Parse JSON into typed models.
```dart
// Bad
final json = jsonDecode(body); Text(json['name'])
// Good
final user = User.fromJson(jsonDecode(body) as Map<String, Object?>);
```

### F23 Prefer final fields and locals (low)
Why: fewer things can change behind your back.

### F24 Use records for small multi-value returns (low)
```dart
// Good
(int, String) parse(String s) => (int.parse(s.split(':')[0]), s.split(':')[1]);
```

## Async

### F25 Await or explicitly unawait every Future (high)
Why: a dropped Future swallows its error.
```dart
// Bad
analytics.log('open');
// Good
unawaited(analytics.log('open'));
```

### F26 Catch specific errors (medium)
Why: `catch (e)` also catches programming errors you want to see.
```dart
// Good
try { await repo.save(item); } on SocketException { showOffline(); }
```

### F27 Cancel stream subscriptions and close controllers (high)
Why: open streams keep objects alive and keep firing callbacks.

### F28 Do not await in a loop when calls are independent (medium)
```dart
// Bad
for (final id in ids) { await fetch(id); }
// Good
await Future.wait(ids.map(fetch));
```

## Theming and UI

### F29 Colors come from the theme (medium) [checked]
Why: hard-coded colors break dark mode and rebranding.
```dart
// Bad
Text('Hi', style: TextStyle(color: Color(0xFF333333)))
// Good
Text('Hi', style: TextStyle(color: Theme.of(context).colorScheme.onSurface))
```

### F30 Text styles come from the TextTheme (medium)
```dart
// Bad
TextStyle(fontSize: 22, fontWeight: FontWeight.bold)
// Good
Theme.of(context).textTheme.titleLarge
```

### F31 Respect text scaling (medium)
Why: fixed heights around text clip it for users with larger fonts.
```dart
// Bad
SizedBox(height: 40, child: Text(label))
// Good: let text size itself; use minHeight constraints if needed
```

### F32 Touch targets are at least 48x48 (medium)
```dart
// Good
IconButton(icon: const Icon(Icons.close), onPressed: close) // 48 dp by default
```

### F33 Label icons and images for screen readers (medium)
```dart
// Bad
IconButton(icon: const Icon(Icons.delete), onPressed: remove)
// Good
IconButton(icon: const Icon(Icons.delete), tooltip: 'Delete', onPressed: remove)
```

### F34 Respect reduce motion (low)
Why: some users get sick from motion. Check `MediaQuery.disableAnimationsOf(context)`.

## Navigation and structure

### F35 Navigate with routes, not by rebuilding the tree with flags (medium)
Why: a `bool showDetails` in a parent breaks back button, deep links and state.

### F36 Pass IDs through routes, not whole objects (low)
Why: deep links and restoration only have the URL.
```dart
// Good (go_router)
context.go('/habits/${habit.id}');
```

### F37 Organize by feature, not by type (low)
```text
// Bad: lib/screens, lib/widgets, lib/models with 60 files each
// Good: lib/habits/{habit_list.dart, habit_repository.dart, habit.dart}
```

### F38 No business logic in widgets (medium)
Why: logic in onPressed cannot be tested without pumping widgets. Move it to a class.

### F39 Do not print in production code (low) [checked]
Why: `print` writes to device logs in release builds. Use a logger or debugPrint.

### F40 One public widget per file, file named after it (low)
Why: `habit_card.dart` contains `HabitCard`; finding code becomes free.
