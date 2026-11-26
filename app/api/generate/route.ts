import { NextResponse } from "next/server";
import { getConceptById } from "@/data/concepts";
import { generateAndValidateDiagram } from "@/lib/diagram-generator";

export const maxDuration = 60;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 10;

function isCrossOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Enforces cross-instance rate limiting when Upstash Redis REST credentials
 * are configured in host environment variables.
 */
async function checkDistributedRateLimit(
  clientIp: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    return { allowed: true };
  }

  const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SECONDS * 1000));
  const key = `udhi:rl:generate:${clientIp}:${bucket}`;

  const res = await fetch(`${url.replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([
      ["INCR", key],
      ["EXPIRE", key, RATE_LIMIT_WINDOW_SECONDS],
    ]),
  });

  if (!res.ok) {
    return { allowed: true };
  }

  const data = (await res.json()) as Array<{ result?: number }>;
  const count = Number(data?.[0]?.result ?? 0);
  if (count > RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS };
  }
  return { allowed: true };
}

export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const requiredAccessToken = process.env.GENERATE_ACCESS_TOKEN?.trim();
  if (requiredAccessToken) {
    const provided = request.headers.get("x-generate-token")?.trim();
    if (provided !== requiredAccessToken) {
      return NextResponse.json(
        { error: "Unauthorized live generation request." },
        { status: 401 },
      );
    }
  }

  const rateLimit = await checkDistributedRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please wait a minute and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds ?? 60),
        },
      },
    );
  }

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

    return NextResponse.json(
      { result },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
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
