import { describe, expect, it } from "vitest";
import { locate, merge, parseModelOutput } from "../src/merge";
import type { Finding } from "../src/tells";

const reply = (value: unknown) => JSON.stringify(value);
const finding = (quote: string, extra: Record<string, unknown> = {}) => ({
  quote,
  type: "tidy_closer",
  why: "It lands like a slogan.",
  fix: "End on the last concrete detail.",
  ...extra,
});

describe("reading the model's reply", () => {
  it("accepts the expected shape", () => {
    const output = parseModelOutput(reply({ verdict: "a_few_tells", summary: "Mostly fine.", findings: [finding("x")] }));
    expect(output).toEqual({ verdict: "a_few_tells", summary: "Mostly fine.", findings: [finding("x")] });
  });

  it("accepts JSON wrapped in a code fence", () => {
    const raw = "```json\n" + reply({ verdict: "clean", summary: "Fine.", findings: [] }) + "\n```";
    expect(parseModelOutput(raw)?.verdict).toBe("clean");
  });

  it.each([
    ["text that is not JSON", "The draft looks fine to me."],
    ["a list instead of an object", "[]"],
    ["an unknown verdict", reply({ verdict: "written_by_ai", summary: "x", findings: [] })],
    ["a missing summary", reply({ verdict: "clean", findings: [] })],
    ["findings that are not a list", reply({ verdict: "clean", summary: "x", findings: "none" })],
  ])("rejects %s", (_name, raw) => {
    expect(parseModelOutput(raw)).toBeNull();
  });

  it("drops a malformed finding and keeps the rest", () => {
    const output = parseModelOutput(
      reply({ verdict: "a_few_tells", summary: "x", findings: [{ quote: 5 }, "nonsense", finding(""), finding("kept")] }),
    );
    expect(output?.findings.map((f) => f.quote)).toEqual(["kept"]);
  });

  it("turns an unknown kind of tell into 'other'", () => {
    const output = parseModelOutput(
      reply({ verdict: "a_few_tells", summary: "x", findings: [finding("q", { type: "robot_voice" })] }),
    );
    expect(output?.findings[0].type).toBe("other");
  });

  it("shortens an over-long explanation at a word boundary", () => {
    const long = "word ".repeat(80);
    const output = parseModelOutput(
      reply({ verdict: "a_few_tells", summary: "x", findings: [finding("q", { why: long, fix: long })] }),
    );
    const { why, fix } = output!.findings[0];
    expect(why.length).toBeLessThanOrEqual(200);
    expect(fix.length).toBeLessThanOrEqual(200);
    expect(why.endsWith("word…")).toBe(true);
  });
});

describe("finding the model's quotes in the draft", () => {
  const draft = "We shipped on Friday. And that made all the difference. People noticed. And that made all the difference.";
  const base = { type: "tidy_closer" as const, why: "w", fix: "f" };

  it("works out where an exact quote sits", () => {
    const [found] = locate(draft, [{ ...base, quote: "And that made all the difference." }]);
    expect(draft.slice(found.start, found.end)).toBe("And that made all the difference.");
    expect(found).toMatchObject({ start: 22, foundBy: "model" });
  });

  it("drops a quote that is not in the draft word for word", () => {
    expect(locate(draft, [{ ...base, quote: "and that made all the difference" }])).toEqual([]);
    expect(locate(draft, [{ ...base, quote: "Something the model made up." }])).toEqual([]);
  });

  it("gives a repeated quote the next free place", () => {
    const quote = "And that made all the difference.";
    const found = locate(draft, [
      { ...base, quote },
      { ...base, quote },
      { ...base, quote },
    ]);
    expect(found.map((f) => f.start)).toEqual([22, draft.lastIndexOf(quote)]);
  });

  it("drops a quote that overlaps one already kept", () => {
    const found = locate(draft, [
      { ...base, quote: "We shipped on Friday. And that made" },
      { ...base, quote: "on Friday." },
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("combining the two layers", () => {
  const at = (start: number, end: number, foundBy: Finding["foundBy"], type: Finding["type"]): Finding => ({
    quote: "q",
    start,
    end,
    type,
    why: `${foundBy} why`,
    fix: "f",
    foundBy,
  });

  it("shows a passage both layers flagged once, with the model's explanation", () => {
    const result = merge(
      { verdict: "a_few_tells", findings: [at(10, 40, "model", "contrast_turn")] },
      [at(20, 30, "rule", "contrast_turn")],
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ start: 10, end: 40, why: "model why", foundBy: "both" });
  });

  it("keeps findings only one layer made, in draft order", () => {
    const result = merge(
      { verdict: "a_few_tells", findings: [at(50, 60, "model", "tidy_closer")] },
      [at(0, 10, "rule", "signpost")],
    );
    expect(result.findings.map((f) => [f.start, f.foundBy])).toEqual([
      [0, "rule"],
      [50, "model"],
    ]);
  });

  it("keeps at most five, the earliest in the draft", () => {
    const model = [0, 20, 40, 60].map((start) => at(start, start + 5, "model", "other"));
    const rules = [10, 30, 50].map((start) => at(start, start + 5, "rule", "signpost"));
    const result = merge({ verdict: "obviously_ai", findings: model }, rules);
    expect(result.findings.map((f) => f.start)).toEqual([0, 10, 20, 30, 40]);
  });

  it("changes 'clean' to 'a few tells' when a rule fired", () => {
    const result = merge({ verdict: "clean", findings: [] }, [at(0, 10, "rule", "staccato")]);
    expect(result.verdict).toBe("a_few_tells");
  });

  it("leaves 'clean' alone when nothing was found", () => {
    expect(merge({ verdict: "clean", findings: [] }, [])).toEqual({ verdict: "clean", findings: [] });
  });

  it("never lowers the model's verdict", () => {
    const result = merge({ verdict: "obviously_ai", findings: [at(0, 5, "model", "neat_story")] }, []);
    expect(result.verdict).toBe("obviously_ai");
  });
});
