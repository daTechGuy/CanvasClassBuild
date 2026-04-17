/**
 * String helpers shared between the web app (BuildPage) and the headless CLI
 * (scripts/generate-course.ts). Kept deliberately small and side-effect-free
 * so both entry points can import cheaply.
 */

/** Lowercase, hyphenate, clip to 40 chars. For filenames and URL slugs. */
export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * Extract a standalone HTML document from a Claude response that may wrap it
 * in a ```html fence, start mid-prose, or include commentary after </html>.
 */
export function extractHtml(text: string): string {
  const htmlMatch = text.match(/```html\s*\n?([\s\S]*?)\n?```/);
  if (htmlMatch) return htmlMatch[1];
  const trimmed = text.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return trimmed;
  const docIdx = text.indexOf('<!DOCTYPE');
  const htmlIdx = text.indexOf('<html');
  const startIdx = docIdx !== -1 ? docIdx : htmlIdx;
  if (startIdx !== -1) {
    const endIdx = text.lastIndexOf('</html>');
    if (endIdx !== -1) return text.slice(startIdx, endIdx + 7);
    return text.slice(startIdx);
  }
  return text;
}

/**
 * Parse JSON from a Claude response. Tolerates:
 *  - ```json fences
 *  - leading / trailing prose around the object or array
 *  - trailing commas
 *  - occasional unescaped quotes inside strings (up to 10 repair attempts)
 *
 * `wrapType` selects whether we expect an array ('[') or object ('{').
 */
export function parseJson(text: string, wrapType: '[' | '{' = '['): unknown {
  let jsonStr = text;
  const match = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (match) jsonStr = match[1];
  const open = wrapType;
  const close = wrapType === '[' ? ']' : '}';
  const first = jsonStr.indexOf(open);
  const last = jsonStr.lastIndexOf(close);
  if (first !== -1 && last !== -1) jsonStr = jsonStr.slice(first, last + 1);
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      if (e instanceof SyntaxError) {
        const posMatch = e.message.match(/position (\d+)/);
        if (posMatch) {
          const pos = parseInt(posMatch[1]);
          if (pos > 0 && pos < jsonStr.length && jsonStr[pos] === '"') {
            jsonStr = jsonStr.slice(0, pos) + '\\"' + jsonStr.slice(pos + 1);
            continue;
          }
        }
      }
      throw e;
    }
  }
  return JSON.parse(jsonStr);
}
