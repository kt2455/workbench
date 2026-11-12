/**
 * The wall socket: the one place in this Worker that talks to a model provider.
 *
 * Everything else asks for a model by a name from the settings and gets back
 * plain text and token counts. Nothing outside this file imports a provider's
 * library, calls a provider's address or knows which company is behind it.
 * Moving to OpenRouter or Cloudflare AI Gateway means rewriting this file and
 * changing one secret, and nothing else.
 *
 * Version 1 uses the Anthropic API.
 */

import Anthropic from "@anthropic-ai/sdk";

export interface ModelRequest {
  /** The model's name, read from the settings by the caller. */
  model: string;
  /** The standing instructions. */
  system: string;
  /** The material to work on. */
  user: string;
  /** A hard ceiling on the size of the reply, which is also a ceiling on cost. */
  maxOutputTokens: number;
  /** When given, the reply must be JSON of this shape. */
  jsonSchema?: Record<string, unknown>;
}

export type ModelResult =
  | { ok: true; text: string; inputTokens: number; outputTokens: number }
  /** `refused`: the provider declined the request. `truncated`: the reply hit the
   * ceiling. `unavailable`: anything else, such as an outage or a timeout. */
  | { ok: false; reason: "unavailable" | "refused" | "truncated" };

export type ModelCaller = (request: ModelRequest) => Promise<ModelResult>;

/** A visitor is waiting, so give up after this long and fall back. */
const TIMEOUT_MS = 25_000;

export async function callModel(apiKey: string, request: ModelRequest): Promise<ModelResult> {
  try {
    const client = new Anthropic({
      apiKey,
      timeout: TIMEOUT_MS,
      // No automatic second attempt: a retry is a second charge, and the caller
      // has a cheaper fallback.
      maxRetries: 0,
      // The library must never write to the log. A provider's error can repeat
      // the request back, and the request contains the visitor's draft.
      logLevel: "off",
    });

    const response = await client.messages.create({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.system,
      messages: [{ role: "user", content: request.user }],
      output_config: {
        effort: "medium",
        ...(request.jsonSchema ? { format: { type: "json_schema", schema: request.jsonSchema } } : {}),
      },
    });

    if (response.stop_reason === "refusal") return { ok: false, reason: "refused" };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "truncated" };

    let text = "";
    for (const block of response.content) {
      if (block.type === "text") text += block.text;
    }
    return {
      ok: true,
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  } catch {
    // The error is discarded on purpose. See the privacy rules in CLAUDE.md.
    return { ok: false, reason: "unavailable" };
  }
}
