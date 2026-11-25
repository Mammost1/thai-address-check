# Changelog

All notable changes to `thai-address-check`. Versions follow [semver](https://semver.org/).
บันทึกการเปลี่ยนแปลงของ `thai-address-check` (ไทยก่อน อังกฤษตามหลัง)

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
