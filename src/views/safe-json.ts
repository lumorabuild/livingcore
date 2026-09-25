// JSON that is safe to drop inside a <script> element.
//
// ⚠️ JSON.stringify does NOT escape "<". The HTML tokenizer ends a script
// element at the first "</script" it sees — type="application/ld+json" and
// JSON string quoting do not protect it — so any model-written text that
// reaches a JSON-LD block (scene titles, chapter titles, artifact titles and
// bodies, all of which a visitor's bottle note can steer) could close the
// block and inject live markup. Found by the pre-ship review (2026-09-25).
//
// The \\u escapes below are valid JSON and decode to the same characters, so
// every consumer (search engines, JSON.parse on the client) reads identical data.
export function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
