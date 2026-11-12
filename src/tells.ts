/**
 * The vocabulary of the Tells Checker: the kinds of tell, the verdicts and the
 * shape of a reply. The full description is in docs/tells-checker-design.md.
 */

/** The kinds of tell the rules can find. */
export const RULE_TYPES = ["staccato", "contrast_turn", "signpost"] as const;

/** Every kind of tell. The rest can only come from the model. */
export const TELL_TYPES = [
  ...RULE_TYPES,
  "tidy_closer",
  "engagement_hook",
  "stock_phrase",
  "balanced_list",
  "neat_story",
  "other",
] as const;

export const VERDICTS = ["clean", "a_few_tells", "obviously_ai"] as const;

export type RuleType = (typeof RULE_TYPES)[number];
export type TellType = (typeof TELL_TYPES)[number];
export type Verdict = (typeof VERDICTS)[number];

/** The most findings shown for one draft. */
export const MAX_FINDINGS = 5;
/** The longest "why" or "fix" shown, in characters. */
export const MAX_EXPLANATION_CHARS = 200;

/**
 * One passage flagged in the draft.
 *
 * `start` and `end` are positions in the draft as JavaScript counts them
 * (UTF-16 code units), so `draft.slice(start, end)` is always the quote. The
 * page that highlights the passage is JavaScript too, so the two agree.
 */
export interface Finding {
  quote: string;
  start: number;
  end: number;
  type: TellType;
  why: string;
  fix: string;
  foundBy: "rule" | "model" | "both";
}

export type Notice = "daily_budget_reached" | "model_unavailable";

export interface CheckResponse {
  mode: "full" | "quick";
  verdict: Verdict | null;
  summary: string | null;
  findings: Finding[];
  houseStyle: null;
  notice: Notice | null;
  meta: { promptVersion: string; charactersChecked: number };
}
