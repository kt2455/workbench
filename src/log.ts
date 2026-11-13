/**
 * The Worker's log: what it writes down on purpose.
 *
 * The privacy rule is that a log line holds metadata only: when, how long,
 * how many tokens, what it cost, and which guardrail fired. Never the text a
 * visitor pasted, never a quote from it, and never an IP address, location,
 * browser or full web address.
 *
 * That rule is enforced here, while the code runs, not only when it is
 * written:
 *
 *   1. Every field is a number or a word from a short fixed list. Each word is
 *      checked against its list as the line is built, and anything not on the
 *      list is written as null. The two names taken from the settings (the
 *      model and the prompt version) must look like a name: short, with no
 *      spaces. There is no field that could hold free text.
 *   2. `logCheck` copies the allowed fields one by one into a new object. If
 *      anything else is handed to it, it is left behind.
 *   3. The draft's length is rounded up to the next 100 characters, so a
 *      length cannot be matched to one particular draft.
 *
 * Each line is one JSON object, so Cloudflare's log viewer can filter and
 * count by field.
 */

import { TELL_TYPES, VERDICTS, type Finding, type TellType, type Verdict } from "./tells";

/** The guardrails that can turn a request away or limit what it gets. */
export const GUARDRAILS = ["origin", "rate_limit", "size_cap", "bot_check", "daily_budget"] as const;
export type Guardrail = (typeof GUARDRAILS)[number];

/** How a check ended: the kind of reply, or the error code the visitor got. */
export const CHECK_RESULTS = [
  "full",
  "quick",
  "invalid_request",
  "rate_limited",
  "text_too_long",
  "bot_check_failed",
] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

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
export const MODEL_STEPS = [
  "switched_off",
  "settings_broken",
  "budget_reached",
  "budget_unavailable",
  "ok",
  "refused",
  "truncated",
  "unavailable",
  "unreadable_reply",
] as const;
export type ModelStep = (typeof MODEL_STEPS)[number];

/** One line per request to /check. */
export interface CheckLog {
  result: CheckResult;
  /** The HTTP status code sent back. */
  status: number;
  /** The guardrail that fired, or null if none did. */
  guardrail: Guardrail | null;
  /** How long the whole request took, in milliseconds. */
  durationMs: number;
  /**
   * The draft's length in characters. Logged rounded up to the next 100.
   * Null if the request was refused before the draft was read.
   */
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
  /**
   * What the call cost, in millionths of a dollar. A whole number, so totals
   * add up exactly. Zero when no call was charged.
   */
  costMicros: number | null;
  /** The same cost in US dollars, for reading by eye. */
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
    costMicros: null,
    costUsd: null,
    verdict: null,
    findings: null,
  };
}

/** A number for the log, or null if it is not a usable one. */
function count(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The word, if it is on the list. Otherwise null. */
function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}

/** A name from the settings, if it looks like one: short, letters, digits, dots, dashes. */
function settingName(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : null;
}

/** Rounds a length up to the next 100, so it describes a size, not a draft. */
function roughLength(value: number | null): number | null {
  const exact = count(value);
  return exact === null ? null : Math.ceil(exact / 100) * 100;
}

/** Writes the one log line for a check. Never throws. */
export function logCheck(entry: CheckLog): void {
  try {
    write({
      event: "check",
      at: new Date().toISOString(),
      result: oneOf(CHECK_RESULTS, entry.result),
      status: count(entry.status),
      guardrail: oneOf(GUARDRAILS, entry.guardrail),
      durationMs: count(entry.durationMs),
      characters: roughLength(entry.characters),
      modelStep: oneOf(MODEL_STEPS, entry.modelStep),
      model: settingName(entry.model),
      promptVersion: settingName(entry.promptVersion),
      modelMs: count(entry.modelMs),
      inputTokens: count(entry.inputTokens),
      outputTokens: count(entry.outputTokens),
      costMicros: count(entry.costMicros),
      costUsd: count(entry.costUsd),
      verdict: oneOf(VERDICTS, entry.verdict),
      findings: cleanCounts(entry.findings),
    });
  } catch {
    // A log line is never worth failing a visitor's request over.
  }
}

/**
 * Writes a line for a request turned away before it reached an endpoint,
 * which today means a page on another website. The address it asked for is
 * not recorded.
 */
export function logRefused(guardrail: Guardrail, status: number): void {
  try {
    write({ event: "refused", at: new Date().toISOString(), guardrail: oneOf(GUARDRAILS, guardrail), status: count(status) });
  } catch {
    // As above.
  }
}

/** Things that can fail without affecting a visitor, each logged as a fixed word. */
export const FAILURES = ["stats_write_failed", "stats_read_failed"] as const;
export type Failure = (typeof FAILURES)[number];

/** Writes a fixed line saying something failed. The error itself is never logged. */
export function logFailure(failure: Failure): void {
  try {
    write({ event: "failure", at: new Date().toISOString(), failure: oneOf(FAILURES, failure) });
  } catch {
    // As above.
  }
}

function write(line: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify(line));
  } catch {
    // A log line is never worth failing a visitor's request over.
  }
}
