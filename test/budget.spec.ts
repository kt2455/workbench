import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { costMicros, readBudgetSettings, today, tokenCeiling } from "../src/budget";

let counters = 0;
/** A fresh counter for each test, so one test's spending never affects another's. */
function freshCounter() {
  counters += 1;
  return env.BUDGET.get(env.BUDGET.idFromName(`test-${Date.now()}-${counters}`));
}

const DAY = "2026-11-12";

describe("the daily budget counter", () => {
  it("starts the day at nothing", async () => {
    expect(await freshCounter().spent(DAY)).toBe(0);
  });

  it("grants a reservation that fits and records it", async () => {
    const counter = freshCounter();
    expect(await counter.reserve(DAY, 300, 1000)).toBe(true);
    expect(await counter.spent(DAY)).toBe(300);
  });

  it("refuses a reservation that would go over, and changes nothing", async () => {
    const counter = freshCounter();
    await counter.reserve(DAY, 800, 1000);
    expect(await counter.reserve(DAY, 300, 1000)).toBe(false);
    expect(await counter.spent(DAY)).toBe(800);
  });

  it("allows spending up to the limit exactly", async () => {
    const counter = freshCounter();
    expect(await counter.reserve(DAY, 1000, 1000)).toBe(true);
    expect(await counter.reserve(DAY, 1, 1000)).toBe(false);
  });

  it("never goes over when many requests arrive at once", async () => {
    const counter = freshCounter();
    const results = await Promise.all(Array.from({ length: 50 }, () => counter.reserve(DAY, 300, 1000)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await counter.spent(DAY)).toBe(900);
  });

  it("replaces a reservation with the real cost", async () => {
    const counter = freshCounter();
    await counter.reserve(DAY, 300, 1000);
    await counter.settle(DAY, 300, 120);
    expect(await counter.spent(DAY)).toBe(120);
  });

  it("records the full real cost, even when it is more than was set aside", async () => {
    const counter = freshCounter();
    await counter.reserve(DAY, 300, 1000);
    await counter.settle(DAY, 300, 5000);
    expect(await counter.spent(DAY)).toBe(5000);
    // And the day is then over budget, so nothing more is allowed.
    expect(await counter.reserve(DAY, 1, 1000)).toBe(false);
  });

  it("keeps the reservation if the real cost is nonsense", async () => {
    const counter = freshCounter();
    await counter.reserve(DAY, 300, 1000);
    await counter.settle(DAY, 300, Number.NaN);
    expect(await counter.spent(DAY)).toBe(300);
  });

  it("starts again on a new day", async () => {
    const counter = freshCounter();
    await counter.reserve(DAY, 1000, 1000);
    expect(await counter.reserve("2026-11-13", 300, 1000)).toBe(true);
    expect(await counter.spent("2026-11-13")).toBe(300);
  });

  it("forgets days more than a week old", async () => {
    const counter = freshCounter();
    await counter.reserve("2026-11-01", 500, 1000);
    await counter.reserve(DAY, 100, 1000);
    expect(await counter.spent("2026-11-01")).toBe(0);
  });

  it.each([
    ["nothing", 0],
    ["a negative amount", -5],
    ["a fraction", 1.5],
    ["nonsense", Number.NaN],
  ])("refuses to reserve %s", async (_name, amount) => {
    expect(await freshCounter().reserve(DAY, amount, 1000)).toBe(false);
  });
});

describe("the budget settings", () => {
  const settings = { DAILY_BUDGET_USD: "1.00", MODEL_INPUT_USD_PER_MTOK: "0.10", MODEL_OUTPUT_USD_PER_MTOK: "0.50" };

  it("reads the shipped settings", () => {
    expect(readBudgetSettings(env)).toEqual({ limitMicros: 1_000_000, inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 });
  });

  it("keeps a month of the shipped daily budget inside the $50 target", () => {
    expect(Number(env.DAILY_BUDGET_USD) * 31).toBeLessThan(50);
  });

  it.each([
    ["a missing budget", { DAILY_BUDGET_USD: undefined }],
    ["a budget in words", { DAILY_BUDGET_USD: "one dollar" }],
    ["a negative budget", { DAILY_BUDGET_USD: "-1" }],
    ["a budget with a currency sign", { DAILY_BUDGET_USD: "$1" }],
    ["a budget of infinity", { DAILY_BUDGET_USD: "Infinity" }],
    ["a free model", { MODEL_OUTPUT_USD_PER_MTOK: "0" }],
  ])("treats %s as no budget at all", (_name, broken) => {
    expect(readBudgetSettings({ ...settings, ...broken } as typeof settings)).toBeNull();
  });

  it("allows a budget of zero, which switches the model off", () => {
    expect(readBudgetSettings({ ...settings, DAILY_BUDGET_USD: "0" })?.limitMicros).toBe(0);
  });
});

describe("working out a cost", () => {
  const prices = { limitMicros: 0, inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 };

  it("prices tokens in millionths of a dollar and rounds up", () => {
    expect(costMicros(prices, 2400, 300)).toBe(390);
    expect(costMicros(prices, 1, 0)).toBe(1);
  });

  it("guesses high when turning characters into tokens: three per character", () => {
    expect(tokenCeiling(8000)).toBe(24_000);
    expect(tokenCeiling(0)).toBe(0);
  });

  it("names the day in UTC", () => {
    expect(today(new Date("2026-11-12T23:59:59Z"))).toBe("2026-11-12");
    expect(today(new Date("2026-11-13T00:00:00Z"))).toBe("2026-11-13");
  });
});
