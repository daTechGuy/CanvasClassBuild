# CanvasClassBuild

A fork of [ClassBuild](https://github.com/jtangen/classbuild) (Jason Tangen) retargeted at Canvas LMS: AI-assisted course generation that exports a **Canvas-importable course** (`.imscc`). React 19 SPA with a Node CLI, BYOK (bring your own key) — runs entirely client-side.

Upstream is remote `upstream` (`jtangen/classbuild`); this fork is `origin` (`daTechGuy/CanvasClassBuild`).

## Quick commands

```bash
npm run dev            # dev server at localhost:5173
npm run build          # tsc -b + vite build  (tsc only type-checks src/, NOT tests/)
npm run lint           # ESLint over everything (7 known react-hooks/exhaustive-deps warnings, all pre-existing upstream)
npm test               # vitest (happy-dom). CI runs `test:coverage`
npm run validate:imscc -- file.imscc   # offline structural check of a Canvas cartridge

# Canvas-importable course from a topic + a Canvas template, headless
npx tsx scripts/canvas-course.ts --topic "..." --template ./template.imscc --chapters 8 --output ./out
# Upstream's generic generator
ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-course.ts --topic "Your Topic" --chapters 12 --output ./out
```

CI (`.github/workflows/ci.yml`): `tsc -b` → lint → `test:coverage` → build. `main` is branch-protected with the **"Build + Test"** check required.

## The two Canvas export modes

| | No template | Template-based |
|---|---|---|
| Entry | `assembleImscc()` — `src/services/export/imsccExporter.ts` | `assembleTemplateImscc()` — `src/services/template/templateImsccExporter.ts` |
| Input | the generated course | a Canvas export (`.imscc`) uploaded as a structural template + generated "Canvas Module" content |
| Output | a fresh **native Canvas export** | the template with its verbatim modules intact and pattern modules replaced |

### Rules that are easy to get wrong (all learned from real imports)

- **The `course_settings/canvas_export.txt` marker changes how Canvas reads the package.** Canvas classifies such a package as a *native Canvas export* and reads **only** Canvas's own files — `course_settings/module_meta.xml`, `wiki_content/`, `non_cc_assessments/*.xml.qti`, `<quiz>/assessment_meta.xml` — and **ignores plain Common Cartridge manifest content**. A cartridge with the marker but without those files reports "imported, no issues" and contains only the syllabus and discussions. So: marker ⇒ must emit the full native layout (the no-template exporter does).
- **Quizzes need both QTI flavours** (`<id>/assessment_qti.xml` for the CC profile *and* `non_cc_assessments/<id>.xml.qti` with Canvas metadata: `question_type`, `points_possible`, `original_answer_ids`, `assessment_question_identifierref`) plus `assessment_meta.xml`. Graded quizzes also need an `<assignment>` block referencing an assignment group; the practice quiz is an ungraded `practice_quiz`.
- **Canvas imports every file in `wiki_content/`**, listed in the manifest or not. When the template exporter drops a pattern module, it must delete that module's files (and the metadata resources they depend on) from the archive, or they become stray duplicate pages.
- **Verbatim template modules are passed through byte-for-byte** (`extractRawModuleBlocks`); only `<position>` is renumbered. The parser keeps only a subset of module/item fields, so re-serialising loses things (an external link's `<url>`, LTI link settings, prerequisites, completion requirements). Don't "simplify" this back.
- **Preserve `<dependency>` links and `intendeduse` on manifest resources** — quizzes/discussions lose their metadata without them.
- **In Canvas's own exports, discussion/quiz resources have no `href` attribute** (the file is only in a `<file>` child), sub-headers have no `identifierref`, and external-URL items carry their URL inline with an `identifierref` that matches no resource. Parsers and validators must not assume otherwise.
- **Escape XML and HTML separately** (`escXml` vs `escHtml`); a bare `&` is tolerated by DOM parsers but not by Canvas.
- Identifiers are deterministic (`gid(seed)`), so re-exporting the same course gives the same ids.
- Slide decks are image-driven (one gpt-image-2 render per slide) and rendered images are **not persisted** across reloads. The cartridge only includes `slides.pptx` if every slide is already rendered, or the user explicitly opted in (the Export page asks) — an export click must never silently spend image credits.
- The weekly challenge exports only multiple-choice-shaped questions; other types (assertion-reason, agreement-matrix, slider) are dropped.

### Verifying an export change (do this — don't trust "imported")

1. `npm test` — includes `tests/imscc-validator.test.ts` and `tests/canvas-real-fixtures.test.ts`, which run the validator, parser and template exporter against **real Canvas-made exports** in `tests/fixtures/`.
2. For anything touching `src/services/export/` or `src/services/template/`: import into a real Canvas and *read what it built* — see [`tools/canvas-test/README.md`](tools/canvas-test/README.md) (`cct.sh import …`). CI cannot do this step.

## Project structure

```
src/
├── App.tsx                     # Router — 7 routes (/, /setup, /syllabus, /research, /build, /export, /templates)
├── index.css                   # Tailwind @theme + Codex CSS variables (--cb-*); accent overridden to Canvas red
├── types/                      # course.ts (all data interfaces), template.ts, outline.ts, generation.ts
├── store/                      # Zustand
│   ├── courseStore.ts          #   course state (persisted to IndexedDB via idbStorage)
│   ├── apiStore.ts             #   API keys, provider, research backend, advancedMode (persisted)
│   ├── templateStore.ts        #   uploaded Canvas templates (parsed + raw .imscc blob)
│   └── uiStore.ts              #   transient UI/generation state, in-flight map
├── pages/                      # Landing, Setup, Syllabus, Research, Build, Export, TemplatePreview
├── components/
│   ├── codex/                  #   the design system (CodexButton, CodexModal, ChoicePill…)
│   ├── build/                  #   Build page: tabs/*, useChapterMaterials hook, ArtifactShell, ChapterSidebar
│   ├── setup/, syllabus/, export/, layout/, shared/
├── prompts/                    # prompt builders (syllabus, chapter, quizzes, slides, templateChapter…)
├── services/
│   ├── llm/                    #   provider router: anthropic.ts, ollama.ts, index.ts (the real streaming layer)
│   ├── claude/                 #   SDK client, model ids, thinking budgets; streaming.ts is a thin facade over llm/
│   ├── research/               #   backends: anthropic (web search), tavily, wikipedia; runResearch() dispatch
│   ├── academic/               #   Crossref / Semantic Scholar / Unpaywall source enrichment
│   ├── openai/, elevenLabs/    #   images (gpt-image-2) and narration
│   ├── export/                 #   imsccExporter, validateImscc, pptx/quizDoc/teachingResources/publish exporters
│   ├── template/               #   parser, templateImsccExporter, generateChapter, parseOutlineDocx
│   ├── quiz/, abortRegistry.ts
├── templates/, themes/, fixtures/ (demoCourse), utils/
api/ollama-proxy.ts             # Vercel Edge proxy for Ollama Cloud (CORS)
scripts/                        # CLIs: canvas-course.ts, generate-course.ts, gen-audio.ts, package-scorm.ts …
tools/                          # validate-imscc.ts (CLI), canvas-test/ (Canvas test harness)
tests/                          # vitest; fixtures/ holds real Canvas-made .imscc files
```

## Key conventions

- `tsconfig.app.json` has `erasableSyntaxOnly: true` — no parameter properties; use class field declarations. `noUnusedLocals` / `noUnusedParameters` are on — always run `npm run build`.
- **`tsc -b` only checks `src/`.** Test files are transpiled by vitest but not type-checked; keep them type-correct anyway.
- **Providers (Claude / Ollama Cloud) go through `src/services/llm/`.** `apiStore.provider` picks the backend. Call sites pass Anthropic model ids (`MODELS.opus` …); `resolveProvider` **ignores any `claude-*` model id on the Ollama path** and uses `apiStore.ollamaModel`. Never forward a Claude model id to Ollama.
- **Opus 4.8** uses adaptive thinking (`thinking: {type:'adaptive'}` + `output_config.effort`); manual `budget_tokens` is rejected on Opus ≥4.7. Sonnet/Haiku still use manual budgets. Pass `signal` for cancellation and don't retry an aborted call.
- **`advancedMode`** (apiStore) is "Canvas-focused" (Reading / Practice / Quizzes / Discussion) vs "Everything" (+ Challenge / Activities / Audio / Slides). It gates the visible tabs **and** batch / "Generate all" generation **and** the sidebar's N-of-M count — keep them in step.
- **Don't put an inline `onClose` in an effect dependency list.** `CodexModal` once re-focused the dialog on every keystroke because its effect depended on the caller's inline arrow; it now holds `onClose` in a ref. Same trap anywhere an effect side-effect (focus, scroll) follows a changing callback.
- Web search is a *server tool*: `{ type: 'web_search_20250305', name: 'web_search' }`, not a custom `tool_use` block. Stream events: `server_tool_use` for queries, `web_search_tool_result` for results.
- Template-literal escaping: `\${x}` prevents interpolation; for nested templates `` \` `` yields a literal backtick.
- Heavy modules are code-split with dynamic `import()` (pptx, quiz/challenge templates, image gen, publish exporter, docx).
- Anthropic SDK 0.74.0 with `dangerouslyAllowBrowser: true` (BYOK).

## Models

```typescript
// src/services/claude/client.ts
opus:   'claude-opus-4-8'
sonnet: 'claude-sonnet-4-6'
haiku:  'claude-haiku-4-5-20251001'
```

Syllabus and chapters use Opus with thinking; slides, quizzes and other materials use Sonnet; research uses Haiku with web search.

## How to add a new material type

1. Prompt builder in `src/prompts/newMaterial.ts` — `buildNewMaterialPrompt(themeId?)` and `buildNewMaterialUserPrompt(...)`.
2. Add the generated field to `GeneratedChapter` in `src/types/course.ts`.
3. Generation: add a generator to `src/components/build/useChapterMaterials.ts` (stream via `streamMessage()` from `services/llm`, store with `courseStore.updateChapter()`), a tab component in `src/components/build/tabs/`, and wire the tab into `BuildPage.tsx` (the `tabs` array, the `activeTab` render switch, `SHORTCUT_TAB_IDS`). Decide whether it is advanced-only (`advancedMode`) and gate it everywhere (tab, batch, "Generate all", sidebar count).
4. Export: handle it in `src/services/export/` — and in `imsccExporter.ts` if it should reach Canvas (follow the native-format rules above), with a test.
5. CLI: import the prompt builder in `scripts/generate-course.ts` and add a step to the per-chapter pipeline.
6. `npm run build`, `npm test`.

## Working with git here (gotchas)

- **Merge PRs with a merge commit — never squash or rebase.** Upstream's history is merged into `main`; squashing discards that ancestry and the next upstream sync conflicts again.
- **Syncing upstream:** `git fetch upstream`, merge `upstream/main` on a branch, resolve, run `tsc -b` + lint + `npm test`, then (if export code changed) the Canvas harness. The gap grew to 54/31 commits and a full UI redesign once — sync often.
- Branch protection requires the "Build + Test" check; GitHub won't let the PR author approve their own PR.
- LF→CRLF warnings on Windows are expected (`core.autocrlf=true`, no `.gitattributes`).
- Keep generated cartridges and scratch under the gitignored `output/`.
