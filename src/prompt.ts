/**
 * The prompt the Tells Checker uses now, and the kinds of tell it may report.
 *
 * A prompt version and its list of allowed types travel together: the list is
 * sent to the model as part of the reply's shape, and anything outside it is
 * dropped when the reply is read. Going back to an earlier version means
 * changing this file only.
 *
 * v2 switches off three types the model reported far more often than Kyle
 * marked them in the test set: `stock_phrase`, `tidy_closer` and
 * `balanced_list`. The numbers are in prompts/README.md. Each comes back later,
 * one at a time, with sharper criteria and its own scoring run.
 */

import promptV2 from "../prompts/tells-checker/v2.md";
import { TELL_TYPES, type TellType } from "./tells";

const SWITCHED_OFF: readonly TellType[] = ["stock_phrase", "tidy_closer", "balanced_list"];

export const PROMPT = {
  version: "v2",
  text: promptV2,
  /** The kinds of tell the model may report under this version. */
  modelTypes: TELL_TYPES.filter((type) => !SWITCHED_OFF.includes(type)),
} as const;
