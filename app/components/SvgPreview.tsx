"use client";

import { useEffect, useRef } from "react";

interface SvgPreviewProps {
  svg: string;
  maxHeight?: number;
}

function sanitizeSvgForPreview(rawSvg: string): string {
  try {
    const doc = new window.DOMParser().parseFromString(rawSvg, "image/svg+xml");
    if (doc.querySelector("parsererror")) {
      return "";
    }
    doc
      .querySelectorAll("script, foreignObject")
      .forEach((node) => node.remove());

    doc.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const val = attr.value.trim();
        if (name.startsWith("on")) {
          el.removeAttribute(attr.name);
        } else if (
          (name === "href" || name === "xlink:href" || name === "src") &&
          /^(?:https?:|\/\/|javascript:)/i.test(val)
        ) {
          el.removeAttribute(attr.name);
        }
      }
    });

    const svgEl = doc.documentElement;
    return svgEl?.tagName.toLowerCase() === "svg"
      ? new window.XMLSerializer().serializeToString(svgEl)
      : "";
  } catch {
    return "";
  }
}

/**
 * Renders an AI-generated SVG inside a Shadow DOM root so CSS @keyframes,
 * class names, and SVG gradient/marker IDs never collide across the 5 rows.
 */
export function SvgPreview({ svg, maxHeight = 260 }: SvgPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const safeSvg = sanitizeSvgForPreview(svg);

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }
        .frame {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        svg {
          display: block;
          width: 100%;
          max-width: 100%;
          height: auto;
          max-height: ${maxHeight}px;
        }
        .fallback {
          padding: 1.5rem;
          text-align: center;
          font-size: 0.75rem;
          color: #64748b;
        }
      </style>
      <div class="frame">${safeSvg || '<div class="fallback">Invalid or unsafe SVG cannot be previewed.</div>'}</div>
    `;
  }, [svg, maxHeight]);

  return (
    <div
      ref={hostRef}
      className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-xs"
      aria-label="Animated SVG diagram preview"
    />
  );
}
