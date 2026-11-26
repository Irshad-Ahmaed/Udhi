# Deep Implementation Plan — Udhi Technologies: Science Diagram Maker

## 1. Objective & Scope

Build, verify, and deploy a single-page web application that:
1. Generates **5 animated SVG diagrams** (CSS or SMIL) for 5 UK GCSE science/maths concepts using a free Google Gemini model.
2. Validates every SVG programmatically in code with **5 checks** (4 required + 1 custom check), retrying **once with failure feedback** if any check fails, and waiting/retrying up to **3 times** on `429` or `503` API errors.
3. Logs model name, input tokens, output tokens (including thinking tokens), estimated cost in USD, retries, and per-check pass/fail results, saving the 5 final results to `results.json` at the repo root.
4. Displays the 5 saved results immediately on page open (zero API calls on initial load) in a **5-row table**, supports persistent **Approve / Reject + notes** across page refreshes, and provides a live **Generate** button for testing Part A on one concept with clear error handling.

---

## 2. Architecture & Tech Stack

- **Framework:** **Next.js (App Router, TypeScript)**
  - **Why:** Single clean repository for both the web UI and server-side API route (`/api/generate`), keeping `GEMINI_API_KEY` strictly server-side (never `NEXT_PUBLIC_*`), native SVG rendering, fast cold starts on Vercel, and straightforward TypeScript that is easy to explain and modify live on the review call.
- **Styling:** **Tailwind CSS** for a clean, legible 5-row review table, clear Pass/Fail badges, and responsive layout.
- **Gemini SDK:** `@google/genai` (`new GoogleGenAI({ apiKey })` + `ai.models.generateContent(...)`).
  - **Default Model:** `gemini-3.5-flash-lite` (configurable via `process.env.GEMINI_MODEL` so switching to another free model if needed requires zero code edits; note that `gemini-3.5-flash` routes to `gemini-3.6-flash` per current Gemini API docs).
- **SVG Parsing & Geometry Checks:**
  - `@xmldom/xmldom` (strict XML DOM parsing with custom `errorHandler`).
  - `svg-path-parser` (`parseSVG` + `makeAbsolute`) for normalizing and bounding `<path d="...">` geometry.
- **Testing:** Node built-in test runner (`node --test` via `tsx --test`) for unit-testing `svg-validator.ts` and `pricing.ts`.
- **Review Persistence:** **Browser `localStorage`**
  - **Why:** On free serverless hosts like Vercel, the runtime filesystem is read-only/ephemeral, so writing review choices to a local server file fails in production. `localStorage` provides instant, reliable persistence across page refreshes with zero external DB setup (documented with rationale in `README.md`).
- **Hosting:** **Vercel** (Free Hobby tier) with `GEMINI_API_KEY` set exclusively in Vercel Environment Variables (and `.env.local` locally, gitignored).

---

## 3. Repository Structure

```text
udhi/
├── assignment_requirements.md   # Assignment specification (reference)
├── PLAN.md                      # This verified implementation plan
├── README.md                    # Setup, results table, persistence rationale, post-mortem, AI usage
├── results.json                 # Pre-generated 5 final results (committed to repo)
├── .env.example                 # Template: GEMINI_API_KEY= (never real key)
├── .gitignore                   # Ignores .env*, node_modules, .next
├── package.json
├── next.config.ts
├── tsconfig.json
├── data/
│   └── concepts.ts              # The 5 exact GCSE concepts, subjects, and prompt texts
├── lib/
│   ├── types.ts                 # Shared TypeScript interfaces & results.json schema
│   ├── pricing.ts               # Token-to-USD cost calculation (prompt + candidates + thoughts tokens)
│   ├── svg-validator.ts         # SVG extraction + 5 programmatic checks + 2D matrix transform math
│   ├── svg-validator.test.ts    # Unit tests for all 5 checks and edge cases
│   └── diagram-generator.ts     # Shared Part A pipeline: Gemini call, 429/503 backoff, 1x validation retry, logging
├── scripts/
│   └── generate-all.ts          # CLI runner: generates all 5 concepts, logs to stdout, writes results.json
└── app/
    ├── layout.tsx
    ├── page.tsx                 # Server Component: reads results.json from disk (no API call) -> ReviewDashboard
    ├── globals.css
    ├── components/
    │   ├── SvgPreview.tsx       # Shadow DOM wrapper isolating CSS @keyframes, SVG IDs, and responsive sizing
    │   └── ReviewDashboard.tsx  # Client Component: 5-row table, checks, metrics, Approve/Reject + notes, Generate UI
    └── api/
        └── generate/
            └── route.ts         # POST /api/generate (maxDuration = 60): runs Part A live for 1 concept
```

> **Zero Duplication:** `scripts/generate-all.ts` and `app/api/generate/route.ts` both call `generateAndValidateDiagram()` in `lib/diagram-generator.ts`.

---

## 4. Shared Data Contract (`lib/types.ts` & `results.json`)

```ts
export interface CheckResult {
  id: 'valid_svg' | 'within_viewbox' | 'title_and_labels' | 'has_animation' | 'safe_and_substantial';
  label: string;
  passed: boolean;
  message: string;
}

export interface DiagramResult {
  conceptId: string;
  concept: string;
  subject: string;
  promptText: string;
  model: string;
  svg: string;
  checks: CheckResult[];
  passedAll: boolean;
  inputTokens: number;
  outputTokens: number;       // candidatesTokenCount + thoughtsTokenCount
  thoughtsTokenCount: number;
  estimatedCostUsd: number;
  retries: number;            // validation retries (0 or 1)
  apiRetries: number;         // 429/503 transient API retries
  generatedAt: string;        // ISO timestamp
}
```

`results.json` stores `{ generatedAt: string, model: string, results: DiagramResult[] }` (always ordered across the 5 concepts).

---

## 5. Detailed Design — Part A (AI Generation, Validation & Logging)

### 5.1 Exact 5 Concepts (`data/concepts.ts`)
Each concept uses the **exact** text from the "Text for the model" column of the assignment spec:
1. `pythagoras` — **Pythagoras' theorem** (Maths)
2. `circle-parts` — **Parts of a circle** (Maths)
3. `series-circuit` — **Series circuit** (Physics)
4. `photosynthesis` — **Photosynthesis** (Biology)
5. `states-of-matter` — **States of matter** (Chemistry)

### 5.2 Prompt Design
Prompt Gemini to return **only raw `<svg>...</svg>` markup** (no markdown fences or explanation) tailored for UK GCSE students:
- Explicit fixed `viewBox="0 0 600 400"` with all shapes, paths, and text kept safely inside `[20, 20, 580, 380]` so strokes and labels never clip.
- Required `<title>` element describing the diagram, plus a clear visible heading and at least 3 readable `<text>` labels with high contrast on a light background.
- Meaningful, smooth **CSS (`@keyframes`) or SMIL (`<animate>` / `<animateTransform>` / `<animateMotion>`)** animation illustrating the concept.
- Self-contained markup (no `<script>`, no external images/links).

### 5.3 SVG Extraction & 5 Programmatic Checks (`lib/svg-validator.ts`)
Before running checks, strip accidental markdown code fences (```` ```svg ```` / ```` ```xml ````) if present and extract `<svg ...>...</svg>`. Always run all 5 checks (if `valid_svg` fails completely, Checks 2–5 report `passed: false` with clear dependent reasons):

1. **Check 1 — `valid_svg` (Valid & Parseable SVG):**
   - Parse with `@xmldom/xmldom` using a strict `errorHandler` capturing warnings, errors, and fatal errors.
   - Verify zero XML parse errors and that the root element is `<svg>`.
2. **Check 2 — `within_viewbox` (Nothing Drawn Outside `viewBox`):**
   - Require a valid `viewBox="minX minY width height"` attribute (4 finite numbers, `width > 0`, `height > 0`).
   - Skip non-rendered definition containers (`defs`, `clipPath`, `mask`, `pattern`, `marker`, `symbol`) so local coordinate templates (e.g., `0..10` arrowheads) don't trigger false positives.
   - Implement a `2x3` **2D affine transform matrix** helper (`translate`, `scale`, `rotate(deg, cx?, cy?)`, `skewX`, `skewY`, `matrix`) that composes ancestor `<g transform="...">` and element `transform="..."` attributes cleanly.
   - Compute transformed bounding boxes for all graphical elements, accounting for `stroke-width / 2` padding:
     - `rect`: `[x, y, x + width, y + height]`
     - `circle`: `[cx - r, cy - r, cx + r, cy + r]`
     - `ellipse`: `[cx - rx, cy - ry, cx + rx, cy + ry]`
     - `line`: `[min(x1,x2), min(y1,y2), max(x1,x2), max(y1,y2)]`
     - `polyline` / `polygon`: min/max across all `(x, y)` pairs in `points`
     - `path`: parse `d` with `svg-path-parser` (`parseSVG` + `makeAbsolute`) and walk `M/L/H/V/C/S/Q/T/A/Z` commands (tracking current point and subpath start, checking vertices, cubic/quadratic control points, and arc endpoint/radii bounds)
     - `text`: estimate text bounding box from `(x, y)`, `font-size` (default `16`), `text-anchor` (`start`/`middle`/`end`), and character length (including baseline ascent `~0.85 * fontSize` and descent `~0.25 * fontSize`) so clipped labels near edges are caught accurately.
   - Verify every bounding box lies within `[minX - 2, minX + width + 2]` and `[minY - 2, minY + height + 2]`. On failure, report the exact offending element and coordinates.
3. **Check 3 — `title_and_labels` (Title + ≥ 3 Text Labels):**
   - Require at least 1 `<title>` element with non-empty trimmed text.
   - Require at least 3 `<text>` elements with non-empty trimmed text (aggregating nested `<tspan>` text).
4. **Check 4 — `has_animation` (At Least 1 Animation):**
   - Verify either:
     - At least 1 SMIL animation tag (`animate`, `animateTransform`, `animateMotion`, `set`) with a valid `dur` attribute (and `attributeName` for `animate`/`animateTransform`/`set`, or `path`/`<mpath>` for `animateMotion`), **OR**
     - A `<style>` block (handling plain text or `<![CDATA[...]]>`) containing `@keyframes <name>` that is actually referenced by an `animation` or `animation-name` CSS rule (or inline `style` with `animation`).
5. **Check 5 — `safe_and_substantial` (Our 1 Custom Check):**
   - **Safety:** Reject `<script>`, `on*` event handler attributes (`onload`, `onclick`, etc.), `<foreignObject>`, and external `http(s)://` / `javascript:` references.
   - **Visual Substance:** Require at least **3 geometric shape primitives** (`path`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `line`) so text-only SVGs cannot pass.

### 5.4 API Error Backoff, Validation Retry & Logging (`lib/diagram-generator.ts`)
- **429 / 503 Handling (`callGeminiWithBackoff`):**
  - Inspect caught SDK/HTTP errors for status `429` / `RESOURCE_EXHAUSTED` or `503` / `UNAVAILABLE`.
  - Wait and retry **up to 3 times** with exponential backoff + jitter (`2s → 4s → 8s` in CLI; capped at `2s → 3s → 4s` in `/api/generate` so serverless requests fit within Vercel's `maxDuration = 60`).
  - Fail fast on non-retryable errors (e.g., `400`, `401`/`403` invalid API key) with a clear message.
- **Validation Retry (Retry Once):**
  - Run all 5 checks on the extracted SVG.
  - If any check fails:
    - Set `retries = 1` and call the model **once more**, including the failed SVG and the exact list of failed checks + failure reasons.
  - If the second attempt still fails any check, save that final attempt in the result with its exact per-check `passed: true/false` statuses so `results.json` and the Part B table accurately show which checks passed or failed.
- **Token, Cost & Metric Logging:**
  - Read `response.usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`).
  - Sum `inputTokens`, `outputTokens` (`candidatesTokenCount + thoughtsTokenCount`), and compute `estimatedCostUsd` using Gemini Developer API Paid Tier rates (`gemini-3.5-flash-lite`: `$0.30` / 1M input, `$2.50` / 1M output; fallback map for `gemini-3.5-flash` / `gemini-3.6-flash` / `gemini-3.8-flash`), noting in UI/README that Free Tier usage is `$0` billed.
  - Log a structured summary per concept to stdout and save all 5 final results to `results.json` at the repo root.
  - In `scripts/generate-all.ts`, pause `1.5s` between concepts to respect free-tier RPM limits.

---

## 6. Detailed Design — Part B (Web UI & Live Test)

### 6.1 Zero-API Initial Page Load
- `app/page.tsx` reads `results.json` directly on the server (with safe fallback handling if missing) and passes the 5 saved results as props to `ReviewDashboard.tsx`.
- Opening the deployed site loads all 5 animated diagrams, checks, costs, and retries **immediately with zero Gemini API calls**.

### 6.2 5-Row Review Table (`ReviewDashboard.tsx` & `SvgPreview.tsx`)
Render a clean HTML `<table>` with **5 rows** (one per concept). Each row displays:
1. **Concept & Prompt:** Concept name, subject badge, and collapsible/compact prompt text.
2. **Diagram (Animated):** Rendered inside `SvgPreview.tsx` using a **Shadow DOM** container (`bg-white`) with `svg { max-width: 100%; height: auto; display: block; }`.
   - **Why Shadow DOM:** Prevents `<style>` `@keyframes`, class names, and SVG `id`s (`grad`, `arrow`) from colliding across the 5 diagrams on the same page while preserving full CSS and SMIL animations and enforcing responsive sizing.
3. **Code Checks (All 5):** Pass/Fail badge for each of the 5 checks (`Valid SVG`, `Inside viewBox`, `Title & 3+ Labels`, `Animated`, `Safe & Substantial`) with hover/expandable failure or pass detail.
4. **Cost & Retries:** Model name, input/output tokens, estimated cost in USD, validation retries (`retries`), and API retries (`apiRetries`).
5. **Approve / Reject & Notes:**
   - **Approve** and **Reject** toggle buttons on every row + a **Note** `<textarea>`.
   - Auto-saved to browser `localStorage` (keyed by concept ID) with a subtle `"Saved"` indicator; persists across page refreshes.

### 6.3 Live "Generate" Button (`POST /api/generate`)
- Top bar with a **concept selector + "Generate" button** (plus a per-row **Regenerate** button) calling `POST /api/generate` (`export const maxDuration = 60;`) for 1 concept.
- Displays a loading spinner and prevents duplicate clicks while running.
- On success: updates that concept's row in UI state with a `"Live test"` badge (and a `"Reset to saved"` option to restore the `results.json` baseline).
- On failure (missing/invalid API key, `429`/`503` after 3 retries, network error): displays a clear, dismissible error banner with the reason — **never** a blank page or crash.

---

## 7. Verification, Git Workflow & Submission Plan

1. **Git Initialization & Frequent Commits:**
   - Initialize Git early and commit in logical increments (plan & scaffolding → SVG validator + unit tests → Gemini generator + `results.json` → web UI + `/api/generate` → README & deployment fixes) since commit history is reviewed.
   - Ensure `.env.local` is gitignored and grep repo before every push to confirm **zero API keys** exist in tracked files.
2. **Unit Tests (`lib/svg-validator.test.ts`):**
   - Cover valid CSS-animated and SMIL-animated SVGs, invalid XML, out-of-bounds shapes/paths/transformed groups/text, `<defs>`/`<marker>` non-false-positives, missing `<title>` or `< 3` `<text>` labels, unused `@keyframes`, `<animateMotion>`, and `<script>` / `on*` rejection.
3. **Local End-to-End Verification:**
   - Run `npx tsx scripts/generate-all.ts` with `GEMINI_API_KEY` in `.env.local` to generate all 5 diagrams into `results.json`.
   - Inspect every rendered diagram visually in `npm run dev` to confirm GCSE accuracy and smooth animation.
   - Verify `localStorage` persistence across hard refreshes, test `POST /api/generate` (both success and error banner with missing/invalid key), and run `npm run build` cleanly.
4. **Deployment & Complete `README.md`:**
   - Deploy to Vercel with `GEMINI_API_KEY` in Vercel Environment Variables.
   - Test the live URL in an incognito browser.
   - Write `README.md` covering all required items:
     1. How to run locally
     2. Results table (concept, pass/fail, cost, retries)
     3. Persistence choice (`localStorage`) and why
     4. What failed, and how you fixed it
     5. What you would do with one more day
     6. Which AI tools you used, and for what
   - Submit live app link + GitHub repo link via the Google Form within 24 hours.
