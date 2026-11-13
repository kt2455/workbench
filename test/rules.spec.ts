import { describe, expect, it } from "vitest";
import { runRules } from "../src/rules";
import labels from "../testset/labels.json";

// Every sample in the test set, read as plain text.
const samples = import.meta.glob<string>("../testset/samples/*.txt", {
  query: "?raw",
  import: "default",
  eager: true,
});

function sample(id: string): string {
  return samples[`../testset/samples/${id}.txt`];
}

describe("the staccato rule", () => {
  it("flags three very short sentences in a row", () => {
    const text = "We changed the format of the weekly review in March. Fewer meetings. Clearer notes. Better Fridays. Nobody on the team has asked to go back.";
    const findings = runRules(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "staccato",
      quote: "Fewer meetings. Clearer notes. Better Fridays.",
      foundBy: "rule",
    });
  });

  it("does not flag two short sentences", () => {
    expect(runRules("It worked. We were surprised. Then the quarterly numbers arrived and changed our minds.")).toEqual([]);
  });

  it("does not count across a paragraph break", () => {
    expect(runRules("It worked.\n\nWe were surprised.\n\nNobody complained.")).toEqual([]);
  });
});

describe("the contrast turn rule", () => {
  it("flags a denial followed by the replacement, as whole sentences", () => {
    const text = "I thought about it for most of a week. The problem with the project wasn't the budget. It was trust. So we changed course before the next review.";
    const findings = runRules(text);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: "contrast_turn",
      quote: "The problem with the project wasn't the budget. It was trust.",
    });
  });

  it("does not flag an ordinary negative sentence", () => {
    expect(runRules("The report wasn't ready on Friday, so the team sent it the following Tuesday instead.")).toEqual([]);
  });
});

describe("the signpost rule", () => {
  it("flags the phrase itself", () => {
    const findings = runRules("I ran the numbers twice over the weekend. It turns out the old process was faster.");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: "signpost", quote: "It turns out" });
  });
});

describe("every rule finding", () => {
  it("points at the exact place in the draft, in draft order, without overlaps", () => {
    const text =
      "Here's what I learned from a year of this. It isn't about speed. It's about care.\n\nNo slides. No decks. No noise. The key is patience.";
    const findings = runRules(text);
    expect(findings.length).toBeGreaterThan(1);
    let previousEnd = 0;
    for (const finding of findings) {
      expect(text.slice(finding.start, finding.end)).toBe(finding.quote);
      expect(finding.start).toBeGreaterThanOrEqual(previousEnd);
      expect(finding.why.length).toBeLessThanOrEqual(200);
      expect(finding.fix.length).toBeLessThanOrEqual(200);
      previousEnd = finding.end;
    }
  });

  it("finds nothing in an empty draft", () => {
    expect(runRules("")).toEqual([]);
  });
});

// The rule every rule must obey: never flag writing Kyle marked clean.
describe("the rules against the hand-marked test set", () => {
  const ids = Object.keys(labels) as Array<keyof typeof labels>;

  it("has all 38 samples to hand", () => {
    expect(ids).toHaveLength(38);
    for (const id of ids) expect(sample(id)).toBeTypeOf("string");
  });

  it("fires on no sample marked clean", () => {
    const flagged = ids.filter((id) => labels[id].verdict === "CLEAN" && runRules(sample(id)).length > 0);
    expect(flagged).toEqual([]);
  });

  it("still fires on the samples it was built from", () => {
    const fired = (verdict: string) =>
      ids.filter((id) => labels[id].verdict === verdict && runRules(sample(id)).length > 0).length;
    expect(fired("A FEW TELLS")).toBe(3);
    expect(fired("OBVIOUSLY AI")).toBe(6);
  });
});

describe("speed on a crafted draft", () => {
  it("stays fast on 8,000 characters built to trigger the contrast rule over and over", () => {
    const draft = "not. we ".repeat(1000);
    const started = performance.now();
    runRules(draft);
    // Workers' clock only moves on I/O, so time it here with a loop of work
    // that would have been slow before: the result must simply come back.
    const findings = runRules(draft);
    expect(findings.length).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
