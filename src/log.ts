/**
 * The Worker's log: what it writes down on purpose.
 *
 * The privacy rule is that a log line holds metadata only: when, how long,
 * how many tokens, what it cost, and which guardrail fired. Never the text a
 * visitor pasted, never a quote from it, and never an IP address, location,
 * browser or full web address.
 *
 * That rule is enforced here in two ways:
 *
 *   1. Every field has a fixed type. Apart from two names taken from the
 *      settings (the model and the prompt version), each one is a number or a
 *      word from a short fixed list. There is no field that could hold free
 *      text, so there is nowhere to put a draft by mistake.
 *   2. `logCheck` copies the allowed fields one by one into a new object. If
 *      anything else is handed to it, it is left behind.
 *
 * Each line is one JSON object, so Cloudflare's log viewer can filter and
 * count by field.
 */

import { TELL_TYPES, VERDICTS, type Finding, type TellType, type Verdict } from "./tells";

/** The guardrails that can turn a request away or limit what it gets. */
export type Guardrail = "origin" | "rate_limit" | "size_cap" | "bot_check" | "daily_budget";

/** How a check ended: the kind of reply, or the error code the visitor got. */
export type CheckResult =
  | "full"
  | "quick"
  | "invalid_request"
  | "rate_limited"
  | "text_too_long"
  | "bot_check_failed";

/**
 * What happened with the model on one check.
 *
 * Skipped before any call: `switched_off` (MODEL_ENABLED is not "true"),
 * `settings_broken` (the key, a price or the budget setting is missing or
 * unreadable), `budget_reached`, `budget_unavailable` (the counter could not
 * be reached).
 *
 * Called: `ok`, `refused`, `truncated`, `unavailable` (an outage or a
 * timeout), `unreadable_reply` (the reply was not in the agreed format).
 */
export type ModelStep =
  | "switched_off"
  | "settings_broken"
  | "budget_reached"
  | "budget_unavailable"
  | "ok"
  | "refused"
  | "truncated"
  | "unavailable"
  | "unreadable_reply";

/** One line per request to /check. */
export interface CheckLog {
  result: CheckResult;
  /** The HTTP status code sent back. */
  status: number;
  /** The guardrail that fired, or null if none did. */
  guardrail: Guardrail | null;
  /** How long the whole request took, in milliseconds. */
  durationMs: number;
  /** The draft's length in characters. Null if the request was refused before it was read. */
  characters: number | null;
  /** Null if the request never got as far as the model step. */
  modelStep: ModelStep | null;
  /** The model's name from the settings, when it was called. */
  model: string | null;
  promptVersion: string | null;
  /** How long the model took to answer, in milliseconds. */
  modelMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** What the call cost, in US dollars. Zero when no call was charged. */
  costUsd: number | null;
  /** The verdict sent back. Null for a quick check or a refusal. */
  verdict: Verdict | null;
  /** How many findings were sent back, by kind and by layer. Never the quotes. */
  findings: FindingCounts | null;
}

export interface FindingCounts {
  total: number;
  byType: Partial<Record<TellType, number>>;
  byLayer: { rule: number; model: number; both: number };
}

/** Counts findings. Only the kind and the layer are read, never the text. */
export function countFindings(findings: readonly Finding[]): FindingCounts {
  const counts: FindingCounts = { total: 0, byType: {}, byLayer: { rule: 0, model: 0, both: 0 } };
  for (const finding of findings) {
    counts.total += 1;
    counts.byType[finding.type] = (counts.byType[finding.type] ?? 0) + 1;
    counts.byLayer[finding.foundBy] += 1;
  }
  return counts;
}

/** Copies finding counts field by field, keeping only known kinds and numbers. */
function cleanCounts(counts: FindingCounts | null): FindingCounts | null {
  if (counts === null || typeof counts !== "object") return null;
  const byType: Partial<Record<TellType, number>> = {};
  for (const type of TELL_TYPES) {
    const value = count(counts.byType?.[type] ?? null);
    if (value !== null) byType[type] = value;
  }
  return {
    total: count(counts.total) ?? 0,
    byType,
    byLayer: {
      rule: count(counts.byLayer?.rule ?? null) ?? 0,
      model: count(counts.byLayer?.model ?? null) ?? 0,
      both: count(counts.byLayer?.both ?? null) ?? 0,
    },
  };
}

/** Fills in the fields a request did not reach, so every line has the same shape. */
export function emptyCheckLog(): Omit<CheckLog, "result" | "status" | "guardrail" | "durationMs"> {
  return {
    characters: null,
    modelStep: null,
    model: null,
    promptVersion: null,
    modelMs: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    verdict: null,
    findings: null,
  };
}

/** A number for the log, or null if it is not a usable one. */
function count(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Writes the one log line for a check. */
export function logCheck(entry: CheckLog): void {
  write({
    event: "check",
    at: new Date().toISOString(),
    result: entry.result,
    status: count(entry.status),
    guardrail: entry.guardrail,
    durationMs: count(entry.durationMs),
    characters: count(entry.characters),
    modelStep: entry.modelStep,
    model: entry.model,
    promptVersion: entry.promptVersion,
    modelMs: count(entry.modelMs),
    inputTokens: count(entry.inputTokens),
    outputTokens: count(entry.outputTokens),
    costUsd: count(entry.costUsd),
    verdict: VERDICTS.includes(entry.verdict as Verdict) ? entry.verdict : null,
    findings: cleanCounts(entry.findings),
  });
}

/**
 * Writes a line for a request turned away before it reached an endpoint,
 * which today means a page on another website. The address it asked for is
 * not recorded.
 */
export function logRefused(guardrail: Guardrail, status: number): void {
  write({ event: "refused", at: new Date().toISOString(), guardrail, status: count(status) });
}

function write(line: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify(line));
  } catch {
    // A log line is never worth failing a visitor's request over.
  }
}
