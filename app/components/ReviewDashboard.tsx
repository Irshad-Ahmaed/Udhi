"use client";

import { useEffect, useMemo, useState } from "react";
import { SvgPreview } from "@/app/components/SvgPreview";
import { CONCEPTS } from "@/data/concepts";
import type { DiagramResult } from "@/lib/types";

type Decision = "approved" | "rejected" | null;

interface ReviewEntry {
  decision: Decision;
  note: string;
  updatedAt?: string;
}

type ReviewState = Record<string, ReviewEntry>;

const STORAGE_KEY = "udhi_diagram_reviews_v1";

interface ReviewDashboardProps {
  initialResults: DiagramResult[];
  resultsLoadedFromFile: boolean;
}

export function ReviewDashboard({
  initialResults,
  resultsLoadedFromFile,
}: ReviewDashboardProps) {
  const [results, setResults] = useState<DiagramResult[]>(initialResults);
  const [liveIds, setLiveIds] = useState<Record<string, boolean>>({});
  const [reviews, setReviews] = useState<ReviewState>({});
  const [hydrated, setHydrated] = useState(false);

  const [selectedConceptId, setSelectedConceptId] = useState<string>(
    CONCEPTS[0].id,
  );
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [expandedSvg, setExpandedSvg] = useState<DiagramResult | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ReviewState;
        if (parsed && typeof parsed === "object") {
          setReviews(parsed);
        }
      }
    } catch {
      // Ignore malformed localStorage state
    } finally {
      setHydrated(true);
    }
  }, []);

  const persistReviews = (next: ReviewState) => {
    setReviews(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  };

  const setDecision = (conceptId: string, decision: Decision) => {
    const prev = reviews[conceptId] ?? { decision: null, note: "" };
    const nextDecision = prev.decision === decision ? null : decision;
    persistReviews({
      ...reviews,
      [conceptId]: {
        ...prev,
        decision: nextDecision,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const setNote = (conceptId: string, note: string) => {
    const prev = reviews[conceptId] ?? { decision: null, note: "" };
    persistReviews({
      ...reviews,
      [conceptId]: {
        ...prev,
        note,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const handleGenerate = async (conceptId: string) => {
    if (generatingId) return;
    setGeneratingId(conceptId);
    setErrorBanner(null);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId }),
      });

      const payload = (await response.json().catch(() => null)) as {
        result?: DiagramResult;
        error?: string;
      } | null;

      if (!response.ok || !payload?.result) {
        throw new Error(
          payload?.error || `Request failed with HTTP ${response.status}.`,
        );
      }

      const fresh = payload.result;
      setResults((prev) =>
        prev.map((item) => (item.conceptId === conceptId ? fresh : item)),
      );
      setLiveIds((prev) => ({ ...prev, [conceptId]: true }));
    } catch (err) {
      setErrorBanner(
        err instanceof Error
          ? err.message
          : "Unexpected error while generating diagram.",
      );
    } finally {
      setGeneratingId(null);
    }
  };

  const resetToSaved = () => {
    setResults(initialResults);
    setLiveIds({});
    setErrorBanner(null);
  };

  const stats = useMemo(() => {
    const passedCount = results.filter((r) => r.passedAll).length;
    const totalCost = results.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const totalRetries = results.reduce((sum, r) => sum + r.retries, 0);
    const approvedCount = results.filter(
      (r) => reviews[r.conceptId]?.decision === "approved",
    ).length;
    return { passedCount, totalCost, totalRetries, approvedCount };
  }, [results, reviews]);

  const hasLiveOverrides = Object.values(liveIds).some(Boolean);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xs lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-wider text-indigo-600 uppercase">
            Udhi Technologies — GCSE Science Diagram Reviewer
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            Science Diagram Maker
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            5 animated SVG diagrams validated in code with automatic retry and
            persistent reviewer decisions.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Checks Passed</div>
            <div className="text-lg font-semibold text-slate-900">
              {stats.passedCount} / {results.length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Approved</div>
            <div className="text-lg font-semibold text-emerald-700">
              {hydrated ? stats.approvedCount : "—"} / {results.length}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Est. Cost (USD)</div>
            <div className="text-lg font-semibold text-slate-900">
              ${stats.totalCost.toFixed(5)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-xs text-slate-500">Val. Retries</div>
            <div className="text-lg font-semibold text-slate-900">
              {stats.totalRetries}
            </div>
          </div>
        </div>
      </header>

      <section
        aria-label="Live generation test bar"
        className="mb-6 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label
            htmlFor="concept-select"
            className="text-sm font-medium text-slate-700"
          >
            Test live Part A generation:
          </label>
          <select
            id="concept-select"
            value={selectedConceptId}
            onChange={(e) => setSelectedConceptId(e.target.value)}
            disabled={Boolean(generatingId)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
          >
            {CONCEPTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number}. {c.name} ({c.subject})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleGenerate(selectedConceptId)}
            disabled={Boolean(generatingId)}
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generatingId === selectedConceptId ? "Generating..." : "Generate"}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-500">
          {!resultsLoadedFromFile && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
              results.json not generated yet
            </span>
          )}
          {hasLiveOverrides && (
            <button
              type="button"
              onClick={resetToSaved}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
            >
              Reset to saved results.json
            </button>
          )}
        </div>
      </section>

      {errorBanner && (
        <div
          role="alert"
          className="mb-6 flex items-start justify-between gap-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
        >
          <div>
            <span className="font-semibold">Generation failed: </span>
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs">
        <table className="w-full min-w-[980px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-600 uppercase">
              <th className="w-56 px-4 py-3">Concept</th>
              <th className="w-80 px-4 py-3">Diagram (Animated)</th>
              <th className="w-60 px-4 py-3">Code Checks</th>
              <th className="w-44 px-4 py-3">Cost &amp; Retries</th>
              <th className="w-64 px-4 py-3">Approve / Reject &amp; Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {results.map((row) => {
              const review = reviews[row.conceptId] ?? {
                decision: null,
                note: "",
              };
              const isGeneratingThis = generatingId === row.conceptId;

              return (
                <tr key={row.conceptId} className="align-top hover:bg-slate-50/50">
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {row.concept}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {row.subject}
                      </span>
                      {liveIds[row.conceptId] && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          Live
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">
                      {row.promptText}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleGenerate(row.conceptId)}
                      disabled={Boolean(generatingId)}
                      className="mt-3 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isGeneratingThis ? "Generating..." : "Regenerate live"}
                    </button>
                  </td>

                  <td className="px-4 py-4">
                    {row.svg ? (
                      <div>
                        <SvgPreview svg={row.svg} />
                        <button
                          type="button"
                          onClick={() => setExpandedSvg(row)}
                          className="mt-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800"
                        >
                          Zoom diagram
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
                        No SVG generated yet. Run{" "}
                        <code className="mx-1 font-mono">npm run generate</code>{" "}
                        or click Generate.
                      </div>
                    )}
                  </td>

                  <td className="px-4 py-4">
                    <ul className="space-y-1.5">
                      {row.checks.map((check) => (
                        <li
                          key={check.id}
                          title={check.message}
                          className="flex flex-col gap-0.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-700">
                              {check.label}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                check.passed
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-rose-100 text-rose-800"
                              }`}
                            >
                              {check.passed ? "PASS" : "FAIL"}
                            </span>
                          </div>
                          {!check.passed && (
                            <p className="text-[11px] leading-snug text-rose-700">
                              {check.message}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>

                  <td className="px-4 py-4 text-xs text-slate-700">
                    <dl className="space-y-1.5">
                      <div>
                        <dt className="text-slate-500">Model</dt>
                        <dd className="font-mono font-medium text-slate-900">
                          {row.model}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Tokens (in / out)</dt>
                        <dd className="font-medium">
                          {row.inputTokens.toLocaleString()} /{" "}
                          {row.outputTokens.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Est. Cost</dt>
                        <dd className="font-semibold text-slate-900">
                          ${row.estimatedCostUsd.toFixed(6)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-500">Retries</dt>
                        <dd className="font-medium">
                          {row.retries} validation
                          {row.apiRetries > 0
                            ? `, ${row.apiRetries} API (429/503)`
                            : ""}
                        </dd>
                      </div>
                    </dl>
                  </td>

                  <td className="px-4 py-4">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDecision(row.conceptId, "approved")}
                        className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                          review.decision === "approved"
                            ? "border-emerald-600 bg-emerald-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
                        }`}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => setDecision(row.conceptId, "rejected")}
                        className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                          review.decision === "rejected"
                            ? "border-rose-600 bg-rose-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-rose-400 hover:bg-rose-50"
                        }`}
                      >
                        Reject
                      </button>
                    </div>

                    <textarea
                      value={review.note}
                      onChange={(e) => setNote(row.conceptId, e.target.value)}
                      placeholder="Reviewer notes (saved in browser)..."
                      rows={3}
                      className="mt-2.5 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                    />

                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        Status:{" "}
                        <strong className="text-slate-700">
                          {review.decision
                            ? review.decision.toUpperCase()
                            : "PENDING"}
                        </strong>
                      </span>
                      {hydrated && (review.decision || review.note) && (
                        <span className="text-emerald-700">Saved locally</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expandedSvg && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setExpandedSvg(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {expandedSvg.concept} ({expandedSvg.subject})
                </h2>
                <p className="text-xs text-slate-500">
                  {expandedSvg.promptText}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedSvg(null)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
            <SvgPreview svg={expandedSvg.svg} maxHeight={520} />
          </div>
        </div>
      )}
    </div>
  );
}
