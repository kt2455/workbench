/**
 * The daily budget: the Worker's own spending limit.
 *
 * One counter holds how much has been spent on model calls today. Before a
 * call, the worst-case cost is set aside ("reserved"). After the call, the
 * reservation is replaced by what the call really cost. If setting it aside
 * would take the day over the limit, the call is not made and the visitor
 * gets the free quick check.
 *
 * Reserving first is what makes the limit hold when many requests arrive at
 * once. Without it, a hundred requests could each see "budget left" and all
 * spend at the same moment.
 *
 * The counter lives in a Durable Object: a small piece of the Worker with its
 * own storage that handles one request at a time, so two requests can never
 * read the same total and both add to it.
 *
 * Money is counted in millionths of a dollar ("micro-dollars"), as whole
 * numbers, so rounding never loses or invents money.
 */

import { DurableObject } from "cloudflare:workers";

export const MICROS_PER_DOLLAR = 1_000_000;

export class BudgetKeeper extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, micros INTEGER NOT NULL, calls INTEGER NOT NULL)",
    );
  }

  /** What has been spent or set aside on the given day. */
  spent(day: string): number {
    const rows = this.ctx.storage.sql.exec<{ micros: number }>("SELECT micros FROM spend WHERE day = ?", day).toArray();
    return rows[0]?.micros ?? 0;
  }

  /**
   * Sets aside `micros` for one model call, if the day's limit allows it.
   * Returns false, and changes nothing, when it does not.
   */
  reserve(day: string, micros: number, limitMicros: number): boolean {
    if (!Number.isSafeInteger(micros) || micros <= 0 || !Number.isSafeInteger(limitMicros)) return false;
    if (this.spent(day) + micros > limitMicros) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO spend (day, micros, calls) VALUES (?, ?, 1) ON CONFLICT (day) DO UPDATE SET micros = micros + excluded.micros, calls = calls + 1",
      day,
      micros,
    );
    // Old days are not needed. Keeping a week is enough to spot a pattern.
    this.ctx.storage.sql.exec("DELETE FROM spend WHERE day < date(?, '-7 days')", day);
    return true;
  }

  /** Replaces a reservation with what the call really cost. */
  settle(day: string, reservedMicros: number, actualMicros: number): void {
    const actual = Number.isSafeInteger(actualMicros) && actualMicros >= 0 ? actualMicros : reservedMicros;
    this.ctx.storage.sql.exec(
      "UPDATE spend SET micros = MAX(0, micros - ? + ?) WHERE day = ?",
      reservedMicros,
      // A call can never be settled for more than was set aside for it.
      Math.min(actual, reservedMicros),
      day,
    );
  }
}

/** The prices and the limit, read from the settings. */
export interface BudgetSettings {
  limitMicros: number;
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
}

/**
 * Reads the budget settings. Returns null if any of them is missing or is not
 * a sensible number, in which case no model call is made: a broken setting
 * must never mean an unlimited budget.
 */
export function readBudgetSettings(env: {
  DAILY_BUDGET_USD: string;
  MODEL_INPUT_USD_PER_MTOK: string;
  MODEL_OUTPUT_USD_PER_MTOK: string;
}): BudgetSettings | null {
  const numbers = [env.DAILY_BUDGET_USD, env.MODEL_INPUT_USD_PER_MTOK, env.MODEL_OUTPUT_USD_PER_MTOK].map((value) =>
    typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN,
  );
  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [dailyUsd, inputUsdPerMtok, outputUsdPerMtok] = numbers;
  if (inputUsdPerMtok <= 0 || outputUsdPerMtok <= 0) return null;
  return {
    limitMicros: Math.floor(dailyUsd * MICROS_PER_DOLLAR),
    // Dollars per million tokens is the same number as micro-dollars per token.
    inputMicrosPerToken: inputUsdPerMtok,
    outputMicrosPerToken: outputUsdPerMtok,
  };
}

/** The cost of a call in micro-dollars, rounded up. */
export function costMicros(settings: BudgetSettings, inputTokens: number, outputTokens: number): number {
  return Math.ceil(inputTokens * settings.inputMicrosPerToken + outputTokens * settings.outputMicrosPerToken);
}

/**
 * A deliberately high guess at how many tokens some text is. Real text runs
 * at about four characters per token. Guessing two means the reservation is
 * always more than the real cost, so the budget errs towards stopping early.
 */
export function tokenCeiling(characters: number): number {
  return Math.ceil(characters / 2);
}

/** What the check needs from the budget: set money aside, then settle up. */
export interface Budget {
  reserve(micros: number): Promise<boolean>;
  settle(reservedMicros: number, actualMicros: number): Promise<void>;
}

/** Today's date in UTC, such as "2026-11-12". The budget resets when it changes. */
export function today(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Connects the check to the one shared counter. */
export function sharedBudget(namespace: DurableObjectNamespace<BudgetKeeper>, limitMicros: number): Budget {
  const keeper = namespace.get(namespace.idFromName("daily-budget"));
  const day = today();
  return {
    reserve: async (micros) => keeper.reserve(day, micros, limitMicros),
    settle: async (reserved, actual) => keeper.settle(day, reserved, actual),
  };
}
