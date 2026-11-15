'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { reviewSource, mask } = require('../scripts/review.cjs');

const rules = (src, file = 'lib/home.dart') => reviewSource(file, src).map((f) => f.rule);
const state = (body) => `class _HomeState extends State<Home> {\n${body}\n}\n`;

test('mask blanks comments and strings but keeps lines', () => {
  const m = mask("a // print(x)\nb = 'print(y)'; /* c */");
  assert.ok(!m.includes('print'));
  assert.strictEqual(m.split('\n').length, 2);
});

test('F01 helper method returning a Widget', () => {
  assert.ok(rules(state('  Widget _buildHeader() => const Text("x");')).includes('F01'));
  assert.ok(!rules(state('  Widget build(BuildContext context) => const Text("x");')).includes('F01'));
});

test('F04 long build()', () => {
  const long = `  Widget build(BuildContext context) {\n${'    x;\n'.repeat(90)}  }`;
  assert.ok(rules(state(long)).includes('F04'));
  assert.ok(!rules(state('  Widget build(BuildContext context) {\n    return x;\n  }')).includes('F04'));
});

test('F09 MediaQuery.of(context).size', () => {
  assert.ok(rules('final w = MediaQuery.of(context).size.width;').includes('F09'));
  assert.ok(!rules('final w = MediaQuery.sizeOf(context).width;').includes('F09'));
});

test('F11 undisposed controllers and uncancelled subscriptions', () => {
  assert.ok(rules(state('  final _c = TextEditingController();')).includes('F11'));
  assert.ok(rules(state('  late final ScrollController _s;\n  StreamSubscription<int>? _sub;')).filter((r) => r === 'F11').length === 2);
  assert.ok(!rules(state('  final _c = TextEditingController();\n  void dispose() { _c.dispose(); super.dispose(); }')).includes('F11'));
});

test('F11 skips controllers owned by the parent widget', () => {
  assert.ok(!rules(state('  late final AnimationController c;\n  void initState() { c = widget.controller; }')).includes('F11'));
  // `widget.x ?? FocusNode()` may create one, so it still needs disposing.
  assert.ok(rules(state('  late FocusNode _f;\n  void initState() { _f = widget.node ?? FocusNode(); }')).includes('F11'));
});

test('F12 setState after await without mounted', () => {
  assert.ok(rules(state('  Future<void> load() async {\n    final d = await repo.get();\n    setState(() => _d = d);\n  }')).includes('F12'));
  assert.ok(!rules(state('  Future<void> load() async {\n    final d = await repo.get();\n    if (!mounted) return;\n    setState(() => _d = d);\n  }')).includes('F12'));
  assert.ok(!rules(state('  Future<void> load() async {\n    setState(() => _busy = true);\n    await repo.get();\n    if (mounted) setState(() => _busy = false);\n  }')).includes('F12'));
});

test('F12 ignores setState outside State classes (other libraries have their own)', () => {
  assert.ok(!rules('class Ctrl extends Notifier<int> {\n  Future<void> go() async {\n    await x();\n    setState((s) => s + 1);\n  }\n}').includes('F12'));
});

test('F13 context after await, including inside synchronous setState and if blocks', () => {
  assert.ok(rules(state('  Future<void> save() async {\n    await repo.save();\n    Navigator.of(context).pop();\n  }')).includes('F13'));
  assert.ok(rules(state('  Future<void> pick() async {\n    final d = await showDatePicker(context: context);\n    setState(() {\n      if (d != null) {\n        ScaffoldMessenger.of(context).showSnackBar(x);\n      }\n    });\n  }')).includes('F13'));
  assert.ok(!rules(state('  Future<void> save() async {\n    await repo.save();\n    if (!context.mounted) return;\n    Navigator.of(context).pop();\n  }')).includes('F13'));
});

test('F13 false positives fixed on real apps', () => {
  // compass_app: context used in the same statement as the await, before the gap.
  assert.ok(!rules('Future<String?> redirect(BuildContext context, S s) async {\n  final ok = await context.read<Auth>().isIn;\n  return ok ? null : "/login";\n}').includes('F13'));
  // localsend: context inside a callback that runs later, not right after the await.
  assert.ok(!rules('Future<void> open(BuildContext context) async {\n  await showDialog(context: context, builder: (_) => AlertDialog(actions: [TextButton(onPressed: () {\n    context.pop();\n  }, child: x)]));\n}').includes('F13'));
});

test('F19 many null assertions', () => {
  assert.ok(rules('void f() { a!.b!.c!.d!.e!.f!.g!.h!.i!; }').includes('F19'));
  assert.ok(!rules('void f() { if (a != b) {} final c = !d; }').includes('F19'));
});

test('F29 hard-coded colors in widget files but not theme files', () => {
  const src = 'Widget build(BuildContext c) => Text("x", style: TextStyle(color: Color(0xFF333333)));';
  assert.ok(rules(src).includes('F29'));
  assert.ok(!rules(src, 'lib/app_theme.dart').includes('F29'));
});

test('F39 print, but not debugPrint or print in strings', () => {
  assert.ok(rules('void f() { print("x"); }').includes('F39'));
  assert.ok(!rules('void f() { debugPrint("x"); log("print(y)"); }').includes('F39'));
});

// ---------- v0.2 ----------
const { parseDiff, filterByDiff, toSarif } = require('../scripts/review.cjs');

test('F03 controllers and network calls in build(), not in callbacks', () => {
  assert.ok(rules(state('  Widget build(BuildContext context) {\n    final c = TextEditingController();\n    return TextField(controller: c);\n  }')).includes('F03'));
  assert.ok(rules('Widget build(BuildContext context) {\n  http.get(url);\n  return x;\n}').includes('F03'));
  assert.ok(!rules('Widget build(BuildContext context) {\n  return ElevatedButton(onPressed: () {\n    http.post(url);\n  }, child: x);\n}').includes('F03'));
  assert.ok(!rules('Widget build(BuildContext context) => ChangeNotifierProvider(create: (_) => FocusNode(), child: x);').includes('F03'));
});

test('F06 ListView(children:) from a collection, not small static lists', () => {
  assert.ok(rules('final l = ListView(children: items.map((i) => Tile(i)).toList());').includes('F06'));
  assert.ok(rules('final l = ListView(\n  children: [\n    for (final i in items) Tile(i),\n  ],\n);').includes('F06'));
  assert.ok(!rules('final l = ListView(children: const [A(), B()]);').includes('F06'));
  assert.ok(!rules('final l = ListView.builder(itemCount: n, itemBuilder: (_, i) => Tile(i));').includes('F06'));
});

test('F17 inherited widgets in initState', () => {
  assert.ok(rules(state('  void initState() {\n    super.initState();\n    _dark = Theme.of(context).brightness == Brightness.dark;\n  }')).includes('F17'));
  assert.ok(!rules(state('  void initState() {\n    super.initState();\n    WidgetsBinding.instance.addPostFrameCallback((_) {\n      _w = MediaQuery.of(context).size;\n    });\n  }')).includes('F17'));
  assert.ok(!rules(state('  void didChangeDependencies() {\n    super.didChangeDependencies();\n    _dark = Theme.of(context).brightness == Brightness.dark;\n  }')).includes('F17'));
});

test('F15 async method started in initState without error handling', () => {
  const load = '  Future<void> _load() async {\n    _d = await repo.get();\n  }\n';
  assert.ok(rules(state(load + '  void initState() {\n    super.initState();\n    _load();\n  }')).includes('F15'));
  assert.ok(!rules(state(load + '  void initState() {\n    super.initState();\n    unawaited(_load().catchError((Object e) {}));\n  }')).includes('F15'));
  assert.ok(!rules(state('  void _init() {}\n  void initState() {\n    super.initState();\n    _init();\n  }')).includes('F15'));
});

test('parseDiff reads changed new-side lines', () => {
  const d = parseDiff('diff --git a/lib/a.dart b/lib/a.dart\n--- a/lib/a.dart\n+++ b/lib/a.dart\n@@ -3,0 +4,2 @@\n+x\n+y\n@@ -10 +12 @@\n-z\n+w\n--- a/lib/old.dart\n+++ /dev/null\n@@ -1,2 +0,0 @@\n');
  assert.deepStrictEqual([...d['lib/a.dart']], [4, 5, 12]);
  assert.strictEqual(d['lib/old.dart'], undefined);
});

test('--diff keeps findings on changed lines and file-level rules of changed files', () => {
  const fs = [
    { rule: 'F39', file: 'lib/a.dart', line: 4 },
    { rule: 'F39', file: 'lib/a.dart', line: 9 },
    { rule: 'F19', file: 'lib/a.dart', line: 1 },
    { rule: 'F39', file: 'lib/b.dart', line: 4 },
  ];
  const kept = filterByDiff(fs, { 'lib/a.dart': new Set([4, 5]) });
  assert.deepStrictEqual(kept.map((f) => `${f.rule}:${f.line}`), ['F39:4', 'F19:1']);
});

test('SARIF output is valid 2.1.0 with levels and locations', () => {
  const s = toSarif([{ rule: 'F12', severity: 'high', file: 'lib/a.dart', line: 7, message: 'm', fix: 'f' }, { rule: 'F39', severity: 'low', file: 'lib/a.dart', line: 2, message: 'p', fix: 'q' }]);
  assert.strictEqual(s.version, '2.1.0');
  const r = s.runs[0];
  assert.deepStrictEqual(r.tool.driver.rules.map((x) => x.id), ['F12', 'F39']);
  assert.deepStrictEqual(r.results.map((x) => x.level), ['error', 'note']);
  assert.strictEqual(r.results[0].locations[0].physicalLocation.artifactLocation.uri, 'lib/a.dart');
  assert.strictEqual(r.results[0].locations[0].physicalLocation.region.startLine, 7);
});

test('CLI --diff-file end to end', () => {
  const os = require('os'); const p = require('path'); const nfs = require('fs'); const cp = require('child_process');
  const dir = nfs.mkdtempSync(p.join(os.tmpdir(), 'fsr-'));
  nfs.mkdirSync(p.join(dir, 'lib'));
  nfs.writeFileSync(p.join(dir, 'lib', 'a.dart'), 'void a() {\n  print(1);\n  print(2);\n}\n');
  nfs.writeFileSync(p.join(dir, 'd.diff'), '+++ b/lib/a.dart\n@@ -2,0 +3 @@\n+  print(2);\n');
  const cli = p.join(__dirname, '..', 'skills', 'flutter-review', 'scripts', 'review.cjs');
  const out = cp.spawnSync(process.execPath, [cli, 'lib', '--json', '--diff-file', 'd.diff', '--fail-on', 'low'], { cwd: dir, encoding: 'utf8' });
  const f = JSON.parse(out.stdout);
  assert.deepStrictEqual(f.map((x) => x.line), [3]);
  assert.strictEqual(out.status, 1);
});
