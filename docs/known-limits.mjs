#!/usr/bin/env node
/**
 * Counts, on the BUILT package, the subdistrict names that a name-only check does not resolve because the
 * same name also belonged to an abolished area elsewhere (tac-night F10, rule A), and writes the two
 * README sentences that state it, so the number is never typed by hand.
 *
 *   npm run build && node docs/known-limits.mjs          print the counts
 *   npm run build && node docs/known-limits.mjs --write  replace the blocks between the homonyms markers
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { check, dataVersion, listAddresses } = await import(join(root, 'dist', 'index.js'))

const names = [...new Set(listAddresses().map((r) => r.subdistrictNameTh))]
const withheld = names.filter((name) =>
  check({ subdistrict: name }).findings.some((f) => f.code === 'ABOLISHED_AREA' && f.detail.unanchored === true),
)
const n = withheld.length.toLocaleString('en-US')
const total = names.length.toLocaleString('en-US')

export const TH = `- **ชื่อตำบลอย่างเดียว (ไม่มีจังหวัดหรืออำเภอ):** ${n} จาก ${total} ชื่อตำบล (ข้อมูลรุ่น \`${dataVersion}\`) เคยเป็นชื่อของพื้นที่ที่ถูกยุบในที่อื่นด้วย จึงได้ \`ambiguous\` และไม่เติมจังหวัด/อำเภอให้ (เช่น "บางนา" ไม่ถูกเติมเป็นพระนครศรีอยุธยา) บางชื่อเป็นที่เดียวกันก่อนแยกจังหวัด (เช่น ศาลาลำดวน) แต่ข้อมูลไม่ได้เชื่อมไว้จึงบอกไม่ได้ ใส่จังหวัด อำเภอ หรือรหัสไปรษณีย์ที่ตรงกันเพื่อให้ตรวจได้ (นับด้วย \`node docs/known-limits.mjs\`)`
export const EN = `- **Subdistrict name alone (no province or district):** ${n} of ${total} subdistrict names (data \`${dataVersion}\`) also named an abolished area elsewhere, so they come back \`ambiguous\` and nothing is filled (\`บางนา\` is not filled as Phra Nakhon Si Ayutthaya). Some are the same place before a province split (\`ศาลาลำดวน\`), which the data does not link, so it cannot tell. Give the province, the district or a postal code that matches. (Counted by \`node docs/known-limits.mjs\`.)`

if (process.argv.includes('--write')) {
  const path = join(root, 'README.md')
  let readme = readFileSync(path, 'utf8')
  for (const [tag, text] of [['homonyms-th', TH], ['homonyms-en', EN]]) {
    const re = new RegExp(`<!-- ${tag}:start -->[\\s\\S]*?<!-- ${tag}:end -->`)
    if (!re.test(readme)) throw new Error(`README.md has no ${tag} markers`)
    readme = readme.replace(re, `<!-- ${tag}:start -->\n${text}\n<!-- ${tag}:end -->`)
  }
  writeFileSync(path, readme)
  console.log('README.md updated')
} else {
  console.log(`${withheld.length} of ${names.length} names withheld (data ${dataVersion})`)
}
