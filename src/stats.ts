/**
 * The public stats: running totals for the Open Kitchen page.
 *
 * Every check adds a few numbers to a counter: was it a full or a quick
 * check, did a guardrail fire, and what the model call used and cost. Never
 * the draft, never who sent it, and never anything about one request alone.
 * GET /stats returns the totals and a few averages.
 *
 * Two rules keep one visitor's request from being picked out of the totals:
 *
 *   1. Only finished days (UTC) are counted. Today's numbers are not shown
 *      until tomorrow, so nobody can watch the totals move as a check is run.
 *   2. The published totals move forward only in batches of at least
 *      STATS_MIN_BATCH checks. Like a ballot box that is only opened once
 *      enough votes are in: comparing the totals before and after any update
 *      shows a group of checks, never a single one.
 *
 * Not counted here: requests turned away by the rate limit or the guest list,
 * and malformed requests. A script can send those as fast as it likes, and
 * each one written to the counter would cost something. They still appear in
 * the log (src/log.ts).
 */

import { DurableObject } from "cloudflare:workers";
import { today } from "./budget";
import type { OriginCheck } from "./cors";
import { RATE_LIMIT_WINDOW_SECONDS, withinRateLimit } from "./guardrails";
import { json } from "./http";
import { logFailure, type CheckLog } from "./log";

/** The numbers kept for each day. Every one is a count or a sum. */
export const STAT_NAMES = [
  "checks_full",
  "checks_quick",
  "quick_model_off",
  "quick_daily_budget",
  "quick_model_unavailable",
  "guardrail_size_cap",
  "guardrail_bot_check",
  "guardrail_daily_budget",
  "model_calls",
  "model_ms",
  "input_tokens",
  "output_tokens",
  "cost_micros",
] as const;
export type StatName = (typeof STAT_NAMES)[number];
export type StatCounts = Partial<Record<StatName, number>>;

/** The published totals, as kept by the counter. */
export interface PublishedTotals {
  /** The first and last day included. Null when nothing is published yet. */
  since: string | null;
  through: string | null;
  totals: Record<StatName, number>;
}

function zeroTotals(): Record<StatName, number> {
  return Object.fromEntries(STAT_NAMES.map((name) => [name, 0])) as Record<StatName, number>;
}

export class StatsKeeper extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, name TEXT NOT NULL, value INTEGER NOT NULL, PRIMARY KEY (day, name))",
    );
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }

  /** Adds one request's numbers to the given day. Unknown names and bad numbers are ignored. */
  record(day: string, counts: StatCounts): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    for (const name of STAT_NAMES) {
      const value = counts[name];
      if (!Number.isSafeInteger(value) || (value as number) <= 0) continue;
      this.ctx.storage.sql.exec(
        "INSERT INTO counts (day, name, value) VALUES (?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET value = value + excluded.value",
        day,
        name,
        value as number,
      );
    }
  }

  /**
   * The totals that may be shown, as of `day` (today, UTC).
   *
   * First moves the published cut-off forward over finished days, in batches
   * of at least `minBatch` checks. Days that do not yet make a full batch wait
   * for later ones. Then adds up everything up to the cut-off.
   */
  published(day: string, minBatch: number): PublishedTotals {
    const rows = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM meta WHERE key = 'published_through'")
      .toArray();
    let through: string | null = rows[0]?.value ?? null;

    const pending = this.ctx.storage.sql
      .exec<{ day: string; checks: number }>(
        "SELECT day, SUM(value) AS checks FROM counts WHERE name IN ('checks_full', 'checks_quick') AND day > ? AND day < ? GROUP BY day ORDER BY day",
        through ?? "",
        day,
      )
      .toArray();
    let batch = 0;
    let cut: string | null = null;
    for (const row of pending) {
      batch += row.checks;
      if (batch >= minBatch) {
        cut = row.day;
        batch = 0;
      }
    }
    if (cut !== null) {
      through = cut;
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('published_through', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        cut,
      );
    }

    const totals = zeroTotals();
    if (through === null) return { since: null, through: null, totals };
    const sums = this.ctx.storage.sql
      .exec<{ name: string; total: number }>(
        "SELECT name, SUM(value) AS total FROM counts WHERE day <= ? GROUP BY name",
        through,
      )
      .toArray();
    for (const { name, total } of sums) {
      if ((STAT_NAMES as readonly string[]).includes(name)) totals[name as StatName] = total;
    }
    const first = this.ctx.storage.sql
      .exec<{ day: string | null }>("SELECT MIN(day) AS day FROM counts WHERE day <= ?", through)
      .toArray();
    return { since: first[0]?.day ?? null, through, totals };
  }
}

/**
 * Turns one check's log entry into the numbers the counter keeps. Returns
 * null for requests that are not counted (see the top of this file).
 */
export function statsFromLog(log: Omit<CheckLog, "status" | "durationMs">): StatCounts | null {
  const counts: StatCounts = {};
  switch (log.result) {
    case "full":
      counts.checks_full = 1;
      break;
    case "quick":
      counts.checks_quick = 1;
      if (log.modelStep === "switched_off") counts.quick_model_off = 1;
      else if (log.modelStep === "budget_reached") counts.quick_daily_budget = 1;
      else counts.quick_model_unavailable = 1;
      break;
    case "text_too_long":
      counts.guardrail_size_cap = 1;
      return counts;
    case "bot_check_failed":
      counts.guardrail_bot_check = 1;
      return counts;
    default:
      return null;
  }
  if (log.guardrail === "daily_budget") counts.guardrail_daily_budget = 1;
  if (log.modelMs !== null) {
    counts.model_calls = 1;
    counts.model_ms = Math.max(0, Math.round(log.modelMs));
    counts.input_tokens = log.inputTokens ?? 0;
    counts.output_tokens = log.outputTokens ?? 0;
    counts.cost_micros = log.costMicros ?? 0;
  }
  return counts;
}

/** The one shared counter. */
function keeper(namespace: DurableObjectNamespace<StatsKeeper>) {
  return namespace.get(namespace.idFromName("stats"));
}

/**
 * Adds one check to the counter. A failure here never affects the visitor:
 * the stats are a report, not a guardrail. It is noted in the log.
 */
export async function recordCheck(
  namespace: DurableObjectNamespace<StatsKeeper>,
  log: Omit<CheckLog, "status" | "durationMs">,
): Promise<void> {
  const counts = statsFromLog(log);
  if (counts === null) return;
  try {
    await keeper(namespace).record(today(), counts);
  } catch {
    logFailure("stats_write_failed");
  }
}

/** Reads STATS_MIN_BATCH. Null if it is not a sensible number. */
export function readMinBatch(value: string): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number >= 1 && number <= 1000 ? number : null;
}

/** Rounds to a fixed number of decimal places. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** The public reply, built from the published totals. Totals and averages only. */
export function statsReply(published: PublishedTotals) {
  const t = published.totals;
  const checks = t.checks_full + t.checks_quick;
  return {
    since: published.since,
    asOf: published.through,
    checks: { total: checks, full: t.checks_full, quick: t.checks_quick },
    quickBecause: {
      modelOff: t.quick_model_off,
      dailyBudget: t.quick_daily_budget,
      modelUnavailable: t.quick_model_unavailable,
    },
    guardrails: {
      sizeCap: t.guardrail_size_cap,
      botCheck: t.guardrail_bot_check,
      dailyBudget: t.guardrail_daily_budget,
    },
    model: {
      calls: t.model_calls,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      averageSeconds: t.model_calls === 0 ? null : round(t.model_ms / t.model_calls / 1000, 1),
    },
    cost: {
      totalUsd: round(t.cost_micros / 1_000_000, 6),
      perCheckUsd: checks === 0 ? null : round(t.cost_micros / checks / 1_000_000, 6),
    },
  };
}

/** GET /stats. */
export async function statsEndpoint(request: Request, env: Env, origin: OriginCheck): Promise<Response> {
  // Reading the stats is cheap, but each read reaches the counter, so it has
  // its own rate limit.
  if (!(await withinRateLimit(request, env.STATS_LIMITER))) {
    return json({ error: "rate_limited", retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS }, 429, origin, {
      "retry-after": String(RATE_LIMIT_WINDOW_SECONDS),
    });
  }

  // A broken setting means nothing is published, rather than everything.
  const minBatch = readMinBatch(env.STATS_MIN_BATCH);
  if (minBatch === null) return json({ error: "stats_unavailable" }, 503, origin);

  let published: PublishedTotals;
  try {
    published = await keeper(env.STATS).published(today(), minBatch);
  } catch {
    logFailure("stats_read_failed");
    return json({ error: "stats_unavailable" }, 503, origin);
  }
  return json(statsReply(published), 200, origin);
}
