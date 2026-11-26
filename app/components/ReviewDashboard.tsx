"use client";

import { useEffect, useMemo, useState } from "react";
import { SvgPreview } from "@/app/components/SvgPreview";
import { CONCEPTS } from "@/data/concepts";
import type { DiagramResult } from "@/lib/types";

type Decision = "approved" | "rejected" | null;
type FilterTab = "all" | "approved" | "rejected" | "pending";

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

  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [selectedConceptId, setSelectedConceptId] = useState<string>(
    CONCEPTS[0].id,
  );
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [expandedSvg, setExpandedSvg] = useState<DiagramResult | null>(null);
  const [modalTab, setModalTab] = useState<"preview" | "source">("preview");
  const [copiedSvg, setCopiedSvg] = useState(false);

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

  useEffect(() => {
    if (!expandedSvg) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpandedSvg(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedSvg]);

  const persistReviews = (updater: (prev: ReviewState) => ReviewState) => {
    setReviews((prev) => {
      const next = updater(prev);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota errors
      }
      return next;
    });
  };

  const setDecision = (conceptId: string, decision: Decision) => {
    persistReviews((prev) => {
      const existing = prev[conceptId] ?? { decision: null, note: "" };
      const nextDecision = existing.decision === decision ? null : decision;
      return {
        ...prev,
        [conceptId]: {
          ...existing,
          decision: nextDecision,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  };

  const setNote = (conceptId: string, note: string) => {
    persistReviews((prev) => {
      const existing = prev[conceptId] ?? { decision: null, note: "" };
      return {
        ...prev,
        [conceptId]: {
          ...existing,
          note,
          updatedAt: new Date().toISOString(),
        },
      };
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

  const openModal = (row: DiagramResult, tab: "preview" | "source" = "preview") => {
    setCopiedSvg(false);
    setModalTab(tab);
    setExpandedSvg(row);
  };

  const copySvgSource = async (svg: string) => {
    try {
      await navigator.clipboard.writeText(svg);
      setCopiedSvg(true);
      setTimeout(() => setCopiedSvg(false), 1800);
    } catch {
      // Clipboard unavailable
    }
  };

  const stats = useMemo(() => {
    const passedCount = results.filter((r) => r.passedAll).length;
    const totalCost = results.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    const totalValRetries = results.reduce((sum, r) => sum + r.retries, 0);
    const totalApiRetries = results.reduce((sum, r) => sum + r.apiRetries, 0);
    const approvedCount = results.filter(
      (r) => reviews[r.conceptId]?.decision === "approved",
    ).length;
    const rejectedCount = results.filter(
      (r) => reviews[r.conceptId]?.decision === "rejected",
    ).length;
    const pendingCount = results.length - approvedCount - rejectedCount;

    return {
      passedCount,
      totalCost,
      totalValRetries,
      totalApiRetries,
      approvedCount,
      rejectedCount,
      pendingCount,
    };
  }, [results, reviews]);

  const filteredResults = useMemo(() => {
    if (filterTab === "all") return results;
    return results.filter((r) => {
      const dec = reviews[r.conceptId]?.decision ?? null;
      if (filterTab === "approved") return dec === "approved";
      if (filterTab === "rejected") return dec === "rejected";
      return dec === null;
    });
  }, [results, reviews, filterTab]);

  const hasLiveOverrides = Object.values(liveIds).some(Boolean);
  const primaryModel = results[0]?.model ?? "gemini-3.5-flash-lite";

  return (
    <div className="min-h-screen bg-[#fafafa] text-zinc-950">
      {/* Top Vercel-style Sub-nav */}
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="font-medium text-zinc-900">Udhi Technologies</span>
              <span>/</span>
              <span>GCSE Visual QA</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {primaryModel}
              </span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">
              Science Diagram Maker
            </h1>
            <p className="text-sm text-zinc-500">
              5 animated GCSE diagrams validated in code with automated retry and
              persistent reviewer sign-off.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="text-[11px] font-medium text-zinc-500">
                Checks Passed
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 font-mono text-base font-semibold tabular-nums text-zinc-950">
                <span
                  className={`h-2 w-2 rounded-full ${
                    stats.passedCount === results.length
                      ? "bg-emerald-500"
                      : "bg-amber-500"
                  }`}
                />
                {stats.passedCount}/{results.length}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="text-[11px] font-medium text-zinc-500">
                Approved
              </div>
              <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-emerald-700">
                {hydrated ? stats.approvedCount : "—"}/{results.length}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="text-[11px] font-medium text-zinc-500">
                Est. Cost
              </div>
              <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-zinc-950">
                ${stats.totalCost.toFixed(5)}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 px-3.5 py-2.5">
              <div className="text-[11px] font-medium text-zinc-500">
                Retries
              </div>
              <div className="mt-0.5 font-mono text-base font-semibold tabular-nums text-zinc-950">
                {stats.totalValRetries}
                {stats.totalApiRetries > 0 ? (
                  <span className="ml-1 text-xs font-normal text-zinc-500">
                    (+{stats.totalApiRetries} API)
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Toolbar: Filter Tabs + Live Generate Controls */}
        <section
          aria-label="Filter and live generation toolbar"
          className="mb-5 flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 lg:flex-row lg:items-center lg:justify-between"
        >
          <div
            role="tablist"
            aria-label="Filter review rows"
            className="flex flex-wrap items-center gap-1 rounded-lg bg-zinc-100 p-1"
          >
            {(
              [
                { id: "all", label: `All (${results.length})` },
                {
                  id: "approved",
                  label: `Approved (${hydrated ? stats.approvedCount : "—"})`,
                },
                {
                  id: "rejected",
                  label: `Rejected (${hydrated ? stats.rejectedCount : "—"})`,
                },
                {
                  id: "pending",
                  label: `Pending (${hydrated ? stats.pendingCount : "—"})`,
                },
              ] as const
            ).map((tab) => {
              const active = filterTab === tab.id;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={active}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? "bg-white text-zinc-950 shadow-xs"
                      : "text-zinc-600 hover:text-zinc-950"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!resultsLoadedFromFile && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                results.json not generated yet
              </span>
            )}

            <label htmlFor="concept-select" className="sr-only">
              Concept to generate live
            </label>
            <select
              id="concept-select"
              value={selectedConceptId}
              onChange={(e) => setSelectedConceptId(e.target.value)}
              disabled={Boolean(generatingId)}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 transition hover:border-zinc-300 focus:border-zinc-900 focus:outline-none disabled:opacity-50"
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
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-950 px-4 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {generatingId ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-white" />
                  Generating...
                </>
              ) : (
                "Generate"
              )}
            </button>

            {hasLiveOverrides && (
              <button
                type="button"
                onClick={resetToSaved}
                className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Reset to saved
              </button>
            )}
          </div>
        </section>

        {errorBanner && (
          <div
            role="alert"
            className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900"
          >
            <div className="leading-relaxed">
              <span className="font-semibold">Live generation error: </span>
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="shrink-0 rounded-md border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Main 5-Row Review Table */}
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full min-w-[1020px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/95 backdrop-blur-xs">
              <tr className="text-[11px] font-medium tracking-wider text-zinc-500 uppercase">
                <th className="w-60 px-4 py-3">Concept</th>
                <th className="w-80 px-4 py-3">Diagram (Animated)</th>
                <th className="w-64 px-4 py-3">Code Checks (5)</th>
                <th className="w-44 px-4 py-3">Cost &amp; Retries</th>
                <th className="w-64 px-4 py-3">Review &amp; Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200">
              {filteredResults.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-12 text-center text-sm text-zinc-500"
                  >
                    No diagrams match the selected filter.{" "}
                    <button
                      type="button"
                      onClick={() => setFilterTab("all")}
                      className="font-medium text-zinc-900 underline underline-offset-2"
                    >
                      Show all 5
                    </button>
                  </td>
                </tr>
              ) : (
                filteredResults.map((row) => {
                  const review = reviews[row.conceptId] ?? {
                    decision: null,
                    note: "",
                  };
                  const isGeneratingThis = generatingId === row.conceptId;

                  return (
                    <tr
                      key={row.conceptId}
                      className="align-top transition-colors hover:bg-zinc-50/60"
                    >
                      {/* Column 1: Concept */}
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-zinc-950">
                            {row.concept}
                          </span>
                          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                            {row.subject}
                          </span>
                          {liveIds[row.conceptId] && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                              Live
                            </span>
                          )}
                        </div>

                        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                          {row.promptText}
                        </p>

                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleGenerate(row.conceptId)}
                            disabled={Boolean(generatingId)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isGeneratingThis ? "Generating..." : "Regenerate"}
                          </button>
                        </div>
                      </td>

                      {/* Column 2: Animated SVG */}
                      <td className="px-4 py-4">
                        {row.svg ? (
                          <div>
                            <SvgPreview svg={row.svg} maxHeight={260} />
                            <div className="mt-2 flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => openModal(row, "preview")}
                                className="text-xs font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 hover:decoration-zinc-950"
                              >
                                Zoom diagram
                              </button>
                              <button
                                type="button"
                                onClick={() => openModal(row, "source")}
                                className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
                              >
                                View SVG
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-xs text-zinc-500">
                            No SVG generated yet. Run{" "}
                            <code className="mx-1 font-mono">
                              npm run generate
                            </code>{" "}
                            or click Generate.
                          </div>
                        )}
                      </td>

                      {/* Column 3: Code Checks */}
                      <td className="px-4 py-4">
                        <ul className="space-y-2">
                          {row.checks.map((check) => (
                            <li
                              key={check.id}
                              title={check.message}
                              className="flex flex-col gap-0.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                                  <span
                                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                      check.passed
                                        ? "bg-emerald-500"
                                        : "bg-rose-500"
                                    }`}
                                  />
                                  {check.label}
                                </span>
                                <span
                                  className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                                    check.passed
                                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 ring-inset"
                                      : "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80 ring-inset"
                                  }`}
                                >
                                  {check.passed ? "PASS" : "FAIL"}
                                </span>
                              </div>
                              {!check.passed && (
                                <p className="pl-3 text-[11px] leading-snug text-rose-600">
                                  {check.message}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </td>

                      {/* Column 4: Cost & Retries */}
                      <td className="px-4 py-4 text-xs">
                        <dl className="space-y-2">
                          <div>
                            <dt className="text-[11px] text-zinc-500">Model</dt>
                            <dd className="font-mono text-[11px] font-medium text-zinc-900">
                              {row.model}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] text-zinc-500">
                              Tokens (in / out)
                            </dt>
                            <dd className="font-mono font-medium tabular-nums text-zinc-900">
                              {row.inputTokens.toLocaleString()} /{" "}
                              {row.outputTokens.toLocaleString()}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] text-zinc-500">
                              Est. Cost
                            </dt>
                            <dd className="font-mono font-semibold tabular-nums text-zinc-950">
                              ${row.estimatedCostUsd.toFixed(6)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-[11px] text-zinc-500">
                              Retries
                            </dt>
                            <dd className="font-mono text-[11px] font-medium tabular-nums text-zinc-800">
                              {row.retries} validation
                              {row.apiRetries > 0
                                ? `, ${row.apiRetries} API (429/503)`
                                : ""}
                            </dd>
                          </div>
                        </dl>
                      </td>

                      {/* Column 5: Approve / Reject & Notes */}
                      <td className="px-4 py-4">
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDecision(row.conceptId, "approved")}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                              review.decision === "approved"
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50/60 hover:text-emerald-800"
                            }`}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => setDecision(row.conceptId, "rejected")}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                              review.decision === "rejected"
                                ? "border-rose-600 bg-rose-600 text-white"
                                : "border-zinc-200 bg-white text-zinc-700 hover:border-rose-300 hover:bg-rose-50/60 hover:text-rose-800"
                            }`}
                          >
                            Reject
                          </button>
                        </div>

                        <textarea
                          value={review.note}
                          onChange={(e) => setNote(row.conceptId, e.target.value)}
                          placeholder="Add reviewer note..."
                          rows={3}
                          className="mt-2.5 w-full rounded-lg border border-zinc-200 bg-zinc-50/50 px-2.5 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none"
                        />

                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-zinc-500">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                review.decision === "approved"
                                  ? "bg-emerald-500"
                                  : review.decision === "rejected"
                                    ? "bg-rose-500"
                                    : "bg-zinc-300"
                              }`}
                            />
                            <span className="font-mono font-medium text-zinc-700">
                              {review.decision
                                ? review.decision.toUpperCase()
                                : "PENDING"}
                            </span>
                          </span>
                          {hydrated && (review.decision || review.note) && (
                            <span className="text-emerald-700">
                              Saved locally
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect / Zoom Modal with Preview + SVG Source tabs */}
      {expandedSvg && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Inspect ${expandedSvg.concept}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4 backdrop-blur-xs"
          onClick={() => setExpandedSvg(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-950">
                    {expandedSvg.concept}
                  </h2>
                  <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
                    {expandedSvg.subject}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {expandedSvg.promptText}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedSvg(null)}
                className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Esc
              </button>
            </div>

            <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-2">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setModalTab("preview")}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    modalTab === "preview"
                      ? "bg-white text-zinc-950 shadow-xs"
                      : "text-zinc-600 hover:text-zinc-950"
                  }`}
                >
                  Animated Preview
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("source")}
                  className={`rounded-md px-3 py-1 text-xs font-medium ${
                    modalTab === "source"
                      ? "bg-white text-zinc-950 shadow-xs"
                      : "text-zinc-600 hover:text-zinc-950"
                  }`}
                >
                  SVG Source
                </button>
              </div>

              {modalTab === "source" && (
                <button
                  type="button"
                  onClick={() => copySvgSource(expandedSvg.svg)}
                  className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                >
                  {copiedSvg ? "Copied!" : "Copy SVG"}
                </button>
              )}
            </div>

            <div className="p-5">
              {modalTab === "preview" ? (
                <SvgPreview svg={expandedSvg.svg} maxHeight={480} />
              ) : (
                <pre className="max-h-[460px] overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
                  <code>{expandedSvg.svg}</code>
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
