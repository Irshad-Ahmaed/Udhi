import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateSvg } from "./svg-validator";

const VALID_SMIL_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Series Circuit Diagram</title>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5">
      <path d="M 0 0 L 10 5 L 0 10 z" />
    </marker>
  </defs>
  <rect x="80" y="80" width="440" height="240" fill="none" stroke="#1e293b" stroke-width="3" />
  <circle cx="150" cy="80" r="14" fill="#3b82f6">
    <animate attributeName="cx" values="150;450;150" dur="3s" repeatCount="indefinite" />
  </circle>
  <circle cx="480" cy="200" r="24" fill="#fde047" stroke="#ca8a04" />
  <text x="300" y="50" text-anchor="middle" font-size="18">Series Circuit</text>
  <text x="150" y="130" text-anchor="middle" font-size="14">Current</text>
  <text x="480" y="250" text-anchor="middle" font-size="14">Lamp</text>
</svg>
`;

describe("validateSvg", () => {
  it("passes a valid SMIL-animated SVG with <defs> marker", () => {
    const res = validateSvg(VALID_SMIL_SVG);
    assert.equal(res.passedAll, true, JSON.stringify(res.checks));
  });

  it("passes a valid CSS-animated SVG wrapped in markdown fences", () => {
    const fenced = `\`\`\`svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>States of Matter</title>
  <style>
    .vibrate { animation: shake 1s infinite alternate; }
    @keyframes shake { from { transform: translateX(0); } to { transform: translateX(4px); } }
  </style>
  <g transform="translate(50, 50)">
    <circle class="vibrate" cx="50" cy="50" r="20" fill="#2563eb" />
    <circle class="vibrate" cx="100" cy="50" r="20" fill="#2563eb" />
    <rect x="20" y="20" width="120" height="80" fill="none" stroke="#334155" />
  </g>
  <text x="100" y="200" font-size="14">Solid</text>
  <text x="300" y="200" font-size="14">Liquid</text>
  <text x="500" y="200" font-size="14">Gas</text>
</svg>
\`\`\``;
    const res = validateSvg(fenced);
    assert.equal(res.passedAll, true, JSON.stringify(res.checks));
  });

  it("fails valid_svg on malformed XML", () => {
    const bad = `<svg viewBox="0 0 600 400"><title>Broken</title><rect x="10" y="10"></svg>`;
    const res = validateSvg(bad);
    assert.equal(res.passedAll, false);
    assert.equal(res.checks.find((c) => c.id === "valid_svg")?.passed, false);
  });

  it("fails valid_svg on unescaped ampersand outside comments/CDATA", () => {
    const bareAmp = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Bare Ampersand</title>
  <style>/* Styles & Theme */</style>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(bareAmp);
    assert.equal(res.checks.find((c) => c.id === "valid_svg")?.passed, false);
  });

  it("fails within_viewbox when a circle or path extends outside viewBox", () => {
    const outOfBounds = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Out of bounds</title>
  <circle cx="590" cy="200" r="30" fill="#ef4444" />
  <rect x="40" y="40" width="80" height="80" />
  <line x1="20" y1="20" x2="100" y2="100" />
  <text x="100" y="100">A</text>
  <text x="200" y="100">B</text>
  <text x="300" y="100">C</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(outOfBounds);
    assert.equal(res.checks.find((c) => c.id === "within_viewbox")?.passed, false);
  });

  it("fails within_viewbox when transformed group pushes shape outside viewBox", () => {
    const transformedOut = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Transformed out</title>
  <g transform="translate(550, 100)">
    <rect x="0" y="0" width="80" height="50" />
  </g>
  <rect x="20" y="20" width="40" height="40" />
  <circle cx="100" cy="100" r="10" />
  <text x="100" y="100">A</text>
  <text x="200" y="100">B</text>
  <text x="300" y="100">C</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(transformedOut);
    assert.equal(res.checks.find((c) => c.id === "within_viewbox")?.passed, false);
  });

  it("fails title_and_labels when fewer than 3 text labels exist", () => {
    const fewLabels = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Too few labels</title>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(fewLabels);
    assert.equal(res.checks.find((c) => c.id === "title_and_labels")?.passed, false);
  });

  it("fails has_animation when @keyframes is defined but never used", () => {
    const deadCss = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Unused keyframes</title>
  <style>@keyframes spin { from { opacity: 0; } to { opacity: 1; } }</style>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
</svg>`;
    const res = validateSvg(deadCss);
    assert.equal(res.checks.find((c) => c.id === "has_animation")?.passed, false);
  });

  it("fails safe_and_substantial on <script> tags or too few shapes", () => {
    const withScript = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Unsafe</title>
  <script>alert(1)</script>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(withScript);
    assert.equal(res.checks.find((c) => c.id === "safe_and_substantial")?.passed, false);
  });

  it("handles <text> with positioned <tspan> and <use> referencing <defs>", () => {
    const svgWithTspanAndUse = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Particles</title>
  <defs>
    <circle id="atom" cx="0" cy="0" r="10" fill="#2563eb" />
  </defs>
  <use href="#atom" x="100" y="150" />
  <use href="#atom" x="140" y="150" />
  <use href="#atom" x="180" y="150" />
  <text text-anchor="middle" font-size="14">
    <tspan x="300" y="340">Line 1</tspan>
    <tspan x="300" y="360">Line 2</tspan>
  </text>
  <text x="100" y="80">Solid</text>
  <text x="300" y="80">Liquid</text>
  <animateMotion path="M 0 0 L 20 0" dur="2s" />
</svg>`;
    const res = validateSvg(svgWithTspanAndUse);
    assert.equal(res.passedAll, true, JSON.stringify(res.checks));
  });

  it("fails has_animation when SMIL dur is 0s", () => {
    const zeroDur = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Zero dur</title>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="0s" />
</svg>`;
    const res = validateSvg(zeroDur);
    assert.equal(res.checks.find((c) => c.id === "has_animation")?.passed, false);
  });

  it("resolves CSS class text-anchor and font-size for within_viewbox", () => {
    const cssClassText = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Centered via CSS class</title>
  <style>
    .centered { font-size: 11px; text-anchor: middle; }
    .pulse { animation: fade 2s infinite; }
    @keyframes fade { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
  </style>
  <rect x="40" y="40" width="520" height="320" class="pulse" fill="none" stroke="#334155" />
  <circle cx="200" cy="200" r="20" />
  <line x1="100" y1="100" x2="200" y2="100" />
  <text x="485" y="320" class="centered">Move fast in all directions</text>
  <text x="100" y="320" class="centered">Close together</text>
  <text x="300" y="80" class="centered">States of Matter</text>
</svg>`;
    const res = validateSvg(cssClassText);
    assert.equal(res.passedAll, true, JSON.stringify(res.checks));
  });

  it("bounds <circle> with child <animateMotion><mpath> along the motion path", () => {
    const motionSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Series Circuit</title>
  <path id="loop" d="M 100 100 L 500 100 L 500 300 L 100 300 Z" fill="none" stroke="#334155" />
  <rect x="250" y="80" width="80" height="40" />
  <rect x="250" y="280" width="80" height="40" />
  <circle r="5" fill="#ef4444">
    <animateMotion dur="3s" repeatCount="indefinite">
      <mpath href="#loop" />
    </animateMotion>
  </circle>
  <text x="300" y="50" text-anchor="middle">Circuit</text>
  <text x="300" y="105" text-anchor="middle">Cell</text>
  <text x="300" y="305" text-anchor="middle">Lamp</text>
</svg>`;
    const res = validateSvg(motionSvg);
    assert.equal(res.passedAll, true, JSON.stringify(res.checks));
  });

  it("fails valid_svg when root namespace is not SVG", () => {
    const wrongNs = `
<svg xmlns="http://example.com/not-svg" viewBox="0 0 600 400">
  <title>Wrong NS</title>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    const res = validateSvg(wrongNs);
    assert.equal(res.checks.find((c) => c.id === "valid_svg")?.passed, false);
  });

  it("fails safe_and_substantial on external CSS @import and zero-width shapes", () => {
    const externalCss = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>External CSS</title>
  <style>@import url('https://fonts.googleapis.com/css2?family=Inter');</style>
  <rect x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    assert.equal(
      validateSvg(externalCss).checks.find((c) => c.id === "safe_and_substantial")?.passed,
      false,
    );

    const zeroShapes = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Degenerate</title>
  <rect x="20" y="20" width="0" height="80" />
  <circle cx="200" cy="200" r="0" />
  <line x1="10" y1="10" x2="10" y2="10" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    assert.equal(
      validateSvg(zeroShapes).checks.find((c) => c.id === "safe_and_substantial")?.passed,
      false,
    );
  });

  it("fails within_viewbox when <animate> moves geometry outside viewBox or CSS 0s animation", () => {
    const animOut = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Moving out</title>
  <rect x="20" y="20" width="80" height="80" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <circle cx="150" cy="200" r="20">
    <animate attributeName="cx" values="150;650;150" dur="2s" />
  </circle>
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
</svg>`;
    assert.equal(
      validateSvg(animOut).checks.find((c) => c.id === "within_viewbox")?.passed,
      false,
    );

    const zeroCssAnim = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Zero CSS anim</title>
  <style>.a { animation: fade 0s; } @keyframes fade { from { opacity: 0; } to { opacity: 1; } }</style>
  <rect class="a" x="20" y="20" width="80" height="80" />
  <circle cx="200" cy="200" r="20" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
</svg>`;
    assert.equal(
      validateSvg(zeroCssAnim).checks.find((c) => c.id === "has_animation")?.passed,
      false,
    );
  });

  it("extracts outer SVG when nested <svg> exists and handles xlink:href <use>", () => {
    const nestedAndXlink = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 400">
  <title>Nested &amp; XLink</title>
  <defs>
    <circle id="dot" cx="0" cy="0" r="10" />
  </defs>
  <svg x="50" y="50" width="100" height="100" viewBox="0 0 100 100">
    <rect x="10" y="10" width="40" height="40" />
  </svg>
  <use xlink:href="#dot" x="200" y="200" />
  <line x1="10" y1="10" x2="50" y2="50" />
  <text x="100" y="100">One</text>
  <text x="200" y="100">Two</text>
  <text x="300" y="100">Three</text>
  <animate attributeName="opacity" values="1;0.5;1" dur="2s" />
</svg>`;
    assert.equal(validateSvg(nestedAndXlink).passedAll, true);
  });

  it("fails within_viewbox when a large diagram shape overlaps header text", () => {
    const headerOverlap = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">
  <title>Header overlap</title>
  <rect width="600" height="400" fill="#f8fafc" />
  <text x="40" y="45" font-size="20">Pythagoras Theorem</text>
  <polygon points="150,150 280,240 370,110 240,20" fill="#fca5a5" stroke="#ef4444" />
  <circle cx="150" cy="240" r="20" />
  <text x="150" y="290">Side a</text>
  <text x="250" y="290">Side b</text>
  <animate attributeName="opacity" values="1;0.8;1" dur="2s" />
</svg>`;
    const res = validateSvg(headerOverlap);
    assert.equal(res.checks.find((c) => c.id === "within_viewbox")?.passed, false);
  });
});
