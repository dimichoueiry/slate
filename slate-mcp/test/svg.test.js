// SVG safety checker tests (PRD v1.1 §7 item 5 — ≥6 cases).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSvg, svgNaturalSize } from '../src/svg.js';

const OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><rect x="10" y="10" width="80" height="60" fill="#1971c2" rx="8"/></svg>';

test('accepts a clean inline svg', () => {
  assert.deepEqual(checkSvg(OK), { ok: true });
});

test('rejects <script>', () => {
  const r = checkSvg('<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /script/i);
});

test('rejects event-handler attributes', () => {
  const r = checkSvg('<svg viewBox="0 0 10 10"><rect onload="alert(1)" width="5" height="5"/></svg>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /event-handler/i);
});

test('rejects foreignObject', () => {
  const r = checkSvg('<svg viewBox="0 0 10 10"><foreignObject><div>hi</div></foreignObject></svg>');
  assert.equal(r.ok, false);
  assert.match(r.reason, /foreignObject/i);
});

test('rejects external href references', () => {
  for (const bad of [
    '<svg viewBox="0 0 10 10"><image href="https://evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 10 10"><image xlink:href="//evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 10 10"><use href="http://evil.example/#icon"/></svg>',
  ]) {
    const r = checkSvg(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.reason, /external/i);
  }
  // internal fragment references stay allowed
  assert.equal(checkSvg('<svg viewBox="0 0 10 10"><defs><g id="a"/></defs><use href="#a"/></svg>').ok, true);
});

test('rejects javascript: URLs and css url() to external hosts', () => {
  assert.equal(checkSvg('<svg viewBox="0 0 10 10"><a href="javascript:alert(1)"><rect/></a></svg>').ok, false);
  assert.equal(checkSvg('<svg viewBox="0 0 10 10"><rect style="fill:url(https://evil.example/f)"/></svg>').ok, false);
  // local gradient url(#id) stays allowed
  assert.equal(checkSvg('<svg viewBox="0 0 10 10"><rect fill="url(#grad)"/></svg>').ok, true);
});

test('rejects non-svg, empty, and oversized documents', () => {
  assert.equal(checkSvg('<div>not svg</div>').ok, false);
  assert.equal(checkSvg('').ok, false);
  assert.equal(checkSvg(undefined).ok, false);
  const huge = `<svg viewBox="0 0 10 10">${'<rect width="1" height="1"/>'.repeat(30000)}</svg>`;
  const r = checkSvg(huge);
  assert.equal(r.ok, false);
  assert.match(r.reason, /exceeds/);
});

test('natural size from viewBox, width/height, or null', () => {
  assert.deepEqual(svgNaturalSize(OK), { w: 100, h: 80 });
  assert.deepEqual(svgNaturalSize('<svg width="120" height="90px"><rect/></svg>'), { w: 120, h: 90 });
  assert.equal(svgNaturalSize('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), null);
});
