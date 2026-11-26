import { NextResponse } from "next/server";
import { getConceptById } from "@/data/concepts";
import { generateAndValidateDiagram } from "@/lib/diagram-generator";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      conceptId?: unknown;
    } | null;

    const conceptId =
      typeof body?.conceptId === "string" ? body.conceptId.trim() : "";
    const concept = getConceptById(conceptId);

    if (!concept) {
      return NextResponse.json(
        {
          error:
            "Invalid or missing conceptId. Choose one of the 5 GCSE concepts.",
        },
        { status: 400 },
      );
    }

    const result = await generateAndValidateDiagram(concept, {
      backoffMode: "serverless",
    });

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate diagram.";
    const status = message.includes("429")
      ? 429
      : message.includes("503")
        ? 503
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
