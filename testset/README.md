# Test set

The answer key for the Tells Checker. Every prompt and model change is scored against
it, so "is it better?" has a measured answer instead of an opinion.

**Analogy:** this is the marked exam paper a new teacher is trained on. Kyle marks it
once by hand. After that, the tool's marking is compared with his.

## What is here

| File | What it is |
|---|---|
| `samples/s01.txt` to `s38.txt` | The 38 samples, in shuffled order. Plain text, exactly as a visitor would paste it. These files are never edited. |
| `marking-sheet.md` | All 38 samples in one file, with instructions. Kyle marks the tells here. |
| `key.json` | Where each sample came from. **Kyle does not open this until marking is finished.** |

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
- Samples are frozen once marking starts. To change one, add a new sample instead.
- Names in the AI samples are invented.
