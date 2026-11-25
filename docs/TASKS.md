# thai-address-check — implementation plan

Product plan (Thai): `PLAN.md` at the repo root. Read it first; this file is the
engineering contract.

## Repo

This repository.

## Global constraints (every task inherits these)

1. Work only inside this repo and only inside your task's boundary paths.
2. Local commits ARE allowed here, on branch `main`, small and focused, conventional-commit
   subjects (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). The repo-local git identity is already
   set to the maintainer's personal identity; do not change it and do not pass `--author`.
3. NEVER `git push`, never add a remote, never `npm publish`, never create a GitHub repo. Going
   public is the maintainer's own action.
4. Never use private code, private data or real customer addresses to build or test this project.
5. Data facts come from the installed `@geothai/core` package, never from memory. If the package
   behaves differently from what this plan says, stop and open an issue.
6. Runtime dependency budget for the library: `@geothai/core` only. Dev dependencies are free.
   The file/CLI layer may add at most one CSV parser and one XLSX reader, justified in the README.
7. Out of scope, do not build: free-text address parsing (splitting one string into parts),
   house number / road / soi / village level, coordinates, a server.
8. TypeScript strict, ESM, Node >= 22.12. No `any` in exported types. Every exported function has
   a doc comment and tests. Tests use vitest. Thai strings in tests are real area names taken
   from the dataset.
9. Never auto-correct on weak evidence: a correction is applied only when confidence >= the
   caller's threshold (default 0.9) AND exactly one candidate qualifies. Everything else is
   reported as a suggestion or as `ambiguous`.
10. Every finding carries: a stable machine code, the field(s) involved, a Thai and an English
    message, and enough data to explain itself. No finding without an explanation.
11. Gates for every task: `npm run typecheck && npm test && npm run build` exit 0. Report READY
    with a task note naming the commit SHA.
12. Numbers quoted in README/docs must come from a command a reader can re-run; name the command.

## Public API contract (settled; changes need a ruling)

```ts
export type Field = 'province' | 'district' | 'subdistrict' | 'postalCode'

export interface AddressInput {
  province?: string
  district?: string
  subdistrict?: string
  postalCode?: string
}

/** Input after formatting-only cleanup. No meaning is changed at this stage. */
export interface NormalizedAddress extends AddressInput {
  /** Per field: which formatting rules fired, e.g. 'strip-prefix', 'thai-digits', 'whitespace'. */
  applied: Partial<Record<Field, string[]>>
}

export interface ResolvedAddress {
  provinceCode: string
  districtCode: string
  subdistrictCode: string
  province: { th: string; en: string }
  district: { th: string; en: string }
  subdistrict: { th: string; en: string }
  postalCodes: string[]
}

export type FindingCode =
  | 'MISSING_FIELD'            // a field needed to decide is absent
  | 'UNKNOWN_NAME'             // no current area has this name at this level
  | 'MISSPELLED_NAME'          // close to exactly one known name
  | 'PARENT_MISMATCH'          // child exists but not under the given parent
  | 'POSTAL_CODE_MISMATCH'     // postal code not used by the resolved subdistrict
  | 'POSTAL_CODE_INVALID'      // not 5 digits / not in use anywhere
  | 'ABOLISHED_AREA'           // name/code belongs to an abolished area
  | 'AMBIGUOUS'                // more than one address fits; another field is needed
  | 'FORMAT_NORMALIZED'        // informational: formatting was cleaned

export type Severity = 'error' | 'warning' | 'info'

export interface Finding {
  code: FindingCode
  severity: Severity
  fields: Field[]
  message: { th: string; en: string }
  /** Structured evidence, e.g. { given: '58130', expected: ['50250'] }. */
  detail: Record<string, unknown>
}

export interface Suggestion {
  field: Field
  from: string | undefined
  to: string
  confidence: number            // 0..1
  reason: FindingCode
  resolved?: ResolvedAddress
}

export type Status = 'valid' | 'corrected' | 'ambiguous' | 'invalid'

export interface CheckOptions {
  /** Minimum confidence to apply a correction automatically. Default 0.9. */
  autoCorrectThreshold?: number
  /** When false, never change values; only report. Default true. */
  autoCorrect?: boolean
  /** Max suggestions returned per field. Default 3. */
  maxSuggestions?: number
}

export interface CheckResult {
  status: Status
  input: AddressInput
  normalized: NormalizedAddress
  /** Present when status is 'valid' or 'corrected'. */
  resolved?: ResolvedAddress
  /** The address after applied corrections; equals normalized input when nothing was applied. */
  output: AddressInput
  findings: Finding[]
  suggestions: Suggestion[]
  dataVersion: string           // from @geothai/core
}

export function normalize(input: AddressInput): NormalizedAddress
export function check(input: AddressInput, options?: CheckOptions): CheckResult
export function checkMany(inputs: Iterable<AddressInput>, options?: CheckOptions): Generator<CheckResult>
```

Status rules: `valid` = resolves to exactly one address with no error findings. `corrected` =
became valid after auto-corrections (each listed as a Suggestion that was applied and as a
Finding). `ambiguous` = several addresses fit. `invalid` = nothing fits or an error remains.

## Module layout and ownership

```
src/types.ts            contract above (task tac-scaffold owns; others import, never edit)
src/data.ts             the ONLY module importing @geothai/core; exposes indexes others need
src/normalize.ts        formatting cleanup
src/validate.ts         resolution + consistency findings (+ fill-missing)
src/fuzzy.ts            Thai-aware similarity
src/suggest.ts          ranked suggestions + auto-correct decision
src/abolished.ts        old names / abolished areas
src/check.ts            orchestrates the above into check()/checkMany()
src/index.ts            public exports
test/                   mirrors src/
bench/                  accuracy benchmark
src/file/ , src/cli.ts  batch file checking and CLI
web/                    browser playground
```

`src/check.ts` is the integration seam. tac-scaffold creates it calling stub modules that return
empty findings; each later task replaces its own module only, and adds its call in `check.ts`
ONLY inside the block marked for it (`// <validate>`, `// <fuzzy+suggest>`, `// <abolished>`).

## Task table

| slug | tier | role | deps | boundary | acceptance |
|---|---|---|---|---|---|
| tac-recon | standard | research | — | docs/recon.md | answers the 3 questions below with evidence; verdict GO or STOP |
| tac-scaffold | standard | implementer | tac-recon (GO) | package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, .gitignore, LICENSE, src/types.ts, src/data.ts, src/normalize.ts, src/check.ts, src/index.ts, src/validate.ts, src/fuzzy.ts, src/suggest.ts, src/abolished.ts, test/normalize.test.ts, test/data.test.ts | gates green; normalize fully implemented + tested; other modules are typed stubs |
| tac-validate | complex | implementer | tac-scaffold | src/validate.ts, test/validate.test.ts, src/check.ts (its block) | gates green; features 1 and 6 |
| tac-fuzzy-suggest | complex | implementer | tac-scaffold | src/fuzzy.ts, src/suggest.ts, test/fuzzy.test.ts, test/suggest.test.ts, src/check.ts (its block) | gates green; features 2 and 3 |
| tac-abolished | standard | implementer | tac-scaffold | src/abolished.ts, test/abolished.test.ts, src/check.ts (its block) | gates green; feature 5 |
| tac-bench | standard | implementer | tac-validate, tac-fuzzy-suggest, tac-abolished | bench/**, package.json (scripts only) | `npm run bench` prints the metrics table |
| tac-file-cli | standard | implementer | tac-bench | src/file/**, src/cli.ts, test/file/**, test/cli.test.ts, package.json (bin, deps) | gates green; 100,000-row sample checked with flat memory |
| tac-web | standard | design | tac-bench | web/** | `npm --prefix web run build` exits 0; all processing in the browser |
| tac-docs-ci | routine | implementer | tac-file-cli, tac-web | README.md, .github/workflows/**, docs/** except recon.md | CI config valid; README numbers reproducible |

`review: complex` for tac-validate and tac-fuzzy-suggest. `src/check.ts` is shared by three
tasks: their merges are serialised; nobody edits outside their marked block.

## Task details

### tac-recon
Answer with evidence (URLs fetched, commands run in a scratch dir, outputs quoted):
1. Do `thai-address-database`, `thai-data`, `thai-address-universal`, or any other npm/PyPI
   package already provide per-field diagnosis, correction suggestions, fuzzy Thai matching, or
   batch CSV checking? (The npmjs.com pages returned 403 to a previous fetch; use the registry
   JSON `https://registry.npmjs.org/<name>` and the repositories instead.)
2. Install `@geothai/core` in a scratch directory and verify the real API: exact signatures of
   `byPostalCode`, `search`, `match`, `address`, `abolishedAreas`, `matchAbolished`; the field
   name `match` uses for postal code; the shape of a subdistrict record; `dataVersion`; counts of
   provinces/districts/subdistricts/abolished; how many subdistrict names repeat; package size.
3. Licence obligations of using its data (CC BY 4.0) inside an MIT package: what attribution
   text and where.
Verdict: GO if nobody ships the diagnosis+correction layer; STOP otherwise.
Write the verified API into docs/recon.md — later tasks code against that file.

### tac-scaffold
Set up the package (name `thai-address-check`, version 0.0.0, MIT, `type: module`, exports map,
`engines.node >=22.12`). `src/data.ts` builds and caches the lookup indexes other modules need
(by normalised Thai name, by English name, by postal code, children of a parent) from
`@geothai/core`, using the API verified in docs/recon.md. Implement `normalize()` completely
(feature 4): trim and collapse whitespace; Thai digits to Arabic; strip level prefixes
(ต., ตำบล, แขวง, อ., อำเภอ, เขต, จ., จังหวัด, and English Tambon/Amphoe/Khwaeng/Khet/Changwat,
"Sub-district", "District", "Province"); Bangkok aliases (กทม, กทม., กรุงเทพ, กรุงเทพฯ, Bangkok,
BKK) to the official name; zero-width and non-breaking characters; postal code digits only.
Record every rule that fired in `applied`. Never guess meaning here.
Edge to respect: "เมือง" districts (อ.เมือง + province) and names that legitimately begin with a
prefix-like syllable (e.g. a district whose real name starts with "เขต…"/"บาง…") — strip a
prefix only when the remainder is a known name at that level or the original is not.
Create the three marked blocks in `check.ts` and typed stubs for the other modules.

### tac-validate (features 1, 6)
Resolve the normalised address to current areas and emit findings: MISSING_FIELD, UNKNOWN_NAME,
PARENT_MISMATCH, POSTAL_CODE_INVALID, POSTAL_CODE_MISMATCH, AMBIGUOUS. Fill missing fields when
exactly one address fits the given ones (e.g. postal code + subdistrict name). Handle
subdistricts with several postal codes and postal codes shared by many subdistricts. Exact
matches only — fuzzy is not yours.

### tac-fuzzy-suggest (features 2, 3)
`fuzzy.ts`: Thai-aware similarity in [0,1]: tolerate missing/extra tone marks and vowels above
or below, common confusions (ร/ล, ใ/ไ, ณ/น, ศ/ษ/ส, ์ dropped), transposition, one-key typos;
English names case- and hyphen-insensitive. `suggest.ts`: produce ranked Suggestions using the
other fields as context (a candidate consistent with the given postal code or parent outranks a
closer string elsewhere); decide auto-correction per Global constraint 9. Emit MISSPELLED_NAME.
State the complexity; a check must stay under 5 ms on average on the bench machine.

### tac-abolished (feature 5)
Detect names/codes of abolished areas and emit ABOLISHED_AREA with the successors and the
evidence basis from the dataset. Auto-correct only when the basis is a gazette notice and there
is exactly one successor; a name-based basis is a suggestion with confidence capped below the
default threshold; no successor = report only.

### tac-bench (feature 10a)
Deterministic (seeded) generator: sample valid addresses from the dataset, inject one labelled
error each (formatting, misspelling by class, wrong postal code, wrong parent, old name, missing
field), run `check`, and report per class: detected %, correctly fixed %, wrongly "fixed" %,
plus mean time per check. Also a clean set to measure false alarms. `npm run bench` prints a
markdown table and writes `bench/results.json`.

### tac-file-cli (features 7, 8)
Streaming CSV in/out and XLSX in; column auto-detection with explicit `--map` override; output a
corrected file with added status/finding columns and a summary. CLI:
`thai-address-check <file> [--out f] [--report f.json] [--threshold n] [--no-fix] [--fail-over pct]`,
exit code non-zero when the invalid share exceeds `--fail-over`. Memory must stay flat on a
generated 100,000-row file (record peak RSS in the task note).

### tac-web (feature 9)
Vite + React single page under `web/`, importing the library source. Two modes: check one
address (four fields, live result with findings and suggestions) and drop a CSV (table of rows
with status, filter by finding, download corrected file). Everything runs client-side; state so
on the page. Thai UI with English toggle. No analytics, no network calls after load. Follow the
Design Craft rules; this is a tool, not a marketing page.

### tac-docs-ci (feature 10b)
README (Thai first, English second): what it does, install, 3 examples, finding-code table,
benchmark table copied from `bench/results.json` with the command, limits, attribution to
GeoThai per docs/recon.md, what is out of scope. GitHub Actions: CI (typecheck, test, build,
bench smoke) and a weekly workflow that checks for a newer `@geothai/core`, re-runs tests and
bench, and opens an issue with the diff when the data version changed. Workflows are written
but nothing is pushed.

## Amendments after tac-recon

Verified API and counts live in `docs/recon.md`; code against that file. Rulings:

A1. `match()` REQUIRES `subdistrict` and throws without it. Never call it without one; resolve
    subdistrict-less inputs via `byPostalCode` / `districts` / `subdistricts` (tac-validate).
A2. `match()` returns `[]` with no reason. To attribute PARENT_MISMATCH vs POSTAL_CODE_MISMATCH,
    relax one field at a time (drop postalCode, then district, then province) and see which
    relaxation produces candidates. Report ALL findings, not just the first.
A3. Core does no input cleanup: `byPostalCode` takes an exact 5-digit string (no trim, no Thai
    digits, no numbers). `normalize()` owns all of it (tac-scaffold).
A4. Bangkok district names in the data carry the prefix (`เขตพระนคร`) while subdistricts carry no
    `แขวง`. `src/data.ts` indexes every level by the name with level prefixes stripped, and keeps
    the official name for output.
A5. Abolished areas: basis `notice` (111) may auto-correct when exactly one successor; `name`
    (1,071) is suggestion-only with confidence capped below the default threshold; `null` (401)
    is report-only. Two areas have more than one successor: always `ambiguous`.
A6. Positioning: two packages partly overlap (`thai-address-universal`: per-field validation;
    `thai-address-sdk`: fuzzy normalisation that silently rewrites on weak evidence). README must
    state the difference plainly and must not claim nobody does this. tac-bench adds a
    reproducible comparison on the recon cases (`แม่แดด`+`แม่ริม`, `เกาะพะงัน`+`84360`,
    `บางนา`+`เขตบางนา`) showing we report instead of silently rewriting.
A7. Regression cases every relevant task must test: `เกาะพะงัน / สุราษฎร์ธานี / 84360` →
    POSTAL_CODE_MISMATCH with expected `84280`; `แม่แดด / แม่ริม / เชียงใหม่` → PARENT_MISMATCH
    and NOT a rewrite to another subdistrict; `บางนา / เขตบางนา / กรุงเทพ` → ABOLISHED_AREA,
    ambiguous between two successors; `กรุงเทพ` normalises to the official province name.
A8. Plan defect fixed: PLAN.md used `แม่แดด` + `58130` as an error example; in the dataset that
    pairing is correct. Replaced with the `เกาะพะงัน` + `84360` case.

A9. tac-scaffold boundary gains `test/check.test.ts`: `check()` and
    `checkMany()` are exported by the scaffold, so constraint 8 requires tests in the same task.
    Guard for later tasks: a task that exports a function owns its test file even when the task
    table forgot to list it; add the file and note it, no escalation needed.
A10. (2026-11-25) Bangkok romanised aliases accepted on input: `Krung Thep Maha Nakhon`,
    `Krung Thep`, `Bangkok Metropolis` (case and spacing insensitive) normalise like `Bangkok`.
    Output names stay the dataset's official Thai/English names.

A11. Interface between validate, suggest and abolished, binding
    on tac-validate, tac-fuzzy-suggest and tac-abolished-2:
    - validate emits UNKNOWN_NAME for a field with no current match. When suggest emits
      MISSPELLED_NAME for that same field, suggest removes that one UNKNOWN_NAME (never others).
      After any applied correction suggest recomputes `ctx.candidates`; validate does not re-run.
    - A name that exactly matches an abolished name after normalize is owned by abolished: fuzzy
      and suggest never propose for it. Regression in tac-fuzzy-suggest: บางนา / เขตบางนา /
      กรุงเทพ ends ambiguous with ABOLISHED_AREA and is not applied; same for บางบอน / เขตบางบอน.
    - Performance: the 5 ms target is the average on the bench mix. A misspelled subdistrict with
      no other field may take 9 to 15 ms because it scans all 7,436 names; accepted, and the
      README states it.

## Escalation
Contract or scope questions → an issue on the repository. A finding that the plan
contradicts the real `@geothai/core` API is the plan's defect: challenge it, do not work around.
