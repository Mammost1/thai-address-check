# Changelog

All notable changes to `thai-address-check`. Versions follow [semver](https://semver.org/).
บันทึกการเปลี่ยนแปลงของ `thai-address-check` (ไทยก่อน อังกฤษตามหลัง)

## 0.1.2 — 2026-11-25

Hardening release: every problem found by a tester who used the published 0.1.1 like a stranger would.
รุ่นปรับปรุงความน่าเชื่อถือ แก้ทุกปัญหาที่ผู้ทดสอบพบจากการใช้แพ็กเกจที่เผยแพร่แล้ว

### Fixed / แก้ไข

- **Wrong auto-correction (T1).** A name one character from two real names was rewritten to whichever scored higher
  (ท่าวัก became ท่าซัก although ท่าวัง is as close). A correction now also needs the best candidate to be at least 0.15
  ahead of the runner-up; otherwise both are suggestions and the finding carries `closeRunnerUp`. On every one-character typo
  (delete, swap, substitute) of the 7,436 subdistrict names, wrong corrections went from 9 to 2 and 0.5% of the right ones became
  suggestions; the 2 left have a unique closest real name that is not the intended one. The benchmark's "correctly fixed" falls by
  0.3 to 1.4 points per misspelling class, "wrongly fixed" stays 0.0 (amendment A12 in `docs/TASKS.md`).
- **`require('thai-address-check')` failed** with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the exports map now has a `default` condition (T2).
- **A long text cell stalled the checker** (about 0.27 ms per character, 28 s for 100,000 characters). Text over 64 characters is not
  fuzzy-matched and is answered at once as an unknown name, with a short message (T10).
- **Files:** rows made only of delimiters (`,,,`) are skipped and counted, no longer counted as invalid rows (T4); a wrong `--delimiter` stops with
  the likely delimiter named instead of reporting 100% invalid (T5); a title row above the header gets a message saying the header must be the first
  row (T3); `--out` into a missing directory says the output cannot be written, not "File not found" (T6); formatting cleanups are shown on their
  own summary line, not as a "finding" (T8).
- `check(undefined)`, `check(null)` and `check('text')` throw a clear `TypeError` (T11).
- README: removed "Not on npm yet" from the English section; states the real limits (header first row, `.xlsx` read whole and `.xls` unsupported,
  bundle size and the command that measures it, the web page reads CSV only and its download has different columns); competitor column re-run and
  worded as re-run (R1, R2, R3, W1, W2, T9).

### Added / เพิ่ม

- `thai-address-check --version`; `--delimiter tab` (T7).
- Web page: an end-to-end test suite under jsdom (single address, CSV upload as UTF-8, `;`, tab and TIS-620, check, download, title-row file,
  empty file, 3,000 rows); CI checks `require()` and `import()` of the built package on Node 22.12 and 22.x.

## 0.1.1 — 2026-11-25

### Fixed / แก้ไข

- **False `POSTAL_CODE_MISMATCH` for an abolished subdistrict.** A row that names an abolished
  subdistrict under its old district, for example `บางนา` / `บางนา` / `กรุงเทพมหานคร` / `10260`, was
  reported `invalid` with a postal-code mismatch, although `10260` is the code of both successors
  (บางนาเหนือ and บางนาใต้) and people still write it. The postal code is now compared with the
  postal codes of the successors that match the given parents: a match raises no mismatch and the row
  is `ambiguous` between the successors (the `ABOLISHED_AREA` finding is unchanged); a code that no
  successor uses is reported with the successors' codes as the expected ones, never with a code from
  another province.
  แถวที่ใช้ชื่อตำบลที่ถูกยุบ เช่น บางนา / เขตบางนา / กรุงเทพ / 10260 เคยถูกรายงานว่ารหัสไปรษณีย์ไม่ตรง
  ทั้งที่ 10260 คือรหัสของตำบลที่มาแทนทั้งสอง ตอนนี้เทียบรหัสกับตำบลที่มาแทน แถวนี้จึงเป็น `ambiguous`
  (เลือกระหว่างบางนาเหนือกับบางนาใต้) และไม่มี mismatch

### Added / เพิ่ม

- Dataset-wide regression tests (`test/postal-guard.test.ts`): for every abolished subdistrict that has
  successors, the row people write (old name, its district, province, a successor's postal code) never
  gets `POSTAL_CODE_MISMATCH`, and every current subdistrict with each of its own postal codes is valid.

The benchmark (`npm run bench`, seed 20261125) gives the same counts and digest as before the fix:
the fix changes no benchmark class.
ตัวเลข benchmark เท่าเดิมทุกคลาส (digest เดิม)

- The same change removes a false province-level mismatch for an abolished district named with its
  old province, for example `หนองเข็ง` / `บึงกาฬ` / `หนองคาย` / `38000`.

## 0.1.0 — 2026-11-25

Initial public release / ปล่อยรุ่นแรก

- Library: `check()`, `checkMany()` and `normalize()`. Every finding has a stable code, the fields
  involved, a Thai and an English message and the evidence; several problems of one address are
  reported together. A value is corrected only when the evidence is strong (confidence at or above the
  threshold and exactly one candidate); everything else is a suggestion or `ambiguous`.
- Checks the four fields against `@geothai/core`: unknown names, subdistrict outside its district or
  province, postal code that does not fit, fills a missing field when exactly one address fits,
  recognises misspelled names, and abolished areas with their successors and the evidence behind them.
- Command line: `thai-address-check <file.csv|file.xlsx>` checks a whole file (streamed for CSV), writes
  the checked file and a summary, and exits non-zero over `--fail-over`.
- Browser playground that processes everything locally.
- Reproducible accuracy benchmark (`npm run bench`) with labelled injected errors.
