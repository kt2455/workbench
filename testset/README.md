# Test set

The answer key for the Tells Checker. Every prompt and model change is scored against
it, so "is it better?" has a measured answer instead of an opinion.

**Analogy:** this is the marked exam paper a new teacher is trained on. Kyle marks it
once by hand. After that, the tool's marking is compared with his.

## What is here

| File | What it is |
|---|---|
| `samples/s01.txt` to `s38.txt` | The 38 samples, in shuffled order. Plain text, exactly as a visitor would paste it. These files are never edited. |
| `marking-sheet.md` | All 38 samples in one file, with the marking instructions. The blank form Kyle marked from. |
| `key.json` | Where each sample came from. Kept apart from the samples so the marking could be done blind. |
| `labels.json` | **The answer key.** Kyle's verdict for each sample and every passage he marked, with its exact position in the sample. |

## The mix

| Kind | Count | Where they came from |
|---|---|---|
| Kyle's recent writing | 10 | Excerpts from his four published posts, word for word, with links and bold removed |
| Kyle's older writing | 5 | Excerpts from an article he wrote before AI writing assistants were in common use, word for word, except that a former employer's name is replaced with "my firm". Footnote and trademark marks removed |
| Raw AI drafts | 16 | Eight written by Claude, four by Gemini and four by ChatGPT, all unedited first drafts. Gemini and ChatGPT were given the same four tasks, so their styles can be compared like for like |
| Edited AI drafts | 7 | Claude drafts with the obvious tells edited out to different depths, leaving subtler ones |

Fifteen of the 38 samples are human writing, on purpose. Wrongly flagging clean writing is the
failure that matters most, so the set needs plenty of it.

The older article earns its place for a second reason. It uses words such as
"leverage" and "unlock", which sit on the banned list in the website's content
checks, yet no AI was involved. It tests whether the tool can tell a word a person
chose from a pattern a model fell into.

## What the marking showed

Kyle marked all 38 samples blind in November 2026: 55 marked passages, and one verdict
per sample.

| Source | Samples | Clean | A few tells | Obviously AI |
|---|---|---|---|---|
| Kyle's older article | 5 | 5 | 0 | 0 |
| Kyle's recent posts | 10 | 3 | 7 | 0 |
| Raw drafts, Claude | 8 | 1 | 4 | 3 |
| Raw drafts, Gemini | 4 | 3 | 1 | 0 |
| Raw drafts, ChatGPT | 4 | 2 | 1 | 1 |
| Edited drafts, Claude | 7 | 0 | 2 | 5 |

Three findings shape how the tool is built and scored:

1. **Rhythm matters more than vocabulary.** Words on the website's banned list appear
   49 times in the samples, and only about a quarter fall inside a marked passage.
   What Kyle marked was cadence: runs of short punchy sentences, the "it wasn't X, it
   was Y" turn, the tidy one-line closer.
2. **Generic is not the same as AI-sounding.** Several raw AI drafts in a bland
   corporate register were marked clean. In Kyle's words, that is "how people write
   these types of things". The tool should not flag writing only for being generic.
3. **Kyle's recent posts are not all clean.** Seven of ten excerpts got "a few tells".
   They are a sample of his voice, not a definition of clean writing. The older
   article is the cleaner baseline.

## How to score against it

- Score the **verdict per sample** first. It is the most reliable signal.
- Treat marked passages as regions, not exact strings. Kyle often marked a whole
  paragraph where one sentence carried the pattern, so a finding that overlaps a
  marked passage counts as a match.
- A finding in a sample marked clean is a false flag. These matter most.

## Known limits

- The AI samples come from three assistants: Claude, Gemini and ChatGPT. The Gemini
  and ChatGPT model versions were not recorded.
- The ChatGPT drafts were pasted with formatting marks. Bold markers, heading
  symbols and interface labels were removed so each sample reads as a visitor would
  paste it. No words were changed.
- The "edited" samples were edited by an AI, not a person. Real human edits of AI
  drafts are better and can replace these over time.
- Kyle's posts were written with AI help and his voice skill. They are still the
  ground truth for "sounds like Kyle", which is what the tool is tuned to respect.
- Thirty-eight samples is small. Phase 2 grows it to 40 or more from real misses.

## Rules

- No client material, ever.
- Samples and labels are frozen. To change the set, add new samples and mark them.
- The verdicts stand as first marked, blind. They were not revised after the sources
  were revealed.
- Names in the AI samples are invented.
