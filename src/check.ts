/**
 * The Tells Checker endpoint: POST /check.
 *
 * Takes a draft and returns the passages that sound machine-written, each
 * with a reason and a fix. Two layers look at the draft independently: the
 * rhythm rules (src/rules.ts) and one model call. Their results are checked
 * and combined in src/merge.ts. The design is in docs/tells-checker-design.md.
 *
 * The draft is never stored and never logged.
 */

import promptV1 from "../prompts/tells-checker/v1.md";
import type { OriginCheck } from "./cors";
import { json } from "./http";
import { locate, merge, MODEL_OUTPUT_SCHEMA, parseModelOutput } from "./merge";
import { callModel, type ModelCaller } from "./provider";
import { runRules } from "./rules";
import type { CheckResponse, Notice } from "./tells";

const PROMPT_VERSION = "v1";

/**
 * The longest draft accepted, in characters. A placeholder until step 1.10
 * sets the real figure along with the other limits.
 */
export const MAX_DRAFT_CHARS = 10_000;

/** A ceiling on the model's reply, reasoning included. A ceiling on cost too. */
const MAX_OUTPUT_TOKENS = 4096;

export interface CheckOutcome {
  body: CheckResponse;
  /** What the model call used, for the cost log. Null when no call was made. */
  usage: { inputTokens: number; outputTokens: number } | null;
}

/**
 * Runs the check on one draft. `caller` is the way to reach the model, or
 * null when the model is switched off, in which case the rules run alone.
 */
export async function checkDraft(text: string, model: string, caller: ModelCaller | null): Promise<CheckOutcome> {
  const ruleFindings = runRules(text);
  const meta = { promptVersion: PROMPT_VERSION, charactersChecked: text.length };

  // The quick check: rules only. It reports what the rules found but gives no
  // verdict, because a verdict from rules alone would claim more than they know.
  const quick = (notice: Notice, usage: CheckOutcome["usage"]): CheckOutcome => ({
    body: { mode: "quick", verdict: null, summary: null, findings: ruleFindings, houseStyle: null, notice, meta },
    usage,
  });

  if (caller === null) return quick("model_unavailable", null);

  const result = await caller({
    model,
    system: promptV1,
    // The draft goes in whole and unaltered, so quotes can be matched exactly.
    // The prompt tells the model that everything here is material to analyse.
    user: `<draft>\n${text}\n</draft>`,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    jsonSchema: MODEL_OUTPUT_SCHEMA,
  });
  if (!result.ok) return quick("model_unavailable", null);

  const usage = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
  const output = parseModelOutput(result.text);
  if (output === null) return quick("model_unavailable", usage);

  const { verdict, findings } = merge(
    { verdict: output.verdict, findings: locate(text, output.findings) },
    ruleFindings,
  );
  return {
    body: { mode: "full", verdict, summary: output.summary, findings, houseStyle: null, notice: null, meta },
    usage,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function checkEndpoint(request: Request, env: Env, origin: OriginCheck): Promise<Response> {
  // Only JSON is accepted. A page on another website cannot send JSON here
  // without the browser asking permission first, which the guest list refuses.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return json({ error: "invalid_request" }, 400, origin);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, 400, origin);
  }
  if (!isRecord(body)) return json({ error: "invalid_request" }, 400, origin);

  const { text, houseStyle } = body;
  if (typeof text !== "string" || text.trim() === "") return json({ error: "invalid_request" }, 400, origin);
  if (houseStyle !== undefined && typeof houseStyle !== "boolean") {
    return json({ error: "invalid_request" }, 400, origin);
  }
  if (text.length > MAX_DRAFT_CHARS) return json({ error: "text_too_long" }, 413, origin);

  // The model is used only when the switch in the settings says so. With the
  // switch off, the paid key is never touched.
  const caller: ModelCaller | null =
    env.MODEL_ENABLED === "true" ? (modelRequest) => callModel(env.MODEL_API_KEY, modelRequest) : null;

  const outcome = await checkDraft(text, env.TELLS_CHECKER_MODEL, caller);
  return json(outcome.body, 200, origin);
}
