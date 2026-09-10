import { test, assert } from './helpers.mjs';
import { runTidyPipeline } from '../app.mjs';

// Issue #22. Measured live on 2026-09-03: prettyhtml.com returns
//   <p dir="ltr"><span>Hello</span></p>
// for a Google Docs paste. Their TinyMCE layer strips role/aria-level and the
// docs-internal-guid <b> wrapper before any option runs; dir="ltr" survives even
// on their site. We have no such layer, so opt-docs-residue covers both the
// layer-1 compensation and the better-than-parity dir strip.

const DEFAULTS = {
  lowercaseTags: true, lowercaseAttrs: true, sortAttrs: false,
  removeEmptyAttrs: false, fixSelfClosing: true, quoteAttrs: true,
  removeStyles: true, removeClassesIds: true, removeEmptyTags: true,
  removeOneSpaceTags: true, trimWhitespace: true, removeComments: true,
  tagAttributes: false, plainText: false, aiWatermarks: false, smartNbsps: false,
  strayBreaks: true, nestedEmpties: true, docsResidue: true, stripScripts: true,
  blockNewlines: true, straightenQuotes: false,
  removeDataAttrs: false, unwrapSpans: true,
};
const withOpts = (over) => ({ ...DEFAULTS, ...over });

const DOCS_PASTE =
  '<b style="font-weight:normal" id="docs-internal-guid-abc123">' +
  '<p dir="ltr" role="presentation"><span style="font-size:11pt">Hello</span></p>' +
  '<h2 dir="ltr" aria-level="2"><span style="font-weight:700">Head</span></h2></b>';

test('a Google Docs paste comes out clean with the Extra on', () => {
  assert.equal(runTidyPipeline(DOCS_PASTE, DEFAULTS).output, '<p>Hello</p>\n<h2>Head</h2>');
});

test('the Extra off leaves the residue in place', () => {
  const out = runTidyPipeline(DOCS_PASTE, withOpts({ docsResidue: false })).output;
  assert.match(out, /dir="ltr"/);
  assert.match(out, /role="presentation"/);
  assert.match(out, /aria-level="2"/);
});

test('role="presentation" is stripped but other roles are kept', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p role="presentation">a</p>', opts).output, '<p>a</p>');
  assert.equal(runTidyPipeline('<p role="navigation">a</p>', opts).output, '<p role="navigation">a</p>');
});

test('dir="ltr" is stripped but dir="rtl" is kept', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p dir="ltr">a</p>', opts).output, '<p>a</p>');
  assert.equal(runTidyPipeline('<p dir="rtl">a</p>', opts).output, '<p dir="rtl">a</p>');
});

test('the docs-internal-guid wrapper is unwrapped, keeping its children', () => {
  const opts = withOpts({ blockNewlines: false, removeClassesIds: false });
  assert.equal(
    runTidyPipeline('<b id="docs-internal-guid-x"><p>a</p></b>', opts).output,
    '<p>a</p>');
});

test('a real <b> is left alone', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p>a <b>bold</b> c</p>', opts).output, '<p>a <b>bold</b> c</p>');
});

test('a real <b> nested inside the wrapper keeps its own closing tag', () => {
  const opts = withOpts({ blockNewlines: false, removeClassesIds: false });
  assert.equal(
    runTidyPipeline('<b id="docs-internal-guid-x"><p>a <b>real</b> c</p></b>', opts).output,
    '<p>a <b>real</b> c</p>');
});

test('residue attribute values are matched case-insensitively', () => {
  // role= was compared case-sensitively while dir= was lowercased first, so a
  // differently-cased role slipped through where a dir would not.
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<p role="Presentation">a</p>', opts).output, '<p>a</p>');
  assert.equal(runTidyPipeline('<p dir="LTR">a</p>', opts).output, '<p>a</p>');
});

// A span whose only attribute is Docs residue must unwrap, the same as one whose
// only attribute is an inline style. buildTidyTag and the unwrapSpans check share
// isDroppedAttr so the two cannot disagree again. Regression guard: assert with
// the nested-empties fixpoint OFF, since that loop otherwise masks the bug by
// catching the emptied span on a second pass.
const noFixpoint = withOpts({ nestedEmpties: false, blockNewlines: false });

test('a span holding only role="presentation" is unwrapped', () => {
  assert.equal(runTidyPipeline('<p><span role="presentation">x</span></p>', noFixpoint).output,
    '<p>x</p>');
});

test('a span holding only dir="ltr" is unwrapped', () => {
  assert.equal(runTidyPipeline('<p><span dir="ltr">x</span></p>', noFixpoint).output, '<p>x</p>');
});

test('a span holding only aria-level is unwrapped', () => {
  assert.equal(runTidyPipeline('<p><span aria-level="2">x</span></p>', noFixpoint).output,
    '<p>x</p>');
});

test('a span with a surviving attribute is still kept', () => {
  assert.equal(runTidyPipeline('<p><span dir="rtl">x</span></p>', noFixpoint).output,
    '<p><span dir="rtl">x</span></p>');
});

test('residue unwrapping respects the docs-residue toggle', () => {
  const off = withOpts({ nestedEmpties: false, blockNewlines: false, docsResidue: false });
  assert.equal(runTidyPipeline('<p><span dir="ltr">x</span></p>', off).output,
    '<p><span dir="ltr">x</span></p>');
});

test('the docs-internal-guid id prefix is matched case-insensitively', () => {
  // Consistent with the role/dir value matching above.
  const opts = withOpts({ blockNewlines: false, removeClassesIds: false });
  assert.equal(runTidyPipeline('<b id="DOCS-INTERNAL-GUID-X"><p>a</p></b>', opts).output,
    '<p>a</p>');
});

// --- Clipboard furniture (real Safari capture, 2026-09-10) ---
//
// Safari prefixes copied HTML with <head><meta charset="UTF-8"></head>; Chrome
// wraps its fragment in <html><body> with <!--StartFragment--> markers. TinyMCE
// discards both for prettyhtml.com at layer 1 (confirmed: the measured layer1 in
// the google-docs-paste fixture has no head). We have no layer 1, so it rides on
// opt-docs-residue.

test('Safari head/meta prefix is stripped', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<head><meta charset="UTF-8"></head><p>x</p>', opts).output,
    '<p>x</p>');
});

test('a bare leading meta is stripped', () => {
  const opts = withOpts({ blockNewlines: false });
  assert.equal(runTidyPipeline('<meta charset="UTF-8"><p>x</p>', opts).output, '<p>x</p>');
});

test('Chrome fragment markers are stripped even inside html/body', () => {
  // Chrome wraps its fragment in <html><body>, so a document probe that ran
  // first would silently stop handling Chrome pastes.
  const opts = withOpts({ blockNewlines: false });
  assert.equal(
    runTidyPipeline('<html><body><!--StartFragment--><p>x</p><!--EndFragment--></body></html>', opts).output,
    '<p>x</p>');
});

test("a real document's head survives Tidy", () => {
  // The tool tidies whole pages too; a page's <head> is content, not furniture.
  const doc = '<!DOCTYPE html><html><head><title>T</title></head><body><p>x</p></body></html>';
  const out = runTidyPipeline(doc, withOpts({ blockNewlines: false })).output;
  assert.match(out, /<head>/);
  assert.match(out, /<title>T<\/title>/);
});

test('furniture stripping respects the toggle', () => {
  const off = withOpts({ blockNewlines: false, docsResidue: false });
  assert.match(runTidyPipeline('<head><meta charset="UTF-8"></head><p>x</p>', off).output, /<head>/);
});
