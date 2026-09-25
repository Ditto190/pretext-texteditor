## Development Setup

Install once:

```sh
bun install
```

### Day-To-Day

- `bun start` — stable local page server at <http://localhost:3000>
- `bun run start:windows` — Windows-friendly fallback without automatic port cleanup
- `bun run check` — typecheck, lint, dead-code scan (`knip`) and a check that the generated engine break data is current
- `bun test` — the unit tests, the harness's offline tests and the demo models' tests

The report-server tests use temporary loopback ports; sandboxed runs need local
listener access. They do not launch browsers.

### Harness

The harness in `harness/` keeps each browser's layout of every case in git, recorded once per browser build, and
predicts every case in the browser the way an app does. See [harness/README.md](harness/README.md) for how a case is
judged, the case sets and the pinned browsers.

- `bun test harness` — the harness's offline tests, each planting a fault it exists to catch, and the line APIs'
  invariants in four engine profiles on cases drawn from the case files (`harness/invariants.ts`)
- `bun harness check` — predict every pinned case in Chrome, Firefox and webkit-host and score it; a failure that
  `harness/accepted/<browser>.txt` doesn't list under a written reason blocks, and `--accept="<reason>"` lists the new ones
- `bun harness gate` — `check`, plus predictions in reverse order, a fresh recording of 1,000 cases and the attribution
  of new failures
- `bun harness record --only-new` — record new cases; after a browser or OS update, `bun harness record` records every
  case again
- `bun harness bench main` — time `main`'s `src/` against this tree's in the same documents, in pinned Chrome and
  Firefox and installed Safari in the foreground, 3 sessions, about 9 minutes per browser; `--rows=new,worst` narrows
  it while iterating, and `--background` runs the background browsers, whose results are hypotheses
  ([harness/README.md](harness/README.md), Bench)
- `bun harness explain <id>` — one case's recorded lines against the predicted ones; `bun harness explain --text='...'
  --width=120.5 --font='16px Arial'` (also `--lang=`, `--white-space=pre-wrap`, `--word-break=keep-all`,
  `--letter-spacing=`) or `--cases=<file of one case>` records that paragraph alone in a fresh document first, in any
  of the four browsers, and keeps nothing

### Packaging And Release

- `bun run build:package` — emit `dist/` for the published ESM package
- `bun run package-smoke-test` — pack the tarball and verify temporary JS + TS consumers
- `bun run site:build` — build the static demo site into `site/`
- `bun run generate:engine-break-data` — refresh Chrome's, Safari's and Firefox's checked-in break and grapheme tables from the engine files in `scripts/engine-data/`, checking each table against its source; `--check` compares the generated file instead of writing it. After refreshing a grapheme table, run the grapheme check in each browser (below).
- `bun run generate:webkit-generic-families` — refresh the families Safari draws `serif`, `sans-serif`, `cursive`, `fantasy` and `monospace` in under each page language, from WebKit's language-to-script map and Core Text's answers on macOS and iOS in `scripts/engine-data/safari-27.0/`; `--check` compares instead of writing

### Browser Accuracy And Benchmarking

- `bun run benchmark-check --output=benchmarks/chrome.json` — refresh the Chrome benchmark snapshot; default is the median of 3 full page runs, use `--runs=1` for a quick local check
- `bun run benchmark-check --browser=safari --output=benchmarks/safari.json` — refresh the Safari benchmark snapshot
- `bun scripts/grapheme-check/build.ts`, then `bun scripts/grapheme-check/run.ts --browser=chrome` — compare `src/graphemes.ts` with the browser's own `Intl.Segmenter` on every code point in contexts that tell the grapheme classes apart, the harness's case texts with their prepared segments, and random strings, under the table the engine profile takes and the other one; also `firefox` and `webkit-host`, in the harness's background browsers, one job per browser at a time. `ENGINE=webkit bun scripts/grapheme-check/offline.ts` runs it under Bun. Node can't load `src/` directly, so bundle it with `bun build --target=node scripts/grapheme-check/offline.ts --outfile=.artifacts/grapheme-check/offline.mjs` and run `ENGINE=blink node .artifacts/grapheme-check/offline.mjs`.

Failed benchmark reports retain their evidence in `<output>.failed.json`, or under
`.artifacts/benchmarks/` when no output path was requested.

The shape rows run after every other section. They prepare batches of
U+3000-indented and letter-spaced Chinese, VS16 and ZWJ emoji, long invisible
tails, soft hyphens, dashes, CJK brackets with and without keep-all, and
controls next to spaces. Each row reports ms per text for its first cold batch,
the median cold batch after `clearCache()`, a warm batch with filled caches and
a hot `layout()` pass. Apart from the first batch, each sample repeats its work
for at least 20ms so Safari's 1ms timer resolves it. `canvasCalls` counts
`measureText()` in one cold batch. The last row is shaped like virtualization:
1,000 distinct sentences in a font no other row measures, so its first batch is
the fresh-text prepare. WebKit's width cache can speed up repeated cold batches
of the same strings, so compare Canvas calls and first batches before trusting a
difference only the median cold batch shows.

Benchmarks require a visible, focused page throughout and reject observed window,
viewport or screen changes. The three runs must have matching environments before
we take their median; snapshots retain each run's request and environment.
Foreground Firefox sessions request activation of the owned tab and process by
PID; a headed window alone does not establish focus. Automation launches Firefox
through LaunchServices (`open -n -a`, with `-g` unless the session asks for
foreground) and stops the process that names its disposable profile, because
macOS 27 denies a shell's processes access to apps' folders under
`~/Library/Application Support` and a directly spawned Firefox exits with
"Could not find profile folder." for any `--profile`.

## Useful Pages

- `/demos` — index of the public demos; `/` redirects there
- `/benchmark` — performance comparisons

## Current Snapshots

Use these for the current checked-in benchmark results; accuracy rests on the harness's recordings and accepted lists
([harness/README.md](harness/README.md)):

- [benchmarks/chrome.json](benchmarks/chrome.json), [benchmarks/safari.json](benchmarks/safari.json) — raw benchmark snapshots

## Deep Profiling

For one-off performance and memory work, start with `bun start` and an isolated, foreground Chrome using a throwaway profile. Reproduce the issue on [pages/benchmark.ts](pages/benchmark.ts), or on a smaller dedicated page when the benchmark is too broad.

Bun/Node microbenchmarks are useful for quick experiments, but browser behavior needs browser measurements.

For algorithmic changes, scale both source length and the number of segments,
forced lines and rich items. Include repeated punctuation,
Arabic joins, CJK keep-all, long hyphenated URLs and internal whitespace runs.
Count visited boundaries and submitted Canvas text, with cold caches, before
relying on timings; doubling an input should not quadruple repeated work.
The history and current bounds are recorded in [RESEARCH.md](RESEARCH.md).
