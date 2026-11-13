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
