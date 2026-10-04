/**
 * Live smoke test for the Gemini backend (src/services/llm/gemini.ts). Unit tests mock
 * `fetch`, so they cannot catch Google changing its API, a model id being retired, or a
 * model rejecting a request field. Run this against the real service:
 *
 *   GEMINI_API_KEY=AIza... npm run smoke:gemini
 *   GEMINI_API_KEY=AIza... GEMINI_MODEL=gemini-3.1-pro-preview npm run smoke:gemini
 *
 * The key is read from the environment and never printed. Checks that need a key are
 * reported SKIPPED without one; the bad-key check always runs (it needs no real key).
 * Exit code is 1 if any check that ran failed.
 *
 * Uses the same code the app uses, so a pass here means the browser path works too —
 * Google answers CORS preflights for the x-goog-api-key header from any origin.
 */
import { streamMessageGemini } from '../src/services/llm/gemini';
import { friendlyError } from '../src/utils/errors';
import { parseJson } from '../src/utils/format';
import { DEFAULT_GEMINI_MODEL } from '../src/services/claude/client';

const KEY = process.env.GEMINI_API_KEY?.trim() ?? '';
const MODEL = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

type Result = { name: string; status: 'PASS' | 'FAIL' | 'SKIPPED'; detail: string };
const results: Result[] = [];

async function check(name: string, needsKey: boolean, fn: () => Promise<string>) {
  if (needsKey && !KEY) {
    results.push({ name, status: 'SKIPPED', detail: 'set GEMINI_API_KEY to run' });
    return;
  }
  try {
    results.push({ name, status: 'PASS', detail: await fn() });
  } catch (e) {
    results.push({ name, status: 'FAIL', detail: (e as Error).message });
  }
}

function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const ask = (prompt: string, extra: Record<string, unknown> = {}) =>
  streamMessageGemini(
    { apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: prompt }], maxTokens: 2000, ...extra },
    {},
  );

console.log(`Gemini smoke test — model: ${MODEL}, key: ${KEY ? 'provided' : 'NOT set'}\n`);

await check('plain text', true, async () => {
  const out = await ask('Reply with exactly one word: pong');
  expect(/pong/i.test(out), `expected "pong", got ${JSON.stringify(out.slice(0, 80))}`);
  return `got ${JSON.stringify(out.trim().slice(0, 40))}`;
});

await check('streams in several chunks', true, async () => {
  let chunks = 0;
  const out = await streamMessageGemini(
    { apiKey: KEY, model: MODEL, messages: [{ role: 'user', content: 'Count from 1 to 40, separated by spaces.' }], maxTokens: 2000 },
    { onText: () => { chunks++; } },
  );
  expect(out.includes('40'), 'did not count to 40');
  return `${chunks} text chunk(s)`;
});

await check('thinking budget accepted (and summaries, if the model offers them)', true, async () => {
  let thoughts = 0;
  const out = await streamMessageGemini(
    {
      apiKey: KEY,
      model: MODEL,
      messages: [{ role: 'user', content: 'What is 17 * 23? Reply with only the number.' }],
      thinkingBudget: 'low',
      maxTokens: 2000,
    },
    { onThinking: () => { thoughts++; } },
  );
  expect(out.includes('391'), `expected 391, got ${JSON.stringify(out.slice(0, 80))}`);
  return `answer ok; ${thoughts ? `${thoughts} thought-summary chunk(s)` : 'no thought summaries (the UI trace stays empty — cosmetic)'}`;
});

await check('structured JSON like the app asks for (quiz)', true, async () => {
  const out = await ask(
    'Write 3 multiple-choice questions about photosynthesis.',
    {
      system:
        'You write quizzes. Return ONLY a JSON array, no prose. Each item: {"question": string, "options": string[4], "correctIndex": 0-3, "explanation": string}.',
      maxTokens: 4000,
    },
  );
  const parsed = parseJson(out) as Array<{ question: string; options: string[]; correctIndex: number }>;
  expect(Array.isArray(parsed) && parsed.length === 3, `expected 3 items, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
  for (const q of parsed) {
    expect(typeof q.question === 'string' && q.options?.length === 4, 'item has the wrong shape');
    expect(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex <= 3, 'bad correctIndex');
  }
  return 'parsed 3 well-formed questions through the app\'s own parseJson';
});

await check('unknown model id → a clear "model not found" message', true, async () => {
  try {
    await streamMessageGemini({ apiKey: KEY, model: 'gemini-this-model-does-not-exist', messages: [{ role: 'user', content: 'hi' }] }, {});
  } catch (e) {
    const friendly = friendlyError(e);
    expect(/model was not found/i.test(friendly), `friendlyError said: ${friendly} (raw: ${(e as Error).message.slice(0, 120)})`);
    return `friendly message: "${friendly}"`;
  }
  throw new Error('expected an error for an unknown model');
});

// Needs no real key: Google must reject it, and we must explain that well.
await check('bad key → "API key rejected" (against Google\'s real error text)', false, async () => {
  try {
    await streamMessageGemini({ apiKey: 'not-a-real-key', model: MODEL, messages: [{ role: 'user', content: 'hi' }] }, {});
  } catch (e) {
    const raw = (e as Error).message;
    const friendly = friendlyError(e);
    expect(/api key rejected/i.test(friendly), `friendlyError said: ${friendly} (raw: ${raw.slice(0, 160)})`);
    return `raw: "${raw.slice(0, 90)}…" → "${friendly}"`;
  }
  throw new Error('expected an error for a bad key');
});

for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name}\n        ${r.detail}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${failed} failed, ${results.filter((r) => r.status === 'SKIPPED').length} skipped`);
process.exit(failed ? 1 : 0);
