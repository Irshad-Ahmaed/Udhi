import fs from "node:fs";
import path from "node:path";
import { ReviewDashboard } from "@/app/components/ReviewDashboard";
import { CONCEPTS } from "@/data/concepts";
import type { DiagramResult, ResultsFile } from "@/lib/types";

function loadSavedResults(): {
  results: DiagramResult[];
  loadedFromFile: boolean;
} {
  const filePath = path.join(process.cwd(), "results.json");
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as ResultsFile;
      if (Array.isArray(parsed?.results) && parsed.results.length > 0) {
        return { results: parsed.results, loadedFromFile: true };
      }
    }
  } catch {
    // Fall back to empty concept placeholders if results.json is unreadable
  }

  const placeholders: DiagramResult[] = CONCEPTS.map((c) => ({
    conceptId: c.id,
    concept: c.name,
    subject: c.subject,
    promptText: c.promptText,
    model: "not-generated",
    svg: "",
    checks: [
      { id: "valid_svg", label: "Valid SVG", passed: false, message: "Pending generation" },
      { id: "within_viewbox", label: "Inside viewBox", passed: false, message: "Pending generation" },
      { id: "title_and_labels", label: "Title & 3+ Labels", passed: false, message: "Pending generation" },
      { id: "has_animation", label: "Animated", passed: false, message: "Pending generation" },
      { id: "safe_and_substantial", label: "Safe & Substantial", passed: false, message: "Pending generation" },
    ],
    passedAll: false,
    inputTokens: 0,
    outputTokens: 0,
    thoughtsTokenCount: 0,
    estimatedCostUsd: 0,
    retries: 0,
    apiRetries: 0,
    generatedAt: "",
  }));

  return { results: placeholders, loadedFromFile: false };
}

export default function HomePage() {
  const { results, loadedFromFile } = loadSavedResults();
  return (
    <main>
      <ReviewDashboard
        initialResults={results}
        resultsLoadedFromFile={loadedFromFile}
      />
    </main>
  );
}
