/**
 * The Tells Checker endpoint: POST /check.
 *
 * Takes a draft and returns the passages that sound machine-written, each
 * with a reason and a fix. Two layers look at the draft independently: the
 * rhythm rules (src/rules.ts) and one model call. Their results are checked
 * and combined in src/merge.ts. The design is in docs/tells-checker-design.md.
 *
 * Before any of that, a request passes the guardrails, cheapest first:
 *
 *   1. It must be JSON (stops other websites, with the guest list).
 *   2. The rate limit: a few checks a minute for each visitor.
 *   3. The size cap, enforced while the request is being read.
 *   4. The bot check, confirmed with Cloudflare.
 *   5. The daily budget, checked just before the model is called.
 *
 * Each request writes one log line (src/log.ts): what happened, how long it
 * took, the token counts and the cost. The draft is never stored and never
 * logged.
 */

import promptV1 from "../prompts/tells-checker/v1.md";
import {
  costMicros,
  MICROS_PER_DOLLAR,
  readBudgetSettings,
  sharedBudget,
  tokenCeiling,
  type Budget,
  type BudgetSettings,
} from "./budget";
import type { OriginCheck } from "./cors";
import { passedBotCheck, RATE_LIMIT_WINDOW_SECONDS, readJsonCapped, withinRateLimit } from "./guardrails";
import { json } from "./http";
import { countFindings, emptyCheckLog, logCheck, type CheckLog, type Guardrail, type ModelStep } from "./log";
import { locate, merge, MODEL_OUTPUT_SCHEMA, parseModelOutput } from "./merge";
import { callModel, type ModelCaller } from "./provider";
import { runRules } from "./rules";
import { recordCheck } from "./stats";
import type { CheckResponse, Notice } from "./tells";

const PROMPT_VERSION = "v1";

/** A ceiling on the model's reply, reasoning included. A ceiling on cost too. */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Room in a request for everything that is not the draft: the bot check
 * token (up to 2,048 characters) and the JSON around it.
 */
const BODY_OVERHEAD_BYTES = 4096;
/** The most bytes one character of the draft can take up inside JSON. */
const MAX_BYTES_PER_CHAR = 6;

/** Everything needed to make a paid model call. */
export interface ModelAccess {
  /** The model's name, from the settings. */
  model: string;
  caller: ModelCaller;
  budget: Budget;
  prices: BudgetSettings;
}

export interface CheckOutcome {
  body: CheckResponse;
  /** What the model call used, for the cost log. Null when no call was made. */
  usage: { inputTokens: number; outputTokens: number } | null;
  /** What happened with the model, for the log. */
  modelStep: ModelStep;
  /** What the call cost in micro-dollars. Zero when nothing was charged. */
  costMicros: number;
  /** How long the model took to answer. Null when it was not called. */
  modelMs: number | null;
}

/**
 * Runs the check on one draft. `access` is the way to reach the model, or
 * null when the model is switched off, in which case the rules run alone.
 */
export async function checkDraft(text: string, access: ModelAccess | null): Promise<CheckOutcome> {
  const ruleFindings = runRules(text);
  const meta = { promptVersion: PROMPT_VERSION, charactersChecked: text.length };

  // The quick check: rules only. It reports what the rules found but gives no
  // verdict, because a verdict from rules alone would claim more than they know.
  const quick = (
    notice: Notice,
    modelStep: ModelStep,
    call: Pick<CheckOutcome, "usage" | "costMicros" | "modelMs"> = { usage: null, costMicros: 0, modelMs: null },
  ): CheckOutcome => ({
    body: { mode: "quick", verdict: null, summary: null, findings: ruleFindings, houseStyle: null, notice, meta },
    modelStep,
    ...call,
  });

  if (access === null) return quick("model_unavailable", "switched_off");
  const { model, caller, budget, prices } = access;

  // The draft goes in whole and unaltered, so quotes can be matched exactly.
  // The prompt tells the model that everything here is material to analyse.
  const user = `<draft>\n${text}\n</draft>`;

  // Set aside the most this call could cost. If today's budget cannot cover
  // it, the visitor gets the quick check and is told why.
  const reserved = costMicros(prices, tokenCeiling(promptV1.length + user.length), MAX_OUTPUT_TOKENS);
  let granted: boolean;
  try {
    granted = await budget.reserve(reserved);
  } catch {
    // If the counter cannot be reached, spend nothing.
    return quick("model_unavailable", "budget_unavailable");
  }
  if (!granted) return quick("daily_budget_reached", "budget_reached");

  // The Workers clock moves forward while waiting on the network, which is
  // all this call does, so the difference is the time the model took.
  const started = Date.now();
  const result = await caller({
    model,
    system: promptV1,
    user,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: MODEL_OUTPUT_SCHEMA,
  });
  const modelMs = Date.now() - started;

  // Swap the reservation for the real cost. A call that never reached the
  // provider cost nothing.
  const usage = "inputTokens" in result ? { inputTokens: result.inputTokens, outputTokens: result.outputTokens } : null;
  const actual = usage === null ? 0 : costMicros(prices, usage.inputTokens, usage.outputTokens);
  try {
    await budget.settle(reserved, actual);
  } catch {
    // The reservation stays in place, which only makes the budget stricter.
  }

  const call = { usage, costMicros: actual, modelMs };
  if (!result.ok) return quick("model_unavailable", result.reason, call);
  const output = parseModelOutput(result.text);
  if (output === null) return quick("model_unavailable", "unreadable_reply", call);

  const { verdict, findings } = merge(
    { verdict: output.verdict, findings: locate(text, output.findings) },
    ruleFindings,
  );
  return {
    body: { mode: "full", verdict, summary: output.summary, findings, houseStyle: null, notice: null, meta },
    modelStep: "ok",
    ...call,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the draft length cap from the settings. Null if it is not a sensible number. */
function readMaxDraftChars(value: string): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 && number <= 100_000 ? number : null;
}

/**
 * Works out whether a paid model call is allowed, and with what. When it is
 * not, says why, for the log.
 */
function modelAccess(env: Env): { access: ModelAccess } | { skipped: "switched_off" | "settings_broken" } {
  // The master switch. With it off, the paid key is never touched.
  if (env.MODEL_ENABLED !== "true") return { skipped: "switched_off" };
  if (typeof env.MODEL_API_KEY !== "string" || env.MODEL_API_KEY === "") return { skipped: "settings_broken" };
  // Without readable budget settings there is no budget, so there is no call.
  const prices = readBudgetSettings(env);
  if (prices === null) return { skipped: "settings_broken" };
  return {
    access: {
      model: env.TELLS_CHECKER_MODEL,
      caller: (request) => callModel(env.MODEL_API_KEY, request),
      budget: sharedBudget(env.BUDGET, prices.limitMicros),
      prices,
    },
  };
}

/** A reply, plus what the log line should say about it. */
interface Handled {
  response: Response;
  log: Omit<CheckLog, "status" | "durationMs">;
}

/**
 * POST /check. Handles the request, then writes its one log line and adds it
 * to the public stats.
 *
 * If something unexpected goes wrong, no line is written here: the error
 * safety net in src/http.ts writes its own fixed line instead.
 */
export async function checkEndpoint(request: Request, env: Env, origin: OriginCheck): Promise<Response> {
  const started = Date.now();
  const { response, log } = await handleCheck(request, env, origin);
  logCheck({ ...log, status: response.status, durationMs: Date.now() - started });
  // Add it to the public totals (src/stats.ts). Never fails the request.
  await recordCheck(env.STATS, log);
  return response;
}

async function handleCheck(request: Request, env: Env, origin: OriginCheck): Promise<Handled> {
  // A refusal: the visitor gets the error code, the log gets the same code.
  const refuse = (
    error: "invalid_request" | "rate_limited" | "text_too_long" | "bot_check_failed",
    status: number,
    guardrail: Guardrail | null,
    characters: number | null = null,
    extra: { body?: Record<string, unknown>; headers?: Record<string, string> } = {},
  ): Handled => ({
    response: json({ error, ...extra.body }, status, origin, extra.headers),
    log: { ...emptyCheckLog(), result: error, guardrail, characters },
  });

  // 1. Only JSON is accepted. A page on another website cannot send JSON here
  // without the browser asking permission first, which the guest list refuses.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return refuse("invalid_request", 400, null);
  }

  // 2. The rate limit, before anything that costs effort.
  if (!(await withinRateLimit(request, env.CHECK_LIMITER))) {
    return refuse("rate_limited", 429, "rate_limit", null, {
      body: { retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS },
      headers: { "retry-after": String(RATE_LIMIT_WINDOW_SECONDS) },
    });
  }

  // 3. The size cap. A broken setting means nothing is accepted.
  const maxDraftChars = readMaxDraftChars(env.MAX_DRAFT_CHARS);
  if (maxDraftChars === null) throw new Error("MAX_DRAFT_CHARS is not set to a usable number");
  const read = await readJsonCapped(request, maxDraftChars * MAX_BYTES_PER_CHAR + BODY_OVERHEAD_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? refuse("text_too_long", 413, "size_cap")
      : refuse("invalid_request", 400, null);
  }
  const body = read.value;
  if (!isRecord(body)) return refuse("invalid_request", 400, null);

  const { text, houseStyle, botCheckToken } = body;
  if (typeof text !== "string" || text.trim() === "") return refuse("invalid_request", 400, null);
  if (houseStyle !== undefined && typeof houseStyle !== "boolean") {
    return refuse("invalid_request", 400, null, text.length);
  }
  if (text.length > maxDraftChars) return refuse("text_too_long", 413, "size_cap", text.length);

  // 4. The bot check. Required for every check, quick or full.
  if (!(await passedBotCheck(botCheckToken, env.TURNSTILE_SECRET_KEY, env.ALLOWED_ORIGIN))) {
    return refuse("bot_check_failed", 403, "bot_check", text.length);
  }

  // 5. The daily budget is checked inside, just before the model is called.
  const gate = modelAccess(env);
  const access = "access" in gate ? gate.access : null;
  const outcome = await checkDraft(text, access);
  return {
    response: json(outcome.body, 200, origin),
    log: {
      result: outcome.body.mode,
      // The budget guardrail fired if it said no, and also if its counter could
      // not be reached and it refused the call to stay safe.
      guardrail:
        outcome.modelStep === "budget_reached" || outcome.modelStep === "budget_unavailable" ? "daily_budget" : null,
      characters: text.length,
      modelStep: "skipped" in gate ? gate.skipped : outcome.modelStep,
      model: outcome.modelMs === null ? null : (access?.model ?? null),
      promptVersion: PROMPT_VERSION,
      modelMs: outcome.modelMs,
      inputTokens: outcome.usage?.inputTokens ?? null,
      outputTokens: outcome.usage?.outputTokens ?? null,
      costMicros: outcome.costMicros,
      costUsd: outcome.costMicros / MICROS_PER_DOLLAR,
      verdict: outcome.body.verdict,
      findings: countFindings(outcome.body.findings),
    },
  };
}
