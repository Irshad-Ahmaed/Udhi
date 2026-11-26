import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { CONCEPTS } from "@/data/concepts";
import {
  DEFAULT_MODEL,
  generateAndValidateDiagram,
} from "@/lib/diagram-generator";
import type { DiagramResult, ResultsFile } from "@/lib/types";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const model = DEFAULT_MODEL;
  console.info(
    `\nStarting diagram generation for ${CONCEPTS.length} concepts using model "${model}"...\n`,
  );

  const results: DiagramResult[] = [];

  for (let i = 0; i < CONCEPTS.length; i++) {
    const concept = CONCEPTS[i];
    console.info(`[${i + 1}/${CONCEPTS.length}] Generating "${concept.name}"...`);

    const result = await generateAndValidateDiagram(concept, {
      model,
      backoffMode: "cli",
    });
    results.push(result);

    if (i < CONCEPTS.length - 1) {
      await sleep(1500);
    }
  }

  const output: ResultsFile = {
    generatedAt: new Date().toISOString(),
    model,
    results,
  };

  const outPath = path.join(process.cwd(), "results.json");
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf-8");

  console.info(`\nSaved ${results.length} results to ${outPath}\n`);
  console.table(
    results.map((r) => ({
      Concept: r.concept,
      Status: r.passedAll ? "PASS" : "FAIL",
      InputTokens: r.inputTokens,
      OutputTokens: r.outputTokens,
      CostUSD: `$${r.estimatedCostUsd.toFixed(6)}`,
      Retries: r.retries,
      ApiRetries: r.apiRetries,
    })),
  );
}

main().catch((err) => {
  console.error("Fatal generation error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
