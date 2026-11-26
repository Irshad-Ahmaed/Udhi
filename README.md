# Science Diagram Maker — Udhi Technologies Home Assignment

A Next.js (App Router, TypeScript) web application that generates **5 animated GCSE science and maths SVG diagrams** using Google Gemini, validates each SVG in code with automatic retry-on-failure, logs token/cost/retry metrics to `results.json`, and displays them in a persistent review dashboard.

---

## 1. How to Run Locally

### Prerequisites
- **Node.js 20+** (tested on Node v24.20.0) and **npm**
- A free Gemini API key from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys)

### Setup & Run
```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (never commit .env.local)
cp .env.example .env.local
# Edit .env.local and set GEMINI_API_KEY=your_key_here
# Optional: GEMINI_MODEL=gemini-3.5-flash-lite (default)

# 3. Run unit tests for the SVG validator
npm test

# 4. (Optional) Regenerate all 5 diagrams into results.json
npm run generate

# 5. Start the web app locally
npm run dev
```
Open [http://localhost:3000](http://localhost:3000). The 5 pre-generated diagrams from `results.json` load immediately without making any Gemini API calls.

> **Windows Note:** On Node **22.15.0+** (including Node 24), if you are behind a local/corporate root CA on Windows and Node reports `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, prefix commands with `NODE_OPTIONS="--use-system-ca"` (PowerShell: `$env:NODE_OPTIONS="--use-system-ca"`). On **Node 20**, export your corporate root CA as a `.pem` file and set `NODE_EXTRA_CA_CERTS=<path-to-ca.pem>` instead (preserving full TLS verification).

---

## 2. Results Table

Generated using `gemini-3.5-flash-lite` (standard Paid-Tier API reference rates used to estimate USD cost: `$0.30` / 1M input tokens, `$2.50` / 1M output tokens; Free-Tier usage is billed `$0`).

| # | Concept | Subject | Result | Input Tokens | Output Tokens | Est. Cost (USD) | Validation Retries | API Retries (429/503) |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Pythagoras' theorem | Maths | **PASS** (5/5) | 446 | 2,683 | `$0.006841` | 0 | 0 |
| 2 | Parts of a circle | Maths | **PASS** (5/5) | 2,924 | 4,125 | `$0.011190` | 1 | 0 |
| 3 | Series circuit | Physics | **PASS** (5/5) | 429 | 2,485 | `$0.006341` | 0 | 1 |
| 4 | Photosynthesis | Biology | **PASS** (5/5) | 3,480 | 6,215 | `$0.016581` | 1 | 0 |
| 5 | States of matter | Chemistry | **PASS** (5/5) | 435 | 3,707 | `$0.009398` | 0 | 0 |
| | **Total** | | **5 / 5 PASS** | **7,714** | **19,215** | **`$0.050351`** | **2** | **1** |

### The 5 Code Checks
1. **Valid SVG (`valid_svg`):** Strict XML/DOM parse via `@xmldom/xmldom` (including unclosed-tag warnings) plus rejection of unescaped `&` / HTML-only entities outside comments/CDATA.
2. **Inside `viewBox` (`within_viewbox`):** Verifies `viewBox` dimensions and bounds every rendered shape, `<path>` command (`svg-path-parser`), `<use>` reference, `<animateMotion>` path, `<text>`/`<tspan>`, and nested `<g transform="...">` matrix inside the `viewBox`.
3. **Title & 3+ Labels (`title_and_labels`):** Requires a non-empty `<title>` and at least 3 non-empty `<text>` labels.
4. **Animated (`has_animation`):** Verifies at least one active SMIL animation (`<animate>`, `<animateTransform>`, `<animateMotion>`, `<set>` with `dur > 0`) or a referenced CSS `@keyframes` animation.
5. **Safe & Substantial (`safe_and_substantial`, custom check):** Blocks `<script>`, `<foreignObject>`, `on*` event attributes, and external `http(s):`/`javascript:` URIs, and requires at least 3 geometric primitives outside `<defs>`.

---

## 3. Approve / Reject Persistence Choice

- **Choice:** **Browser `localStorage`** (`udhi_diagram_reviews_v1` key).
- **Why:** On free serverless hosts such as Vercel, the server filesystem is read-only/ephemeral at runtime, so writing review decisions to a local JSON/SQLite file on the server fails in production. `localStorage` persists Approve/Reject selections and reviewer notes reliably across page refreshes with zero external database setup or latency.

---

## 4. What Failed, and How I Fixed It

1. **`@xmldom/xmldom` silent unclosed tags & empty `getAttribute()`:**
   - *Failure:* `@xmldom/xmldom` emitted unclosed-tag issues at `warning` severity rather than `error`, and returned `""` instead of `null` for missing attributes—causing `resolveCssProp` to skip `<style>` rules and mis-measure centered `<text class="subtitle">` labels as overflowing `viewBox`.
   - *Fix:* Captured `warning` in `errorHandler`, parsed `<style>` tag/class/ID rules (`font-size`, `text-anchor`), normalized SVG whitespace (`\s+` → `" "`), and checked `hasAttribute` / non-empty strings.
2. **Bare `&` and HTML entities breaking browser `DOMParser` previews:**
   - *Failure:* Gemini occasionally emitted `/* CSS Styles & Animations */` inside `<style>` or `&pi;` inside `<text>`. Chromium's strict `image/svg+xml` `DOMParser` rejected those SVGs even though inline HTML renders them.
   - *Fix:* Added a bare-`&` / invalid-entity check in `valid_svg` (so retries fix them at generation time) and added a `text/html` fallback sanitizer in `SvgPreview.tsx` so previews still render safely inside Shadow DOM.
3. **False `viewBox` failures on `<defs>` markers and `<animateMotion>` circles:**
   - *Failure:* `<marker>` shapes inside `<defs>` and `<circle r="4"><animateMotion><mpath href="#loop"/></animateMotion></circle>` (which omit static `cx`/`cy`) triggered false out-of-bounds errors at `(0, 0)`.
   - *Fix:* Skipped non-rendered definition containers (`defs`, `marker`, `clipPath`, `pattern`, `mask`, `symbol`) and resolved `<animateMotion>` / `<mpath>` paths to bound moving elements along their actual trajectory.
4. **Cross-diagram CSS & `id` collisions:**
   - *Failure:* Rendering 5 AI-generated SVGs on one page risks `@keyframes` names, class rules, and `#id`s colliding across rows.
   - *Fix:* Isolated every diagram inside a Shadow DOM container (`SvgPreview.tsx`) with DOM sanitization.
5. **Transient `429` / `503` API rate limits & Windows TLS CA:**
   - *Failure:* Free-tier Gemini calls hit `429`/`503` bursts during batch generation, and Node on Windows needed the OS certificate store (`--use-system-ca`).
   - *Fix:* Exponential backoff with jitter (up to 3 retries) in `diagram-generator.ts` automatically recovered on Concept #3 (`Series circuit`).

---

## 5. What I Would Do With One More Day

1. **Shared Database Persistence:** Replace `localStorage` with a serverless Postgres/KV store (e.g., Neon or Upstash) so multiple reviewers see shared approval state and audit history across devices.
2. **Rendered Visual Overlap Detection:** Run a headless Chromium check (`getBBox()` on every rendered DOM node) to detect text-on-text or shape-on-text collisions automatically and feed exact coordinates back to the retry prompt.
3. **Video / Frame Export:** Add a one-click export to WebM/MP4 or high-DPI PNG frames for direct integration into Udhi's GCSE lesson video pipeline.
4. **Side-by-Side Diff & Prompt Versioning:** Store prompt versions and attempt-1 vs attempt-2 SVGs so reviewers can inspect what the validation retry improved.

---

## 6. AI Tools Used

- **Antigravity (Gemini):** Used for initial project scaffolding, designing and debugging the SVG geometry/matrix validator and unit tests, diagnosing XML/Shadow DOM edge cases, and drafting documentation.
- **Google Gemini API (`gemini-3.5-flash-lite`):** Used at runtime (`scripts/generate-all.ts` and `/api/generate`) to generate the 5 animated SVG diagrams.
