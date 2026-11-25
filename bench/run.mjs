/**
 * Accuracy and speed benchmark (feature 10a). Run with `npm run bench` (builds first).
 *
 * Method: sample current addresses from @geothai/core with a seeded generator, inject ONE labelled
 * error into each, run the shipped build's `check()`, and compare the outcome with the known truth.
 * A clean set measures false alarms. Everything except the timings is deterministic: the same
 * seed, sample size, package version and data version always give the same counts (see `digest`).
 *
 *   BENCH_SEED=<int>   default 20261125
 *   BENCH_N=<int>      rows per error class, default 300
 *   BENCH_CLEAN=<int>  rows in the clean set, default 1500
 *
 * Outcome of one run, judged against the truth (`truthCode` = the original subdistrict code):
 *   correct  status is valid/corrected AND resolved.subdistrictCode is the truth
 *   wrong    status is valid/corrected AND resolved is anything else (a wrong "fix")
 *   unfixed  status is invalid/ambiguous (reported only)
 * "detected" is class specific: the finding code(s) listed for the class appeared (any severity).
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as core from '@geothai/core'
import { abolishedAreas } from '@geothai/core/abolished'
import { check } from '../dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const SEED = Number(process.env.BENCH_SEED ?? 20261125)
const N = Number(process.env.BENCH_N ?? 300)
const CLEAN_N = Number(process.env.BENCH_CLEAN ?? 1500)
if (![SEED, N, CLEAN_N].every((v) => Number.isInteger(v) && v >= 0)) throw new Error('BENCH_* must be whole numbers')

// ---------- seeded randomness ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(SEED)
const pick = (list) => list[Math.floor(rand() * list.length)]
function shuffled(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- dataset ----------
const provinces = core.provinces()
const districts = provinces.flatMap((p) => core.districts(p.code))
const subdistricts = districts.flatMap((d) => core.subdistricts(d.code))
const provinceByCode = new Map(provinces.map((p) => [p.code, p]))
const districtByCode = new Map(districts.map((d) => [d.code, d]))
const postalInUse = [...new Set(subdistricts.flatMap((s) => s.postal_codes))].sort()
const subNames = new Set(subdistricts.map((s) => s.name_th))
const abolished = abolishedAreas()
const abolishedNames = new Set(abolished.map((a) => a.name_th))

/** The full, correct address of a subdistrict as a caller would type it. */
function fullAddress(s, postalCode = s.postal_codes[0]) {
  return {
    province: provinceByCode.get(s.province_code).name_th,
    district: districtByCode.get(s.district_code).name_th,
    subdistrict: s.name_th,
    postalCode,
  }
}

// ---------- Thai-aware injections ----------
const TONES = /[่-๋]/u
const MARKS_VOWELS = /[ัิ-ฺ็ะาำเ-ไ์]/u
const CONFUSIONS = [['ร', 'ล'], ['ล', 'ร'], ['ใ', 'ไ'], ['ไ', 'ใ'], ['ณ', 'น'], ['น', 'ณ'], ['ศ', 'ษ'], ['ษ', 'ศ'], ['ศ', 'ส'], ['ส', 'ศ'], ['ษ', 'ส'], ['ส', 'ษ']]
const KEY_ROWS = ['ๅ/-ภถุึคตจขช', 'ๆไำพะัีรนยบล', 'ฟหกดเ้่าสวง', 'ผปแอิืทมใฝ']
const CONSONANT = /[ก-ฮ]/u

function chars(name) {
  return [...name]
}
const drop = (cs, i) => cs.filter((_, k) => k !== i).join('')

/** Misspelling generators: return a changed name or undefined when the class cannot apply. */
const MISSPELL = {
  'drop-tone-or-vowel': (name) => {
    const cs = chars(name)
    const at = cs.map((c, i) => (TONES.test(c) || MARKS_VOWELS.test(c) ? i : -1)).filter((i) => i >= 0)
    return at.length ? drop(cs, pick(at)) : undefined
  },
  'confusable-letter': (name) => {
    const cs = chars(name)
    const at = []
    cs.forEach((c, i) => CONFUSIONS.forEach(([from, to], k) => c === from && at.push([i, k])))
    if (!at.length) return undefined
    const [i, k] = pick(at)
    const out = [...cs]
    out[i] = CONFUSIONS[k][1]
    return out.join('')
  },
  transposition: (name) => {
    const cs = chars(name)
    const at = []
    for (let i = 0; i + 1 < cs.length; i++) if (CONSONANT.test(cs[i]) && CONSONANT.test(cs[i + 1]) && cs[i] !== cs[i + 1]) at.push(i)
    if (!at.length) return undefined
    const i = pick(at)
    const out = [...cs]
    ;[out[i], out[i + 1]] = [out[i + 1], out[i]]
    return out.join('')
  },
  'keyboard-neighbour': (name) => {
    const cs = chars(name)
    const at = []
    cs.forEach((c, i) => {
      for (const row of KEY_ROWS) {
        const p = row.indexOf(c)
        if (p >= 0) at.push([i, p > 0 ? row[p - 1] : row[p + 1]], ...(p > 0 && p + 1 < row.length ? [[i, row[p + 1]]] : []))
      }
    })
    if (!at.length) return undefined
    const [i, to] = pick(at)
    const out = [...cs]
    out[i] = to
    return out.join('')
  },
  'delete-consonant': (name) => {
    const cs = chars(name)
    const at = cs.map((c, i) => (CONSONANT.test(c) ? i : -1)).filter((i) => i >= 0)
    return cs.length >= 4 && at.length ? drop(cs, pick(at)) : undefined
  },
}

function misspelled(name, kind) {
  for (let tries = 0; tries < 30; tries++) {
    const out = MISSPELL[kind](name)
    // Not an error unless the result is no real name at all (current or abolished).
    if (out && out !== name && !subNames.has(out) && !abolishedNames.has(out)) return out
  }
  return undefined
}

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'
/** Formatting-only damage: 1 to 3 rules, meaning never changes. */
function messy(addr, isBangkok) {
  const out = { ...addr }
  const rules = shuffled([
    () => (out.subdistrict = `${pick(isBangkok ? ['แขวง', 'แขวง '] : ['ต.', 'ตำบล', 'ต. '])}${out.subdistrict}`),
    () => (out.district = `${pick(isBangkok ? ['เขต ', 'เขต'] : ['อ.', 'อำเภอ', 'อ. '])}${out.district.replace(/^เขต/u, '')}`),
    () => (out.province = isBangkok ? pick(['กทม.', 'กรุงเทพฯ', 'กรุงเทพ']) : `${pick(['จ.', 'จังหวัด', 'จ. '])}${out.province}`),
    () => (out.postalCode = [...out.postalCode].map((d) => THAI_DIGITS[Number(d)]).join('')),
    () => (out.province = `  ${out.province}   `),
    () => (out.subdistrict = out.subdistrict.replace(/^/u, ' ') + ' '),
  ])
  for (const r of rules.slice(0, 1 + Math.floor(rand() * 3))) r()
  return out
}

// ---------- classes ----------
/** @type {{id:string, title:string, ideal:'fix'|'report', detect:string[], rows:{input:object, truthCode:string|undefined, expectCode?:string}[]}[]} */
const classes = []
const sample = (n, list = subdistricts) => shuffled(list).slice(0, n)
const isBkk = (s) => s.province_code === '10'

classes.push({
  id: 'formatting',
  title: 'ฟอร์แมต (คำนำหน้า เลขไทย ช่องว่าง กทม.)',
  ideal: 'fix',
  detect: ['FORMAT_NORMALIZED'],
  rows: sample(N).map((s) => ({ input: messy(fullAddress(s), isBkk(s)), truthCode: s.code })),
})

for (const kind of Object.keys(MISSPELL)) {
  const rows = []
  for (const s of shuffled(subdistricts)) {
    if (rows.length >= N) break
    const bad = misspelled(s.name_th, kind)
    if (bad) rows.push({ input: { ...fullAddress(s), subdistrict: bad }, truthCode: s.code })
  }
  classes.push({ id: `misspell:${kind}`, title: `สะกดผิด ตำบล: ${kind} (มีช่องอื่นช่วย)`, ideal: 'fix', detect: ['MISSPELLED_NAME', 'UNKNOWN_NAME'], rows })
}

{
  const rows = []
  for (const s of shuffled(subdistricts)) {
    if (rows.length >= N) break
    const bad = misspelled(s.name_th, pick(Object.keys(MISSPELL)))
    if (bad) rows.push({ input: { subdistrict: bad }, truthCode: undefined, expectCode: s.code })
  }
  // With no other field the answer cannot be known; "ideal" is to report, and never to rewrite wrongly.
  classes.push({ id: 'misspell:alone', title: 'สะกดผิด ตำบลอย่างเดียว (ไม่มีช่องอื่น; จุดช้าสุด)', ideal: 'report', detect: ['MISSPELLED_NAME', 'UNKNOWN_NAME'], rows: rows.map((r) => ({ input: r.input, truthCode: undefined, expectCode: r.expectCode })) })
}

classes.push({
  id: 'wrong-postal-code',
  title: 'รหัสไปรษณีย์ผิด (เป็นรหัสที่มีจริงแต่ของตำบลอื่น)',
  ideal: 'report',
  detect: ['POSTAL_CODE_MISMATCH'],
  rows: sample(N).map((s) => {
    let bad
    do bad = pick(postalInUse)
    while (s.postal_codes.includes(bad))
    return { input: fullAddress(s, bad), truthCode: s.code, ideal: 'report' }
  }),
})

classes.push({
  id: 'wrong-parent',
  title: 'อำเภอผิด (อำเภอจริงแต่อยู่คนละจังหวัด)',
  ideal: 'report',
  detect: ['PARENT_MISMATCH'],
  rows: sample(N).map((s) => {
    let d
    // Skip a swap that lands on a district where this name is an abolished subdistrict: that input is
    // also a legitimate old-name address, so the injected label would be ambiguous.
    do d = pick(districts)
    while (d.province_code === s.province_code || abolished.some((a) => a.level === 'subdistrict' && a.name_th === s.name_th && a.parent_code === d.code))
    return { input: { ...fullAddress(s), district: d.name_th }, truthCode: s.code }
  }),
})

{
  // One input per (old name, old parent district). Records that share both are one claim, judged the
  // way src/abolished.ts does: when they agree on the successors the strongest basis stands, when they
  // disagree the weakest does. Labelling record by record would call a correct fix "wrong" for pairs
  // such as คลองตัน 100902 (name) + 100998 (notice) -> 103302.
  const RANK = { notice: 2, name: 1 }
  const groups = new Map()
  for (const a of abolished) {
    if (a.level !== 'subdistrict' || !districtByCode.has(a.parent_code)) continue
    const key = `${a.parent_code}|${a.name_th}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(a)
  }
  const usable = []
  for (const records of groups.values()) {
    const first = records[0]
    // A name still in use under that district is not an old name at all.
    if (subdistricts.some((s) => s.district_code === first.parent_code && s.name_th === first.name_th)) continue
    const sets = new Set(records.map((r) => [...r.successors].sort().join(',')))
    const ranks = records.map((r) => RANK[r.successors_basis] ?? 0)
    const rank = sets.size === 1 ? Math.max(...ranks) : Math.min(...ranks)
    const successors = [...new Set(records.flatMap((r) => r.successors))]
    usable.push({ first, notice: rank === 2 && successors.length === 1, successor: successors[0] })
  }
  const input = ({ first }) => {
    const d = districtByCode.get(first.parent_code)
    return { province: provinceByCode.get(d.province_code).name_th, district: d.name_th, subdistrict: first.name_th }
  }
  const fixable = usable.filter((g) => g.notice)
  const weak = usable.filter((g) => !g.notice)
  classes.push({ id: 'old-name:notice-one-successor', title: 'ชื่อเก่า มีประกาศ + ผู้สืบทอดเดียว', ideal: 'fix', detect: ['ABOLISHED_AREA'], rows: sample(N, fixable).map((g) => ({ input: input(g), truthCode: g.successor })) })
  classes.push({ id: 'old-name:weak-evidence', title: 'ชื่อเก่า หลักฐานอ่อน (name/ไม่มี หรือผู้สืบทอดหลายราย หรือหลักฐานขัดกัน)', ideal: 'report', detect: ['ABOLISHED_AREA'], rows: sample(N, weak).map((g) => ({ input: input(g), truthCode: undefined })) })
}

{
  const dupNames = new Set()
  const seen = new Set()
  for (const s of subdistricts) (seen.has(s.name_th) ? dupNames : seen).add(s.name_th)
  const build = (s, wantSeveral = false) => {
    const full = fullAddress(s)
    const drops = pick(wantSeveral ? [['province', 'district'], ['district'], ['province', 'district', 'postalCode']] : [['district'], ['province'], ['postalCode'], ['province', 'district'], ['province', 'postalCode'], ['district', 'postalCode']])
    const input = { ...full }
    for (const f of drops) delete input[f]
    const fits = subdistricts.filter(
      (t) =>
        t.name_th === s.name_th &&
        (!input.district || districtByCode.get(t.district_code).name_th === input.district) &&
        (!input.province || provinceByCode.get(t.province_code).name_th === input.province) &&
        (!input.postalCode || t.postal_codes.includes(input.postalCode)),
    ).length
    return { input, fits, truthCode: s.code }
  }
  const unique = []
  const several = []
  for (const s of shuffled(subdistricts)) {
    if (unique.length >= N) break
    const r = build(s)
    if (r.fits === 1) unique.push({ input: r.input, truthCode: r.truthCode })
  }
  for (const s of shuffled(subdistricts.filter((t) => dupNames.has(t.name_th)))) {
    if (several.length >= N) break
    const r = build(s, true)
    if (r.fits > 1) several.push({ input: r.input, truthCode: undefined })
  }
  classes.push({ id: 'missing-field:one-answer', title: 'ช่องขาด มีคำตอบเดียว (ควรเติมได้)', ideal: 'fix', detect: ['MISSING_FIELD'], rows: unique })
  classes.push({ id: 'missing-field:several-answers', title: 'ช่องขาด มีหลายคำตอบ (ควรรายงาน ambiguous)', ideal: 'report', detect: ['MISSING_FIELD', 'AMBIGUOUS'], rows: several })
}

// ---------- run ----------
function outcome(result, truthCode) {
  const fixed = result.status === 'valid' || result.status === 'corrected'
  if (!fixed) return 'unfixed'
  return truthCode !== undefined && result.resolved?.subdistrictCode === truthCode ? 'correct' : 'wrong'
}

function runRows(rows, detect) {
  const t = { n: rows.length, detected: 0, correct: 0, wrong: 0, unfixed: 0, ms: 0, maxMs: 0 }
  const statuses = {}
  for (const row of rows) {
    const t0 = performance.now()
    const result = check(row.input)
    const dt = performance.now() - t0
    t.ms += dt
    t.maxMs = Math.max(t.maxMs, dt)
    if (detect ? result.findings.some((f) => detect.includes(f.code)) : result.findings.some((f) => f.severity !== 'info')) t.detected++
    t[outcome(result, row.truthCode)]++
    statuses[result.status] = (statuses[result.status] ?? 0) + 1
  }
  return { ...t, statuses }
}

// Warm the indexes so the first class does not carry the one-time build cost.
for (let i = 0; i < 200; i++) check(fullAddress(subdistricts[i * 37 % subdistricts.length]))

const pct = (a, b) => (b === 0 ? null : Math.round((1000 * a) / b) / 10)
const results = []
for (const c of classes) {
  const r = runRows(c.rows, c.detect)
  results.push({ id: c.id, title: c.title, ideal: c.ideal, detectCodes: c.detect, ...r })
}

// Clean set: valid addresses must stay untouched and raise nothing above info.
const cleanRows = sample(CLEAN_N).map((s) => ({ input: fullAddress(s), truthCode: s.code }))
// `wrongResolution`: valid/corrected but resolved to another address. `cosmetic`: output text differs
// from the input only in how the official name is written.
const clean = { n: cleanRows.length, falseAlarms: 0, wrongResolution: 0, cosmetic: 0, ms: 0 }
for (const row of cleanRows) {
  const t0 = performance.now()
  const res = check(row.input)
  clean.ms += performance.now() - t0
  if (res.status !== 'valid' || res.findings.some((f) => f.severity !== 'info')) clean.falseAlarms++
  if ((res.status === 'valid' || res.status === 'corrected') && res.resolved?.subdistrictCode !== row.truthCode) clean.wrongResolution++
  if (['province', 'district', 'subdistrict', 'postalCode'].some((f) => res.output[f] !== row.input[f])) clean.cosmetic++
}

// ---------- report ----------
const totalChecks = results.reduce((a, r) => a + r.n, 0) + clean.n
const totalMs = results.reduce((a, r) => a + r.ms, 0) + clean.ms
const deterministic = {
  seed: SEED,
  rowsPerClass: N,
  cleanRows: CLEAN_N,
  dataVersion: core.dataVersion,
  classes: results.map(({ id, n, detected, correct, wrong, unfixed, statuses }) => ({ id, n, detected, correct, wrong, unfixed, statuses })),
  clean: { n: clean.n, falseAlarms: clean.falseAlarms, wrongResolution: clean.wrongResolution, cosmetic: clean.cosmetic },
}
const digest = createHash('sha256').update(JSON.stringify(deterministic)).digest('hex').slice(0, 16)
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

const out = {
  meta: {
    package: `${pkg.name}@${pkg.version}`,
    geothaiCore: pkg.dependencies['@geothai/core'],
    dataVersion: core.dataVersion,
    seed: SEED,
    rowsPerClass: N,
    cleanRows: CLEAN_N,
    digest,
    command: 'npm run bench',
  },
  deterministic,
  timing: {
    note: 'machine dependent; every other number is reproducible and covered by meta.digest',
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    totalChecks,
    meanMsPerCheck: Math.round((1000 * totalMs) / totalChecks) / 1000,
    cleanMeanMs: Math.round((1000 * clean.ms) / Math.max(1, clean.n)) / 1000,
    perClass: Object.fromEntries(results.map((r) => [r.id, { meanMs: Math.round((1000 * r.ms) / Math.max(1, r.n)) / 1000, maxMs: Math.round(r.maxMs * 100) / 100 }])),
  },
  percentages: Object.fromEntries(results.map((r) => [r.id, { detectedPct: pct(r.detected, r.n), correctlyFixedPct: pct(r.correct, r.n), wronglyFixedPct: pct(r.wrong, r.n), reportedOnlyPct: pct(r.unfixed, r.n) }])),
}
writeFileSync(join(here, 'results.json'), `${JSON.stringify(out, null, 2)}\n`)

const f = (v) => (v === null ? '-' : v.toFixed(1))
const lines = [
  `thai-address-check bench · data ${core.dataVersion} · seed ${SEED} · ${N} rows/class · digest ${digest}`,
  '',
  '| class | rows | ideal | detected % | correctly fixed % | wrongly fixed % | reported only % | mean ms |',
  '|---|---:|---|---:|---:|---:|---:|---:|',
  ...results.map((r) => `| ${r.id} | ${r.n} | ${r.ideal} | ${f(pct(r.detected, r.n))} | ${f(pct(r.correct, r.n))} | ${f(pct(r.wrong, r.n))} | ${f(pct(r.unfixed, r.n))} | ${(r.ms / Math.max(1, r.n)).toFixed(3)} |`),
  `| clean (no error) | ${clean.n} | stay valid | false alarms ${f(pct(clean.falseAlarms, clean.n))} | - | wrong resolution ${f(pct(clean.wrongResolution, clean.n))} | - | ${(clean.ms / Math.max(1, clean.n)).toFixed(3)} |`,
  '',
  `clean set: ${clean.cosmetic} of ${clean.n} outputs differ from the input only in cosmetics; ${clean.wrongResolution} resolved to a different address`,
  `overall mean ${out.timing.meanMsPerCheck} ms/check over ${totalChecks} checks (${out.timing.cpu}, node ${process.version}); machine dependent`,
  'ideal=fix: a correct rewrite is the goal. ideal=report: the evidence is not strong enough to rewrite, so "wrongly fixed" must stay 0 and findings must be raised.',
]
console.log(lines.join('\n'))
