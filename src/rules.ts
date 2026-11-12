/**
 * Layer 1 of the Tells Checker: the rhythm rules.
 *
 * Fixed patterns found by ordinary code. Free, instant, and the same answer
 * every time. Each rule earned its place by not firing on any sample Kyle
 * marked clean (see testset/ and test/rules.spec.ts). A rule that starts
 * flagging clean writing is removed, not tuned until it passes.
 */

import type { Finding, RuleType } from "./tells";

interface Span {
  start: number;
  end: number;
}

interface Sentence extends Span {
  words: number;
}

const EXPLANATIONS: Record<RuleType, { why: string; fix: string }> = {
  staccato: {
    why: "A run of very short sentences reads as a drumbeat written for effect.",
    fix: "Join them into one or two full sentences that say what you mean.",
  },
  contrast_turn: {
    why: "The first idea is set up only to be knocked down, which sounds rehearsed.",
    fix: "Say the point you believe in one plain sentence and drop the setup.",
  },
  signpost: {
    why: "The phrase announces that a point is coming instead of making it.",
    fix: "Delete the phrase and start with the point itself.",
  },
};

/** A sentence this short counts towards a staccato run. */
const STACCATO_MAX_WORDS = 5;
/** This many short sentences in a row make a staccato run. */
const STACCATO_MIN_RUN = 3;

const WORD = /[\w'’-]+/g;
const SENTENCE = /[^.!?\n]+[.!?]+["”)]*|[^.!?\n]+/g;

/**
 * Splits the draft into paragraphs of sentences, keeping where each sentence
 * sits. A paragraph break ends a run, so sentences are grouped by paragraph.
 */
function paragraphs(text: string): Sentence[][] {
  const result: Sentence[][] = [];
  for (const line of text.matchAll(/[^\n]+/g)) {
    const sentences: Sentence[] = [];
    for (const match of line[0].matchAll(SENTENCE)) {
      const raw = match[0];
      const trimmed = raw.trim();
      if (trimmed === "") continue;
      const start = line.index + match.index + raw.indexOf(trimmed);
      sentences.push({
        start,
        end: start + trimmed.length,
        words: trimmed.match(WORD)?.length ?? 0,
      });
    }
    result.push(sentences);
  }
  return result;
}

/** Three or more very short sentences in a row, inside one paragraph. */
function staccatoRuns(text: string): Span[] {
  const spans: Span[] = [];
  for (const sentences of paragraphs(text)) {
    let run: Sentence[] = [];
    const close = () => {
      if (run.length >= STACCATO_MIN_RUN) {
        spans.push({ start: run[0].start, end: run[run.length - 1].end });
      }
      run = [];
    };
    for (const sentence of sentences) {
      if (sentence.words > 0 && sentence.words <= STACCATO_MAX_WORDS) run.push(sentence);
      else close();
    }
    close();
  }
  return spans;
}

/**
 * The contrast turn: "It isn't X. It's Y." A denial, then within a short
 * distance a sentence break or dash, then the replacement idea.
 */
const CONTRAST =
  /\b(?:isn['’]t|wasn['’]t|aren['’]t|weren['’]t|don['’]t|doesn['’]t|not)\b[^.!?\n]{0,70}(?:[.!?]\s+|\s[—–-]\s?)(?:It['’]s|It was|They['’]re|That['’]s|we|people|It demands)\b/gi;

/** Widens a match to the whole sentences it touches, so the quote reads well. */
function widenToSentences(text: string, match: Span): Span {
  let start = match.start;
  let end = match.end;
  for (const sentence of paragraphs(text).flat()) {
    if (sentence.start < match.end && match.start < sentence.end) {
      start = Math.min(start, sentence.start);
      end = Math.max(end, sentence.end);
    }
  }
  return { start, end };
}

function contrastTurns(text: string): Span[] {
  return [...text.matchAll(CONTRAST)].map((match) =>
    widenToSentences(text, { start: match.index, end: match.index + match[0].length }),
  );
}

/** Phrases that announce a point. The second list counts only at the start of a line. */
const SIGNPOST_ANYWHERE =
  /\b(?:Here['’]s what I learned|The results surprised me|It turns out|one thing (?:is|has become) (?:abundantly )?clear|The (?:key|secret) is)\b/gi;
const SIGNPOST_LINE_START = /^(?:Here are (?:three|3|a few)|Looking back|The (?:answer|catch) is)/gim;

function signposts(text: string): Span[] {
  return [...text.matchAll(SIGNPOST_ANYWHERE), ...text.matchAll(SIGNPOST_LINE_START)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** True when two passages share at least one character. */
export function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Runs every rule and returns the findings in draft order. Where two rules
 * flag the same passage, the earlier one is kept so nothing is shown twice.
 */
export function runRules(text: string): Finding[] {
  const candidates: Array<Span & { type: RuleType }> = [
    ...staccatoRuns(text).map((span) => ({ ...span, type: "staccato" as const })),
    ...contrastTurns(text).map((span) => ({ ...span, type: "contrast_turn" as const })),
    ...signposts(text).map((span) => ({ ...span, type: "signpost" as const })),
  ].sort((a, b) => a.start - b.start || b.end - a.end);

  const findings: Finding[] = [];
  for (const candidate of candidates) {
    if (findings.some((kept) => overlaps(kept, candidate))) continue;
    findings.push({
      quote: text.slice(candidate.start, candidate.end),
      start: candidate.start,
      end: candidate.end,
      type: candidate.type,
      ...EXPLANATIONS[candidate.type],
      foundBy: "rule",
    });
  }
  return findings;
}
