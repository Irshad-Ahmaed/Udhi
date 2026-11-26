import { DOMParser } from "@xmldom/xmldom";
import { makeAbsolute, parseSVG } from "svg-path-parser";
import type { CheckResult } from "@/lib/types";

type Matrix2D = [number, number, number, number, number, number];

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];
const SKIPPED_CONTAINERS = new Set([
  "defs",
  "clippath",
  "mask",
  "pattern",
  "marker",
  "symbol",
]);
const GEOMETRY_TAGS = new Set([
  "path",
  "rect",
  "circle",
  "ellipse",
  "polygon",
  "polyline",
  "line",
]);
const VIEWBOX_TOLERANCE = 2;

/**
 * Extracts raw <svg>...</svg> markup from model output, stripping markdown code fences if present.
 */
export function extractSvg(rawOutput: string): string | null {
  if (!rawOutput || typeof rawOutput !== "string") return null;
  const cleaned = rawOutput
    .replace(/```(?:svg|xml|html)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();

  const match = cleaned.match(/<svg\b[\s\S]*?<\/svg>/i);
  return match ? match[0].trim() : null;
}

function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function applyMatrix(m: Matrix2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function transformBBox(box: BBox, m: Matrix2D): BBox {
  const corners: [number, number][] = [
    applyMatrix(m, box.minX, box.minY),
    applyMatrix(m, box.maxX, box.minY),
    applyMatrix(m, box.minX, box.maxY),
    applyMatrix(m, box.maxX, box.maxY),
  ];
  return {
    minX: Math.min(...corners.map((c) => c[0])),
    minY: Math.min(...corners.map((c) => c[1])),
    maxX: Math.max(...corners.map((c) => c[0])),
    maxY: Math.max(...corners.map((c) => c[1])),
  };
}

function parseTransform(attr: string | null): Matrix2D {
  if (!attr) return IDENTITY_MATRIX;
  let result: Matrix2D = IDENTITY_MATRIX;
  const regex = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(attr)) !== null) {
    const fn = match[1].toLowerCase();
    const nums = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (nums.some((n) => Number.isNaN(n))) continue;

    let m: Matrix2D = IDENTITY_MATRIX;
    if (fn === "translate" && nums.length >= 1) {
      m = [1, 0, 0, 1, nums[0], nums[1] ?? 0];
    } else if (fn === "scale" && nums.length >= 1) {
      const sx = nums[0];
      const sy = nums[1] ?? sx;
      m = [sx, 0, 0, sy, 0, 0];
    } else if (fn === "rotate" && nums.length >= 1) {
      const rad = (nums[0] * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      if (nums.length >= 3) {
        const [, cx, cy] = nums;
        const t1: Matrix2D = [1, 0, 0, 1, cx, cy];
        const r: Matrix2D = [cos, sin, -sin, cos, 0, 0];
        const t2: Matrix2D = [1, 0, 0, 1, -cx, -cy];
        m = multiplyMatrices(multiplyMatrices(t1, r), t2);
      } else {
        m = [cos, sin, -sin, cos, 0, 0];
      }
    } else if (fn === "skewx" && nums.length >= 1) {
      m = [1, 0, Math.tan((nums[0] * Math.PI) / 180), 1, 0, 0];
    } else if (fn === "skewy" && nums.length >= 1) {
      m = [1, Math.tan((nums[0] * Math.PI) / 180), 0, 1, 0, 0];
    } else if (fn === "matrix" && nums.length === 6) {
      m = [nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]];
    }

    result = multiplyMatrices(result, m);
  }
  return result;
}

function parseNumber(val: string | null, fallback = 0): number {
  if (!val) return fallback;
  const parsed = Number.parseFloat(val);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStrokePadding(el: Element): number {
  const stroke = el.getAttribute("stroke");
  if (stroke === "none") return 0;
  const sw = el.getAttribute("stroke-width");
  if (!sw) return 0;
  return Math.max(0, parseNumber(sw, 0) / 2);
}

function getInlineStyleValue(el: Element, prop: string): string | null {
  const style = el.getAttribute("style");
  if (!style) return null;
  const regex = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const match = style.match(regex);
  return match ? match[1].trim() : null;
}

function sampleSvgArcPoints(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  xAxisRotDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number,
  y1: number,
): [number, number][] {
  if (rxIn === 0 || ryIn === 0 || (x0 === x1 && y0 === y1)) {
    return [[x1, y1]];
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  const phi = (xAxisRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (x0 - x1) / 2;
  const dy2 = (y0 - y1) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const rxSq = rx * rx;
  const rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1pSq - ry2 * x1pSq);
  const den = rx2 * y1pSq + ry2 * x1pSq;
  const factor = den === 0 ? 0 : Math.sqrt(num / den) * (largeArc === sweep ? -1 : 1);

  const cxp = (factor * rx * y1p) / ry;
  const cyp = (-factor * ry * x1p) / rx;

  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const ratio = len === 0 ? 1 : Math.min(1, Math.max(-1, dot / len));
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    return sign * Math.acos(ratio);
  };

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  const points: [number, number][] = [];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = theta1 + (dTheta * i) / steps;
    const px = cx + cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t);
    const py = cy + sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t);
    points.push([px, py]);
  }
  return points;
}

function computePathBBox(d: string): BBox | null {
  const commands = makeAbsolute(parseSVG(d));
  if (commands.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let curX = 0;
  let curY = 0;

  const include = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const cmd of commands) {
    switch (cmd.code) {
      case "M":
      case "L":
      case "H":
      case "V":
      case "Z": {
        include(cmd.x, cmd.y);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
      case "C": {
        include(cmd.x1, cmd.y1);
        include(cmd.x2, cmd.y2);
        include(cmd.x, cmd.y);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
      case "S": {
        include(cmd.x2, cmd.y2);
        include(cmd.x, cmd.y);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
      case "Q": {
        include(cmd.x1, cmd.y1);
        include(cmd.x, cmd.y);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
      case "T": {
        include(cmd.x, cmd.y);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
      case "A": {
        const pts = sampleSvgArcPoints(
          curX,
          curY,
          cmd.rx,
          cmd.ry,
          cmd.xAxisRotation,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        );
        for (const [px, py] of pts) include(px, py);
        curX = cmd.x;
        curY = cmd.y;
        break;
      }
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function getVisibleTextContent(el: Element): string {
  let out = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 3 || child.nodeType === 4) {
      out += child.nodeValue ?? "";
    } else if (child.nodeType === 1) {
      const childEl = child as Element;
      const childTag = childEl.tagName.toLowerCase();
      if (childTag !== "title" && childTag !== "desc") {
        out += getVisibleTextContent(childEl);
      }
    }
  }
  return out;
}

function unionBBoxes(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  return {
    minX: Math.min(...boxes.map((b) => b.minX)),
    minY: Math.min(...boxes.map((b) => b.minY)),
    maxX: Math.max(...boxes.map((b) => b.maxX)),
    maxY: Math.max(...boxes.map((b) => b.maxY)),
  };
}

function estimateTextSpanBBox(
  textStr: string,
  x: number,
  y: number,
  fontSize: number,
  anchor: string,
): BBox {
  const estWidth = textStr.length * fontSize * 0.52;
  let minX = x;
  if (anchor === "middle") minX = x - estWidth / 2;
  else if (anchor === "end") minX = x - estWidth;

  return {
    minX,
    maxX: minX + estWidth,
    minY: y - fontSize * 0.85,
    maxY: y + fontSize * 0.25,
  };
}

interface CssStyleRule {
  selector: string;
  declarations: Record<string, string>;
}

function parseStyleRules(svgEl: Element): CssStyleRule[] {
  const rules: CssStyleRule[] = [];
  const styleText = collectElements(svgEl)
    .filter((el) => el.tagName.toLowerCase() === "style")
    .map((el) => (el.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n");

  // Strip @keyframes / @import / @media blocks before matching simple selector rules
  const cleaned = styleText
    .replace(/@[^{;]+;/g, "")
    .replace(/@(?:-webkit-)?keyframes\s+[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/gi, "");

  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(cleaned)) !== null) {
    const selectors = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const decls: Record<string, string> = {};
    for (const part of match[2].split(";")) {
      const idx = part.indexOf(":");
      if (idx === -1) continue;
      const prop = part.slice(0, idx).trim().toLowerCase();
      const val = part.slice(idx + 1).trim();
      if (prop && val) decls[prop] = val;
    }
    for (const selector of selectors) {
      rules.push({ selector, declarations: decls });
    }
  }
  return rules;
}

function resolveCssProp(
  el: Element,
  prop: string,
  cssRules: CssStyleRule[],
): string | null {
  const inlineVal = getInlineStyleValue(el, prop);
  if (inlineVal !== null) return inlineVal;

  const attrVal = el.getAttribute(prop);
  if (attrVal && attrVal.trim() !== "") return attrVal;

  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id")?.trim();
  const classes = (el.getAttribute("class") ?? "")
    .split(/\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  let matched: string | null = null;
  for (const rule of cssRules) {
    const val = rule.declarations[prop];
    if (!val) continue;
    const sel = rule.selector;
    if (sel === tag) {
      matched = val;
    } else if (sel.startsWith(".") && classes.includes(sel.slice(1))) {
      matched = val;
    } else if (id && sel === `#${id}`) {
      matched = val;
    }
  }
  return matched;
}

function getElementLocalBBox(
  el: Element,
  idMap: Map<string, Element>,
  cssRules: CssStyleRule[],
  visitedIds = new Set<string>(),
): BBox | null {
  const tag = el.tagName.toLowerCase();
  const pad = getStrokePadding(el);
  let box: BBox | null = null;

  if (tag === "rect") {
    const x = parseNumber(el.getAttribute("x"), 0);
    const y = parseNumber(el.getAttribute("y"), 0);
    const w = parseNumber(el.getAttribute("width"), 0);
    const h = parseNumber(el.getAttribute("height"), 0);
    box = { minX: x, minY: y, maxX: x + w, maxY: y + h };
  } else if (tag === "circle") {
    const cx = parseNumber(el.getAttribute("cx"), 0);
    const cy = parseNumber(el.getAttribute("cy"), 0);
    const r = Math.abs(parseNumber(el.getAttribute("r"), 0));
    box = { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
  } else if (tag === "ellipse") {
    const cx = parseNumber(el.getAttribute("cx"), 0);
    const cy = parseNumber(el.getAttribute("cy"), 0);
    const rx = Math.abs(parseNumber(el.getAttribute("rx"), 0));
    const ry = Math.abs(parseNumber(el.getAttribute("ry"), 0));
    box = { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
  } else if (tag === "line") {
    const x1 = parseNumber(el.getAttribute("x1"), 0);
    const y1 = parseNumber(el.getAttribute("y1"), 0);
    const x2 = parseNumber(el.getAttribute("x2"), 0);
    const y2 = parseNumber(el.getAttribute("y2"), 0);
    box = {
      minX: Math.min(x1, x2),
      minY: Math.min(y1, y2),
      maxX: Math.max(x1, x2),
      maxY: Math.max(y1, y2),
    };
  } else if (tag === "polyline" || tag === "polygon") {
    const raw = el.getAttribute("points") ?? "";
    const nums = raw
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    if (nums.length >= 2) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        minX = Math.min(minX, nums[i]);
        maxX = Math.max(maxX, nums[i]);
        minY = Math.min(minY, nums[i + 1]);
        maxY = Math.max(maxY, nums[i + 1]);
      }
      box = { minX, minY, maxX, maxY };
    }
  } else if (tag === "path") {
    const d = el.getAttribute("d");
    if (d) box = computePathBBox(d);
  } else if (tag === "use") {
    const href = (
      el.getAttribute("href") ??
      el.getAttribute("xlink:href") ??
      ""
    ).trim();
    const ux = parseNumber(el.getAttribute("x"), 0);
    const uy = parseNumber(el.getAttribute("y"), 0);
    if (href.startsWith("#")) {
      const targetId = href.slice(1);
      const target = idMap.get(targetId);
      if (target && !visitedIds.has(targetId)) {
        visitedIds.add(targetId);
        const targetBox = getSubtreeBBox(target, idMap, cssRules, visitedIds);
        visitedIds.delete(targetId);
        if (targetBox) {
          box = {
            minX: targetBox.minX + ux,
            minY: targetBox.minY + uy,
            maxX: targetBox.maxX + ux,
            maxY: targetBox.maxY + uy,
          };
        }
      }
    }
    if (!box && (el.hasAttribute("x") || el.hasAttribute("y"))) {
      box = { minX: ux, minY: uy, maxX: ux, maxY: uy };
    }
  } else if (tag === "text") {
    const parentX = parseNumber(el.getAttribute("x"), 0);
    const parentY = parseNumber(el.getAttribute("y"), 0);
    const fontSizeRaw = resolveCssProp(el, "font-size", cssRules);
    const parentFontSize = Math.max(6, parseNumber(fontSizeRaw, 14));
    const parentAnchor = (
      resolveCssProp(el, "text-anchor", cssRules) ?? "start"
    ).toLowerCase();

    const tspans: Element[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "tspan") {
        tspans.push(child as Element);
      }
    }

    const hasPositionedTspans = tspans.some(
      (ts) => ts.hasAttribute("x") || ts.hasAttribute("y"),
    );

    if (hasPositionedTspans) {
      const spanBoxes: BBox[] = [];
      let curX = parentX;
      let curY = parentY;
      for (const ts of tspans) {
        const content = getVisibleTextContent(ts).replace(/\s+/g, " ").trim();
        const tx = ts.hasAttribute("x")
          ? parseNumber(ts.getAttribute("x"), curX)
          : curX;
        const ty = ts.hasAttribute("y")
          ? parseNumber(ts.getAttribute("y"), curY)
          : curY;
        const tsFontRaw = resolveCssProp(ts, "font-size", cssRules);
        const fs = tsFontRaw ? Math.max(6, parseNumber(tsFontRaw, parentFontSize)) : parentFontSize;
        const anchor = (
          resolveCssProp(ts, "text-anchor", cssRules) ?? parentAnchor
        ).toLowerCase();
        if (content) {
          spanBoxes.push(estimateTextSpanBBox(content, tx, ty, fs, anchor));
        }
        curX = tx;
        curY = ty;
      }
      return unionBBoxes(spanBoxes);
    }

    const content = getVisibleTextContent(el).replace(/\s+/g, " ").trim();
    if (!content) return null;
    return estimateTextSpanBBox(content, parentX, parentY, parentFontSize, parentAnchor);
  }

  if (!box) return null;
  return {
    minX: box.minX - pad,
    minY: box.minY - pad,
    maxX: box.maxX + pad,
    maxY: box.maxY + pad,
  };
}

function getSubtreeBBox(
  el: Element,
  idMap: Map<string, Element>,
  cssRules: CssStyleRule[],
  visitedIds: Set<string>,
): BBox | null {
  const tag = el.tagName.toLowerCase();
  const matrix = parseTransform(el.getAttribute("transform"));

  if (tag !== "g" && tag !== "svg") {
    const local = getElementLocalBBox(el, idMap, cssRules, visitedIds);
    return local ? transformBBox(local, matrix) : null;
  }

  const childBoxes: BBox[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child.nodeType === 1) {
      const b = getSubtreeBBox(child as Element, idMap, cssRules, visitedIds);
      if (b) childBoxes.push(b);
    }
  }
  const union = unionBBoxes(childBoxes);
  return union ? transformBBox(union, matrix) : null;
}

function collectElements(root: Element): Element[] {
  const items: Element[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === 1) {
      const el = node as Element;
      items.push(el);
      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i]);
      }
    }
  };
  walk(root);
  return items;
}

function checkViewBox(svgEl: Element): { passed: boolean; message: string } {
  const vbRaw = svgEl.getAttribute("viewBox");
  if (!vbRaw) {
    return {
      passed: false,
      message: "Missing viewBox attribute on <svg>.",
    };
  }

  const parts = vbRaw.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return {
      passed: false,
      message: `Invalid viewBox="${vbRaw}". Expected 4 numbers: "minX minY width height".`,
    };
  }

  const [vbX, vbY, vbW, vbH] = parts;
  if (vbW <= 0 || vbH <= 0) {
    return {
      passed: false,
      message: `Invalid viewBox dimensions (${vbW}x${vbH}). Width and height must be > 0.`,
    };
  }

  const idMap = new Map<string, Element>();
  for (const el of collectElements(svgEl)) {
    const id = el.getAttribute("id");
    if (id) idMap.set(id, el);
  }
  const cssRules = parseStyleRules(svgEl);

  const maxAllowedX = vbX + vbW + VIEWBOX_TOLERANCE;
  const maxAllowedY = vbY + vbH + VIEWBOX_TOLERANCE;
  const minAllowedX = vbX - VIEWBOX_TOLERANCE;
  const minAllowedY = vbY - VIEWBOX_TOLERANCE;

  const violations: string[] = [];

  const traverse = (node: Node, parentMatrix: Matrix2D) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED_CONTAINERS.has(tag)) return;

    const currentMatrix = multiplyMatrices(
      parentMatrix,
      parseTransform(el.getAttribute("transform")),
    );

    if (tag !== "svg" && tag !== "g") {
      try {
        // Elements driven by child <animateMotion> follow the motion path, not static (0,0)
        const motionChild = Array.from(el.childNodes).find(
          (c) => c.nodeType === 1 && (c as Element).tagName.toLowerCase() === "animatemotion",
        ) as Element | undefined;

        let local: BBox | null = null;
        if (motionChild) {
          let motionPathD = motionChild.getAttribute("path");
          if (!motionPathD) {
            const mpath = Array.from(motionChild.childNodes).find(
              (c) => c.nodeType === 1 && (c as Element).tagName.toLowerCase() === "mpath",
            ) as Element | undefined;
            const href = (
              mpath?.getAttribute("href") ??
              mpath?.getAttribute("xlink:href") ??
              ""
            ).trim();
            if (href.startsWith("#")) {
              const target = idMap.get(href.slice(1));
              motionPathD =
                target?.getAttribute("d") ??
                resolveCssProp(target as Element, "d", cssRules)?.replace(/^path\(["']?|["']?\)$/g, "") ??
                null;
            }
          }
          const pathBox = motionPathD ? computePathBBox(motionPathD) : null;
          const baseBox = getElementLocalBBox(el, idMap, cssRules);
          if (pathBox && baseBox) {
            const halfW = (baseBox.maxX - baseBox.minX) / 2;
            const halfH = (baseBox.maxY - baseBox.minY) / 2;
            local = {
              minX: pathBox.minX - halfW,
              minY: pathBox.minY - halfH,
              maxX: pathBox.maxX + halfW,
              maxY: pathBox.maxY + halfH,
            };
          } else {
            local = pathBox;
          }
        } else {
          local = getElementLocalBBox(el, idMap, cssRules);
        }

        if (local) {
          const box = transformBBox(local, currentMatrix);
          if (
            box.minX < minAllowedX ||
            box.minY < minAllowedY ||
            box.maxX > maxAllowedX ||
            box.maxY > maxAllowedY
          ) {
            violations.push(
              `<${tag}> bounds [${box.minX.toFixed(1)}, ${box.minY.toFixed(1)}, ${box.maxX.toFixed(1)}, ${box.maxY.toFixed(1)}] exceed viewBox [${vbX}, ${vbY}, ${vbX + vbW}, ${vbY + vbH}]`,
            );
          }
        }
      } catch (err) {
        violations.push(
          `<${tag}> could not be bounded (${err instanceof Error ? err.message : "parse error"})`,
        );
      }
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      traverse(el.childNodes[i], currentMatrix);
    }
  };

  traverse(svgEl, IDENTITY_MATRIX);

  if (violations.length > 0) {
    return {
      passed: false,
      message: `Drawn outside viewBox (${violations.length} issue${violations.length > 1 ? "s" : ""}): ${violations.slice(0, 3).join("; ")}`,
    };
  }

  return {
    passed: true,
    message: `All elements fit cleanly inside viewBox="${vbRaw}".`,
  };
}

function checkTitleAndLabels(elements: Element[]): {
  passed: boolean;
  message: string;
} {
  const titles = elements.filter(
    (el) =>
      el.tagName.toLowerCase() === "title" &&
      (el.textContent ?? "").trim().length > 0,
  );
  const textLabels = elements.filter(
    (el) =>
      el.tagName.toLowerCase() === "text" &&
      getVisibleTextContent(el).trim().length > 0,
  );

  if (titles.length === 0) {
    return {
      passed: false,
      message: `Missing non-empty <title> element (found ${textLabels.length} text labels).`,
    };
  }
  if (textLabels.length < 3) {
    return {
      passed: false,
      message: `Found <title>, but only ${textLabels.length} non-empty <text> label(s); at least 3 required.`,
    };
  }

  return {
    passed: true,
    message: `Found <title> and ${textLabels.length} <text> labels.`,
  };
}

function hasPositiveDur(el: Element): boolean {
  const dur = (el.getAttribute("dur") ?? "").trim().toLowerCase();
  if (!dur) return false;
  if (dur === "indefinite") return true;
  const num = Number.parseFloat(dur);
  return Number.isFinite(num) && num > 0;
}

function checkAnimation(elements: Element[]): {
  passed: boolean;
  message: string;
} {
  const smilAnims = elements.filter((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "animatemotion") {
      const hasDur = hasPositiveDur(el);
      const hasPath =
        Boolean(el.getAttribute("path")) ||
        collectElements(el).some((c) => c.tagName.toLowerCase() === "mpath");
      return hasDur && hasPath;
    }
    if (tag === "animate" || tag === "animatetransform" || tag === "set") {
      return Boolean(el.getAttribute("attributeName")) && hasPositiveDur(el);
    }
    return false;
  });

  if (smilAnims.length > 0) {
    return {
      passed: true,
      message: `Found ${smilAnims.length} SMIL animation element(s).`,
    };
  }

  const styleBlocks = elements
    .filter((el) => el.tagName.toLowerCase() === "style")
    .map((el) => (el.textContent ?? "").replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n");

  const keyframeNames = new Set<string>();
  const kfRegex = /@(?:-webkit-)?keyframes\s+([a-zA-Z0-9_-]+)/g;
  let kfMatch: RegExpExecArray | null;
  while ((kfMatch = kfRegex.exec(styleBlocks)) !== null) {
    keyframeNames.add(kfMatch[1]);
  }

  if (keyframeNames.size > 0) {
    const inlineStyles = elements
      .map((el) => el.getAttribute("style") ?? "")
      .join("\n");
    const allCss = `${styleBlocks}\n${inlineStyles}`;
    const animPropRegex = /animation(?:-name)?\s*:\s*([^;}{]+)/gi;
    let animMatch: RegExpExecArray | null;
    while ((animMatch = animPropRegex.exec(allCss)) !== null) {
      const value = animMatch[1].trim();
      if (value.toLowerCase() === "none") continue;
      for (const name of keyframeNames) {
        if (new RegExp(`\\b${name}\\b`).test(value)) {
          return {
            passed: true,
            message: `Found CSS @keyframes animation ("${name}").`,
          };
        }
      }
    }
  }

  return {
    passed: false,
    message:
      "No valid SMIL (<animate>/<animateTransform>/<animateMotion>) or referenced CSS @keyframes animation found.",
  };
}

function checkSafeAndSubstantial(svgEl: Element): {
  passed: boolean;
  message: string;
} {
  const allElements = collectElements(svgEl);

  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "foreignobject") {
      return {
        passed: false,
        message: `Disallowed <${tag}> element found in SVG.`,
      };
    }

    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i];
      const name = attr.name.toLowerCase();
      const value = (attr.value ?? "").trim();

      if (name.startsWith("on")) {
        return {
          passed: false,
          message: `Disallowed event handler attribute "${attr.name}" on <${tag}>.`,
        };
      }

      if (
        (name === "href" || name === "xlink:href" || name === "src") &&
        /^(?:https?:|\/\/|javascript:)/i.test(value)
      ) {
        return {
          passed: false,
          message: `Disallowed external/unsafe URI in ${attr.name}="${value}".`,
        };
      }
    }
  }

  let shapeCount = 0;
  const countShapes = (node: Node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (SKIPPED_CONTAINERS.has(tag)) return;
    if (GEOMETRY_TAGS.has(tag) || tag === "use") shapeCount++;
    for (let i = 0; i < el.childNodes.length; i++) {
      countShapes(el.childNodes[i]);
    }
  };
  countShapes(svgEl);

  if (shapeCount < 3) {
    return {
      passed: false,
      message: `Only ${shapeCount} geometric shape(s) found outside <defs>; expected at least 3 for a meaningful diagram.`,
    };
  }

  return {
    passed: true,
    message: `Self-contained SVG with ${shapeCount} geometric shapes and no unsafe tags/URLs.`,
  };
}

/**
 * Runs all 5 programmatic SVG validation checks (4 required + 1 custom).
 */
export function validateSvg(rawOutput: string): {
  svg: string;
  checks: CheckResult[];
  passedAll: boolean;
} {
  const extracted = extractSvg(rawOutput);
  if (!extracted) {
    const checks: CheckResult[] = [
      {
        id: "valid_svg",
        label: "Valid SVG",
        passed: false,
        message: "No <svg>...</svg> markup found in model output.",
      },
      {
        id: "within_viewbox",
        label: "Inside viewBox",
        passed: false,
        message: "Skipped because SVG could not be extracted.",
      },
      {
        id: "title_and_labels",
        label: "Title & 3+ Labels",
        passed: false,
        message: "Skipped because SVG could not be extracted.",
      },
      {
        id: "has_animation",
        label: "Animated",
        passed: false,
        message: "Skipped because SVG could not be extracted.",
      },
      {
        id: "safe_and_substantial",
        label: "Safe & Substantial",
        passed: false,
        message: "Skipped because SVG could not be extracted.",
      },
    ];
    return { svg: rawOutput.trim(), checks, passedAll: false };
  }

  const parseErrors: string[] = [];
  const withoutCommentsOrCdata = extracted
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(withoutCommentsOrCdata)) {
    parseErrors.push(
      "Unescaped '&' found outside XML comments or CDATA; replace with '&amp;' or 'and'.",
    );
  }

  const parser = new DOMParser({
    errorHandler: {
      warning: (msg: string) => parseErrors.push(msg),
      error: (msg: string) => parseErrors.push(msg),
      fatalError: (msg: string) => parseErrors.push(msg),
    },
  });

  let doc: Document | null = null;
  try {
    doc = parser.parseFromString(extracted, "image/svg+xml");
  } catch (err) {
    parseErrors.push(err instanceof Error ? err.message : "XML parser threw an error");
  }

  const root = doc?.documentElement;
  const isValidRoot = Boolean(root && root.tagName.toLowerCase() === "svg");

  if (parseErrors.length > 0 || !isValidRoot || !root) {
    const reason =
      parseErrors.length > 0
        ? `XML parse error: ${parseErrors[0]}`
        : "Root element is not <svg>.";
    const checks: CheckResult[] = [
      { id: "valid_svg", label: "Valid SVG", passed: false, message: reason },
      {
        id: "within_viewbox",
        label: "Inside viewBox",
        passed: false,
        message: "Skipped due to invalid XML.",
      },
      {
        id: "title_and_labels",
        label: "Title & 3+ Labels",
        passed: false,
        message: "Skipped due to invalid XML.",
      },
      {
        id: "has_animation",
        label: "Animated",
        passed: false,
        message: "Skipped due to invalid XML.",
      },
      {
        id: "safe_and_substantial",
        label: "Safe & Substantial",
        passed: false,
        message: "Skipped due to invalid XML.",
      },
    ];
    return { svg: extracted, checks, passedAll: false };
  }

  const allElements = collectElements(root);
  const viewBoxRes = checkViewBox(root);
  const labelsRes = checkTitleAndLabels(allElements);
  const animRes = checkAnimation(allElements);
  const customRes = checkSafeAndSubstantial(root);

  const checks: CheckResult[] = [
    {
      id: "valid_svg",
      label: "Valid SVG",
      passed: true,
      message: "SVG parsed cleanly with zero XML errors.",
    },
    {
      id: "within_viewbox",
      label: "Inside viewBox",
      passed: viewBoxRes.passed,
      message: viewBoxRes.message,
    },
    {
      id: "title_and_labels",
      label: "Title & 3+ Labels",
      passed: labelsRes.passed,
      message: labelsRes.message,
    },
    {
      id: "has_animation",
      label: "Animated",
      passed: animRes.passed,
      message: animRes.message,
    },
    {
      id: "safe_and_substantial",
      label: "Safe & Substantial",
      passed: customRes.passed,
      message: customRes.message,
    },
  ];

  return {
    svg: extracted,
    checks,
    passedAll: checks.every((c) => c.passed),
  };
}
