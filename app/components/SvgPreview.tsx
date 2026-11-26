"use client";

import { useEffect, useRef } from "react";

interface SvgPreviewProps {
  svg: string;
  maxHeight?: number;
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
          height: auto;
          max-height: ${maxHeight}px;
        }
      </style>
      <div class="frame">${svg}</div>
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
