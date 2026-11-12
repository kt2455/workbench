/**
 * Checks what the model sent back and combines it with the rules' findings.
 *
 * The prompt asks the model to behave. This file checks that it did. Nothing
 * the model writes reaches a visitor without passing through here.
 */

import { overlaps } from "./rules";
import {
  MAX_EXPLANATION_CHARS,
  MAX_FINDINGS,
  TELL_TYPES,
  VERDICTS,
  type Finding,
  type TellType,
  type Verdict,
} from "./tells";

interface ModelFinding {
  quote: string;
  type: TellType;
  why: string;
  fix: string;
}

export interface ModelOutput {
  verdict: Verdict;
  summary: string;
  findings: ModelFinding[];
}

/** The shape the model is asked for, in the form the provider understands. */
export const MODEL_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: [...VERDICTS] },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          type: { type: "string", enum: [...TELL_TYPES] },
          why: { type: "string" },
          fix: { type: "string" },
        },
        required: ["quote", "type", "why", "fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "summary", "findings"],
  additionalProperties: false,
};

/** The longest summary shown, in characters. */
const MAX_SUMMARY_CHARS = 400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Cuts text at a word boundary so it fits, and marks the cut. */
function fit(text: string, limit: number): string {
  const clean = text.trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Reads the model's reply. Returns null when it is not the expected shape, in
 * which case the check falls back to the rules alone.
 *
 * A single malformed finding is dropped without failing the rest. A kind of
 * tell that is not on the list becomes "other".
 */
export function parseModelOutput(raw: string): ModelOutput | null {
  let value: unknown;
  try {
    // Some models wrap JSON in a code fence even when asked not to.
    value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const { verdict, summary, findings } = value;
  if (typeof verdict !== "string" || !(VERDICTS as readonly string[]).includes(verdict)) return null;
  if (typeof summary !== "string" || !Array.isArray(findings)) return null;

  const kept: ModelFinding[] = [];
  for (const item of findings) {
    if (!isRecord(item)) continue;
    const { quote, type, why, fix } = item;
    if (typeof quote !== "string" || typeof why !== "string" || typeof fix !== "string") continue;
    if (quote.trim() === "" || why.trim() === "" || fix.trim() === "") continue;
    kept.push({
      quote,
      type: (TELL_TYPES as readonly string[]).includes(type as string) ? (type as TellType) : "other",
      why: fit(why, MAX_EXPLANATION_CHARS),
      fix: fit(fix, MAX_EXPLANATION_CHARS),
    });
  }
  return { verdict: verdict as Verdict, summary: fit(summary, MAX_SUMMARY_CHARS), findings: kept };
}

/**
 * Finds where each of the model's quotes sits in the draft. A quote that is
 * not in the draft, word for word, is dropped: a finding the visitor cannot
 * locate is worse than none. So is one that overlaps a finding already kept.
 */
export function locate(text: string, findings: ModelFinding[]): Finding[] {
  const located: Finding[] = [];
  for (const finding of findings) {
    let from = 0;
    while (from <= text.length) {
      const start = text.indexOf(finding.quote, from);
      if (start === -1) break;
      const span = { start, end: start + finding.quote.length };
      if (!located.some((kept) => overlaps(kept, span))) {
        located.push({ ...finding, ...span, foundBy: "model" });
        break;
      }
      from = start + 1;
    }
  }
  return located;
}

/**
 * Combines the two layers into the final list and verdict.
 *
 * Where both flag the same passage it is shown once, with the model's
 * explanation, marked as found by both. The list is put in draft order and
 * cut to five. If the model said "clean" but anything was found, the verdict
 * becomes "a few tells": "clean" must mean nothing was found.
 */
export function merge(
  model: { verdict: Verdict; findings: Finding[] },
  ruleFindings: Finding[],
): { verdict: Verdict; findings: Finding[] } {
  const combined: Finding[] = model.findings.map((finding) => ({
    ...finding,
    foundBy: ruleFindings.some((rule) => overlaps(rule, finding)) ? "both" : "model",
  }));
  for (const rule of ruleFindings) {
    if (!model.findings.some((finding) => overlaps(finding, rule))) combined.push(rule);
  }
  const findings = combined.sort((a, b) => a.start - b.start).slice(0, MAX_FINDINGS);
  const verdict = model.verdict === "clean" && findings.length > 0 ? "a_few_tells" : model.verdict;
  return { verdict, findings };
}
