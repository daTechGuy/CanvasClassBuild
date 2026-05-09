<!--
  keywords: canvas lms, common cartridge, imscc export, course builder, ai course generator, instructure canvas
  fork-of: https://github.com/jtangen/classbuild
  repository: https://github.com/daTechGuy/CanvasClassBuild
-->

# CanvasClassBuild

**An AI-assisted Canvas course builder.** Upload a Canvas course template, describe your course, get an `.imscc` ready to import.

A fork of [ClassBuild](https://github.com/jtangen/classbuild) by Jason Tangen, retargeted at instructors who need to ship Canvas-shaped courses fast.

> **⚙️ Active development on the [`imscc-export`](https://github.com/daTechGuy/CanvasClassBuild/tree/imscc-export) branch.** This `main` branch tracks upstream `jtangen/classbuild`. Switch to `imscc-export` for the Canvas template + IMSCC export work, the Ollama Cloud / Tavily / Wikipedia provider options, the course-outline DOCX parsing, and the rebrand.

> **Compatible with Canvas LMS — not affiliated with Instructure, Inc.** Canvas® is a registered trademark of Instructure, Inc.

---

## What CanvasClassBuild adds on top of ClassBuild

| Capability | Status |
|---|---|
| Upload a Canvas `.imscc` template, parse the module structure, classify modules as `verbatim` / `pattern` / `example-pattern` | ✅ |
| Generate per-chapter Canvas Module content (1× Module Overview, 1+ MN Instructor Notes, 1× MN Discussion) | ✅ |
| Batch generation: "Generate All Canvas Modules" for the whole course at once | ✅ |
| Export an `.imscc` that mirrors the template's structure: verbatim modules carry through untouched, pattern modules replaced by generated content, LTI links + web_resources passed through | ✅ |
| Upload a course-outline `.docx` and have an LLM extract title / description / course information / course materials → populates Canvas's Syllabus tab body at export time | ✅ |
| Pluggable LLM provider — **Anthropic (Claude)** or **Ollama Cloud** for course-content generation | ✅ |
| Pluggable research backend — **Claude web search**, **Tavily**, or **Wikipedia** | ✅ |
| Auto-publish quizzes & discussions on Canvas import (Canvas-extension sidecar XMLs) | ✅ |
| Advanced-mode toggle — hides multimedia outputs (slides, audio, infographic, weekly challenge, activities) by default to keep the Canvas-focused happy path tight | ✅ |

## Install

```bash
git clone https://github.com/daTechGuy/CanvasClassBuild.git
cd CanvasClassBuild
git switch imscc-export        # active development branch
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173).

**Bring Your Own Key** — keys are entered through the Setup page and never leave your browser. There is no server-side component except a Vite dev proxy that exists solely to bypass Ollama Cloud's missing browser CORS headers.

## API keys

| Provider | Required when… | What it does |
|---|---|---|
| Anthropic Claude | LLM provider = Anthropic, **OR** research backend = Claude web search | Course-content generation; Claude's built-in web search for the Research stage |
| Ollama Cloud | LLM provider = Ollama Cloud | Course-content generation. Get a key at [ollama.com/settings/keys](https://ollama.com/settings/keys) |
| Tavily | Research backend = Tavily | Web search for the Research stage. Free tier covers ~1,000 searches/month |
| Google Gemini | Advanced mode + you want infographics or audiobook narration | TTS + image generation (optional) |

The Wikipedia research backend needs no key.

## End-to-end Canvas course flow

1. **Upload your Canvas course template.** Visit `/templates`, drop in an `.imscc` you exported from a previous Canvas course. The parser identifies which modules to keep verbatim (Instructor Information, Begin Here / Introductory) and which are placeholder patterns to be replaced (Module 1, Module 2, …).
2. **Setup.** Enter the course topic and chapter count (defaults to 16 when a template is selected). Optionally upload a course-outline `.docx`; an LLM extracts the title, description, course information, and materials so they populate the Canvas Syllabus tab at export time.
3. **Syllabus.** AI generates chapter titles in the locked `Module N: <topic>` format. Edit the topic suffix per chapter from the inline editor — the locked prefix is preserved on save.
4. **Research.** Choose a backend. Claude web search is the highest-quality but Anthropic-only; Tavily and Wikipedia work with any LLM provider. Skippable.
5. **Build.** For each chapter, click "Generate Canvas Module" (or batch with "Generate All Canvas Modules") to produce the Module Overview + Instructor Notes pages + Discussion. The locked `MN Instructor Notes:` / `MN Discussion:` prefixes are added at export time.
6. **Export.** "Export for Canvas (.imscc)" produces a fresh `.imscc` containing your verbatim modules, your generated Module N modules, all original LTI links, all original `web_resources/` images, and a Syllabus tab body composed from the outline DOCX. Drop it into Canvas via Settings → Import Course Content → Common Cartridge Package.

## Inherited multimedia features (advanced mode)

The upstream ClassBuild also produces:

- Interactive HTML reading with embedded widgets
- Gamified practice quiz with confidence calibration
- In-class quiz (5 shuffled versions + answer keys)
- PowerPoint slides with speaker notes
- AI-narrated audiobook (Gemini TTS)
- AI-generated infographic (Gemini)
- Weekly mastery challenge with 6 question types and SCORM 2004 wrapper
- Discussion starters and classroom activities

These are hidden behind the "Advanced mode" toggle on Setup so the Canvas-focused workflow stays tight. Flip it on and the Build page surfaces all the additional tabs.

## Branches

- **`main`** — tracks upstream `jtangen/classbuild`; the original ClassBuild course generator without Canvas-specific work.
- **[`imscc-export`](https://github.com/daTechGuy/CanvasClassBuild/tree/imscc-export)** — active fork branch with all the CanvasClassBuild features above.
- **[`imscc-canvas-only`](https://github.com/daTechGuy/CanvasClassBuild/tree/imscc-canvas-only)** — a curated subset of `imscc-export` containing only the Common Cartridge / IMSCC export commits, opened as [PR #2 against upstream](https://github.com/jtangen/classbuild/pull/2) so the maintainer can review just that contribution.

## Built with

React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 · Zustand · JSZip · mammoth.js · Claude (Sonnet 4.6 / Opus 4.6 / Haiku 4.5) · Ollama Cloud · Tavily · Gemini

## Credit

Built on [ClassBuild](https://github.com/jtangen/classbuild) by Jason Tangen — the foundation of this fork. The IMSCC export, Canvas template handling, course-outline DOCX parsing, multi-provider LLM/research routing, and the rebrand are added on top, but the original learning-science engine, prompt library, and content generators are all from upstream.

## License

[MIT](LICENSE) — same as upstream.
