#!/usr/bin/env node
/**
 * Renders the README benchmark table from bench/results.json, so no number in the README is typed by hand.
 *
 *   node docs/bench-table.mjs          print the table
 *   node docs/bench-table.mjs --write  replace the block between the bench markers in README.md
 *
 * To regenerate the source numbers first: `npm run bench` (builds, then writes bench/results.json).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const results = JSON.parse(readFileSync(join(root, 'bench', 'results.json'), 'utf8'))

/** Reader-facing names for the injected error classes in bench/run.mjs (unknown ids are printed as they are). */
const LABELS = {
  'formatting': 'Formatting only (ต./อ./จ., Thai digits, กทม.)',
  'misspell:drop-tone-or-vowel': 'Misspelling: dropped tone mark or vowel',
  'misspell:confusable-letter': 'Misspelling: look-alike letter',
  'misspell:transposition': 'Misspelling: swapped letters',
  'misspell:keyboard-neighbour': 'Misspelling: neighbouring key',
  'misspell:delete-consonant': 'Misspelling: deleted consonant',
  'misspell:alone': 'Misspelled name with no other help',
  'wrong-postal-code': 'Wrong postal code',
  'wrong-parent': 'Subdistrict under the wrong district',
  'old-name:notice-one-successor': 'Abolished name, official notice, one successor',
  'old-name:weak-evidence': 'Abolished name, weak evidence (must not be auto-fixed)',
  'missing-field:one-answer': 'Missing fields, exactly one answer',
  'missing-field:several-answers': 'Missing fields, several answers (must stay ambiguous)',
}

const pct = (part, whole) => (whole === 0 ? '0.0' : ((part / whole) * 100).toFixed(1))
const { meta, deterministic: det } = results

const lines = []
lines.push('| Error injected | Rows | Detected % | Fixed correctly % | Fixed wrongly % | Reported only % |')
lines.push('|---|---:|---:|---:|---:|---:|')
for (const c of det.classes) {
  lines.push(`| ${LABELS[c.id] ?? c.id} | ${c.n} | ${pct(c.detected, c.n)} | ${pct(c.correct, c.n)} | ${pct(c.wrong, c.n)} | ${pct(c.unfixed, c.n)} |`)
}
const clean = det.clean
lines.push('')
lines.push(
  `Clean set (${clean.n} correct addresses): ${clean.falseAlarms} false alarms, ${clean.wrongResolution} resolved to a different address, ` +
    `${clean.cosmetic} came back with the same address written differently (output text not equal to the input).`,
)
lines.push('')
lines.push(
  `Reproduce: \`${meta.command}\` · seed ${meta.seed} · ${meta.rowsPerClass} rows per class · ${meta.cleanRows} clean rows · ` +
    `\`@geothai/core\` ${meta.geothaiCore} (data ${meta.dataVersion}) · result digest \`${meta.digest}\`. ` +
    `Counts are deterministic for a given seed and data version. Timings are deliberately not printed here: they depend on the machine, so run \`${meta.command}\` to measure your own.`,
)
const table = lines.join('\n')

if (process.argv.includes('--write')) {
  const readmePath = join(root, 'README.md')
  const readme = readFileSync(readmePath, 'utf8')
  const start = '<!-- bench:start -->'
  const end = '<!-- bench:end -->'
  const a = readme.indexOf(start)
  const b = readme.indexOf(end)
  if (a === -1 || b === -1 || b < a) throw new Error(`README.md needs ${start} and ${end} markers`)
  writeFileSync(readmePath, `${readme.slice(0, a + start.length)}\n\n${table}\n\n${readme.slice(b)}`)
  console.log('README.md updated')
} else {
  console.log(table)
}
