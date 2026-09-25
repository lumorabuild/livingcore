// ─────────────────────────────────────────────────────────────────────────────
// SANITIZING A MODEL-WRITTEN SVG.
//
// makePrompt() in prompts.ts asks a model for raw SVG text for "sketch, map,
// diagram, painting, chart, plan-drawing, blueprint" artifacts. That text is
// then published as-is at /made/:id.svg (image/svg+xml) — so it must never be
// able to carry a script, an external reference, or a CSS injection.
//
// Pure string processing on purpose: Workers has no DOM/DOMParser, and a
// hand-rolled tokenizer is easy to reason about (allow-list elements and
// attributes; anything else, including its subtree, is dropped whole).
//
// Adversarial cases this was written against (kept as documentation — there
// is no DOM in Workers to run a real parser-based test against):
//   <svg onload="fetch('https://evil')">                → onload not in the
//                                                           attribute allow-list, dropped
//   <script>fetch('https://evil')</script>               → element not allowed;
//                                                           its whole subtree (the fetch
//                                                           call as text) is skipped, not
//                                                           just the tag
//   <image href="https://evil/track.png"/>                → element not allowed, dropped
//   <a href="javascript:alert(1)"><circle .../></a>       → <a> not allowed → pushed
//                                                           onto the skip stack, so the
//                                                           circle INSIDE it is dropped
//                                                           too (matches "the a can't be
//                                                           snuck past by hiding something
//                                                           legitimate inside it")
//   <rect fill="url(#evil)"/>                              → forbidden substring "url(" in
//                                                           the value → attribute dropped
//                                                           (rect kept, unfilled)
//   <path d="M0,0 L10,10" style="background:url(javascript:alert(1))"/>
//                                                          → `style` is not an allowed
//                                                           attribute at all, dropped
//                                                           whole regardless of content
//   <text>&lt;script&gt;</text> (already-escaped text)    → text content is escaped AGAIN
//                                                           on output, so it always renders
//                                                           as literal characters, never
//                                                           parses as markup
//   <svg><!-- <script>evil</script> --><circle .../></svg>
//                                                          → comments are dropped outright
//                                                           (their content never reaches
//                                                           the tokenizer's tag/text logic)
//   A 40 KB SVG of a thousand tiny circles                → rejected: MAX_OUTPUT_BYTES
//   <svg><g><g><g></g></g></g></svg> (no real drawing)    → rejected: fewer than 3
//                                                           drawing elements
//   <svg width="1e9" height="1e9">...</svg>               → "1e9" fails NUMBER_RE
//                                                           (no exponent form allowed),
//                                                           attribute dropped
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'tspan', 'title',
]);

/** Elements that count toward "this is actually a drawing", not just structure/text. */
const DRAWING_ELEMENTS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text']);

const ALLOWED_ATTRS = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor',
  'dominant-baseline',
  // NOT xmlns: model output must never choose the document's namespace (an
  // XHTML xmlns on the root re-interprets every element). The sanitizer always
  // writes the canonical SVG namespace itself. (Pre-ship review, 2026-09-25.)
]);

/** Attributes that must be a plain number (optionally with a trailing %) — no units, no exponent form, no expressions. */
const STRICT_NUMERIC_ATTRS = new Set([
  'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size',
]);

const NUMBER_RE = /^-?\d+(\.\d+)?%?$/;
const FORBIDDEN_VALUE_RE = /url\(|javascript:|data:|&|<|expression/i;
const MAX_ATTR_LEN = 4000;
const MAX_OUTPUT_BYTES = 20 * 1024;
const MIN_DRAWING_ELEMENTS = 3;

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sanitizeAttrValue(name: string, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // A control character anywhere is refusal, not something to strip: browsers
  // drop tab/CR/LF inside URL schemes, so "java<newline>script:" slips past a
  // literal substring test. Nothing a pen-and-ink drawing needs contains one.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;
  if (FORBIDDEN_VALUE_RE.test(value) || FORBIDDEN_VALUE_RE.test(value.replace(/\s+/g, ''))) return null;
  if (STRICT_NUMERIC_ATTRS.has(name)) return NUMBER_RE.test(value) ? value : null;
  return value.length > MAX_ATTR_LEN ? null : value;
}

function parseAttrs(attrStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z_:][\w:.-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrStr))) {
    const name = (m[1] || m[3] || '').toLowerCase();
    if (!name) continue;
    out[name] = m[2] !== undefined ? m[2] : m[4] || '';
  }
  return out;
}

/** `<name attrs...` (or `<name attrs.../` for self-closing) already stripped of the leading `<` and trailing `>`. */
function parseOpenTag(inner: string): { name: string; attrStr: string; selfClosed: boolean } | null {
  const m = /^([a-zA-Z][\w:-]*)([\s\S]*)$/.exec(inner);
  if (!m) return null;
  let body = m[2];
  let selfClosed = false;
  if (/\/\s*$/.test(body)) {
    selfClosed = true;
    body = body.replace(/\/\s*$/, '');
  }
  return { name: m[1].toLowerCase(), attrStr: body, selfClosed };
}

/**
 * A pen-and-ink SVG the narrator/maker chain hands back as raw text. Extracts
 * the first `<svg>…</svg>`, tokenises it, and keeps only an allow-listed
 * element/attribute set — everything else (and, for a disallowed ELEMENT, its
 * entire subtree) is dropped, never half-fixed. Returns null if the result
 * isn't usable: too big, or not actually a drawing (fewer than 3 real marks).
 */
export function sanitizeSvg(text: string): string | null {
  if (!text) return null;
  const match = /<svg[\s\S]*?<\/svg>/i.exec(text);
  if (!match) return null;
  const src = match[0];

  // Comments / CDATA / close tags / open-or-self-closing tags / plain text runs.
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/[a-zA-Z][\w:-]*\s*>|<[a-zA-Z][^<>]*>|[^<]+/g;

  const out: string[] = [];
  const skipStack: string[] = [];
  let drawingCount = 0;
  let sawSvgOpen = false;

  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(src))) {
    const token = m[0];

    if (token.startsWith('<!--') || token.startsWith('<![CDATA[')) continue;

    if (skipStack.length > 0) {
      if (token.startsWith('</')) {
        const name = token.slice(2, -1).trim().toLowerCase();
        if (name === skipStack[skipStack.length - 1]) skipStack.pop();
      } else if (token.startsWith('<')) {
        const parsed = parseOpenTag(token.slice(1, -1));
        if (parsed && !parsed.selfClosed && parsed.name === skipStack[skipStack.length - 1]) {
          skipStack.push(parsed.name); // same-name nesting inside the dropped subtree
        }
      }
      continue; // inside a dropped element: tags AND text are both dropped
    }

    if (!token.startsWith('<')) {
      out.push(escapeText(token));
      continue;
    }

    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim().toLowerCase();
      if (ALLOWED_ELEMENTS.has(name)) out.push(`</${name}>`);
      continue;
    }

    const parsed = parseOpenTag(token.slice(1, -1));
    if (!parsed) continue;
    const { name, attrStr, selfClosed } = parsed;

    if (!ALLOWED_ELEMENTS.has(name)) {
      if (!selfClosed) skipStack.push(name);
      continue;
    }

    if (name === 'svg') sawSvgOpen = true;
    if (DRAWING_ELEMENTS.has(name)) drawingCount++;

    const rawAttrs = parseAttrs(attrStr);
    const cleanAttrs: string[] = [];
    let hasViewBox = false;
    let hasXmlns = false;
    for (const [attrName, attrValue] of Object.entries(rawAttrs)) {
      if (!ALLOWED_ATTRS.has(attrName)) continue;
      const clean = sanitizeAttrValue(attrName, attrValue);
      if (clean === null) continue;
      if (attrName === 'viewBox') hasViewBox = true;
      if (attrName === 'xmlns') hasXmlns = true;
      cleanAttrs.push(`${attrName}="${clean.replace(/"/g, '&quot;')}"`);
    }
    if (name === 'svg') {
      if (!hasViewBox) cleanAttrs.push('viewBox="0 0 400 300"');
      if (!hasXmlns) cleanAttrs.push('xmlns="http://www.w3.org/2000/svg"');
    }

    const attrsOut = cleanAttrs.length ? ` ${cleanAttrs.join(' ')}` : '';
    out.push(selfClosed ? `<${name}${attrsOut}/>` : `<${name}${attrsOut}>`);
  }

  if (!sawSvgOpen || drawingCount < MIN_DRAWING_ELEMENTS) return null;

  const result = out.join('');
  if (new TextEncoder().encode(result).length > MAX_OUTPUT_BYTES) return null;
  return result;
}
