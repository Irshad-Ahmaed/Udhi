export type CheckId =
  | "valid_svg"
  | "within_viewbox"
  | "title_and_labels"
  | "has_animation"
  | "safe_and_substantial";

export interface Concept {
  id: string;
  number: number;
  name: string;
  subject: string;
  promptText: string;
}

export interface CheckResult {
  id: CheckId;
  label: string;
  passed: boolean;
  message: string;
}

export interface DiagramResult {
  conceptId: string;
  concept: string;
  subject: string;
  promptText: string;
  model: string;
  svg: string;
  checks: CheckResult[];
  passedAll: boolean;
  inputTokens: number;
  outputTokens: number;
  thoughtsTokenCount: number;
  estimatedCostUsd: number;
  retries: number;
  apiRetries: number;
  generatedAt: string;
}

export interface ResultsFile {
  generatedAt: string;
  model: string;
  results: DiagramResult[];
}
