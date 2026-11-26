import { GoogleGenAI } from "@google/genai";
import { estimateCostUsd } from "@/lib/pricing";
import { validateSvg } from "@/lib/svg-validator";
import type { CheckResult, Concept, DiagramResult } from "@/lib/types";

export const DEFAULT_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";

const MAX_API_RETRIES = 3;
const MAX_VALIDATION_RETRIES = 1;

export interface GeneratorOptions {
  model?: string;
  backoffMode?: "cli" | "serverless";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as Record<string, unknown>;
  const status = Number(record.status ?? record.code ?? record.statusCode);
  if (status === 429 || status === 503) return true;

  const message =
    err instanceof Error ? err.message : JSON.stringify(record);
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|rate limit|overloaded|high demand/i.test(
    message,
  );
}

function formatGeminiError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return typeof err === "string" ? err : "Unknown Gemini API error";
}

function buildInitialPrompt(concept: Concept): string {
  return [
    `Create one educational animated SVG diagram for UK GCSE ${concept.subject} students.`,
    `Concept: ${concept.name}`,
    `Explanation to illustrate: "${concept.promptText}"`,
    "",
    "Strict technical requirements:",
    '1. Return ONLY raw SVG markup starting with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"> and ending with </svg>. Do NOT include markdown fences or any prose.',
    "2. Keep ALL shapes, paths, strokes, and text labels strictly inside the viewBox (keep all coordinates comfortably within x: 25..575 and y: 25..375 so nothing clips).",
    "3. Include a descriptive <title> element AND at least 4 clear, readable <text> labels (including a visible diagram heading and labels for the key parts) with high contrast on a light (#ffffff or #f8fafc) background.",
    "4. Include at least one meaningful, smooth CSS (@keyframes inside <style>) or SMIL (<animate>, <animateTransform>, or <animateMotion> with dur) animation that visually demonstrates the concept.",
    "5. Use only self-contained SVG shapes and styles (no <script>, no event handlers, no <foreignObject>, no external URLs).",
  ].join("\n");
}

function buildRetryPrompt(
  concept: Concept,
  previousSvg: string,
  failedChecks: CheckResult[],
): string {
  const failureSummary = failedChecks
    .map((c) => `- ${c.label} (${c.id}): ${c.message}`)
    .join("\n");

  const truncatedPrev =
    previousSvg.length > 6000
      ? `${previousSvg.slice(0, 6000)}\n<!-- truncated -->`
      : previousSvg;

  return [
    `Your previous SVG diagram for "${concept.name}" (${concept.subject}) failed automated validation checks.`,
    `Concept explanation: "${concept.promptText}"`,
    "",
    "Why the previous SVG failed:",
    failureSummary,
    "",
    "Fix ALL of the issues above and return ONLY valid raw SVG markup:",
    '- Must start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"> and end with </svg> (no markdown fences).',
    "- Every shape, path, and <text> label must fit cleanly inside x: 25..575, y: 25..375.",
    "- Include a non-empty <title> element and at least 3 readable <text> labels.",
    "- Include a working SMIL animation (<animate>/<animateTransform>/<animateMotion> with dur) or CSS @keyframes animation referenced by an element.",
    "- Include at least 3 geometric shapes and no <script> or external URLs.",
    "",
    "Previous SVG for reference:",
    truncatedPrev,
  ].join("\n");
}

async function callGeminiWithBackoff(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
  backoffMode: "cli" | "serverless",
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokenCount: number;
  apiRetries: number;
}> {
  let apiRetries = 0;

  for (let attempt = 0; attempt <= MAX_API_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      const text = response.text ?? "";
      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? 0;
      const candidatesTokens = usage?.candidatesTokenCount ?? 0;
      const thoughtsTokenCount = usage?.thoughtsTokenCount ?? 0;
      const outputTokens = candidatesTokens + thoughtsTokenCount;

      return {
        text,
        inputTokens,
        outputTokens,
        thoughtsTokenCount,
        apiRetries,
      };
    } catch (err) {
      if (!isRetryableGeminiError(err) || attempt >= MAX_API_RETRIES) {
        throw new Error(
          `Gemini API error after ${apiRetries} retry(ies): ${formatGeminiError(err)}`,
        );
      }

      apiRetries++;
      const jitter = Math.floor(Math.random() * 400);
      const rawDelay =
        backoffMode === "cli"
          ? 2000 * Math.pow(2, attempt) + jitter
          : Math.min(4000, 1500 * Math.pow(2, attempt)) + jitter;

      console.warn(
        `[gemini] Transient 429/503 error on attempt ${attempt + 1}/${MAX_API_RETRIES + 1}. Waiting ${rawDelay}ms before retry...`,
      );
      await sleep(rawDelay);
    }
  }

  throw new Error("Exhausted Gemini API retries unexpectedly.");
}

/**
 * Generates an animated SVG diagram for one concept, runs all 5 code checks,
 * retries once with failure feedback if any check fails, and logs usage/cost.
 */
export async function generateAndValidateDiagram(
  concept: Concept,
  options: GeneratorOptions = {},
): Promise<DiagramResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local locally or your hosting provider's environment variables.",
    );
  }

  const model = options.model ?? DEFAULT_MODEL;
  const backoffMode = options.backoffMode ?? "serverless";
  const ai = new GoogleGenAI({ apiKey });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalThoughtsTokens = 0;
  let totalApiRetries = 0;
  let validationRetries = 0;

  const firstCall = await callGeminiWithBackoff(
    ai,
    model,
    buildInitialPrompt(concept),
    backoffMode,
  );
  totalInputTokens += firstCall.inputTokens;
  totalOutputTokens += firstCall.outputTokens;
  totalThoughtsTokens += firstCall.thoughtsTokenCount;
  totalApiRetries += firstCall.apiRetries;

  let finalValidation = validateSvg(firstCall.text);

  if (!finalValidation.passedAll && MAX_VALIDATION_RETRIES > 0) {
    validationRetries = 1;
    const failedChecks = finalValidation.checks.filter((c) => !c.passed);
    console.warn(
      `[validate] "${concept.name}" failed ${failedChecks.length} check(s): ${failedChecks.map((c) => c.id).join(", ")}. Retrying once with feedback...`,
    );

    const retryCall = await callGeminiWithBackoff(
      ai,
      model,
      buildRetryPrompt(concept, finalValidation.svg, failedChecks),
      backoffMode,
    );
    totalInputTokens += retryCall.inputTokens;
    totalOutputTokens += retryCall.outputTokens;
    totalThoughtsTokens += retryCall.thoughtsTokenCount;
    totalApiRetries += retryCall.apiRetries;

    finalValidation = validateSvg(retryCall.text);
  }

  const estimatedCostUsd = estimateCostUsd(
    model,
    totalInputTokens,
    totalOutputTokens,
  );

  const checkSummary = finalValidation.checks
    .map((c) => `${c.id}:${c.passed ? "PASS" : "FAIL"}`)
    .join(" ");

  console.info(
    `[diagram-generator] concept="${concept.name}" model=${model} in=${totalInputTokens} out=${totalOutputTokens} cost=$${estimatedCostUsd.toFixed(6)} retries=${validationRetries} apiRetries=${totalApiRetries} checks=[${checkSummary}]`,
  );

  return {
    conceptId: concept.id,
    concept: concept.name,
    subject: concept.subject,
    promptText: concept.promptText,
    model,
    svg: finalValidation.svg,
    checks: finalValidation.checks,
    passedAll: finalValidation.passedAll,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    thoughtsTokenCount: totalThoughtsTokens,
    estimatedCostUsd,
    retries: validationRetries,
    apiRetries: totalApiRetries,
    generatedAt: new Date().toISOString(),
  };
}
