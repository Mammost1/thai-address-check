# thai-address-check

**ไทย** · [English](#english)

ตรวจที่อยู่ไทยทีละช่อง (จังหวัด อำเภอ ตำบล รหัสไปรษณีย์) บอกว่า **ช่องไหนผิดและทำไม** เสนอค่าที่ถูกต้อง
และ **แก้ให้เองเฉพาะเมื่อหลักฐานแน่นพอ** ใช้เป็นไลบรารี TypeScript, คำสั่งใน terminal สำหรับไฟล์ CSV/Excel
หรือหน้าเว็บที่ประมวลผลในเบราว์เซอร์ ทั้งหมดไม่ใช้ AI ไม่เรียกเซิร์ฟเวอร์ และรันในเครื่องของคุณ

> ติดตั้ง: `npm install thai-address-check` · ตรวจไฟล์: `npx thai-address-check <file>`

## ตัวอย่างที่ 1: ตรวจที่อยู่หนึ่งรายการ

```ts
import { check } from 'thai-address-check'

const r = check({
  province: 'เชียงใหม่',
  district: 'เมืองเชียงใหม่',
  subdistrict: 'ศรีภูมิ',
  postalCode: '10110', // ผิด: ตำบลนี้ใช้ 50200
})

r.status // 'invalid'
r.findings[0].code // 'POSTAL_CODE_MISMATCH'
r.findings[0].message.th // ข้อความภาษาไทย (มี message.en ให้คู่กัน)
r.suggestions[0] // { field: 'postalCode', from: '10110', to: '50200', confidence: 0.85, ... }
```

ผลที่ได้จริงจากโค้ดนี้ (รัน `node` กับ `dist/index.js` หลัง `npm run build`):
`status = invalid`, `POSTAL_CODE_MISMATCH: Postal code 10110 does not belong to subdistrict "ศรีภูมิ" (it uses 50200)`
และคำแนะนำรหัส `50200` ความมั่นใจ 0.85 ซึ่ง **ต่ำกว่าเกณฑ์แก้เอง 0.9** จึงไม่ถูกแก้ให้อัตโนมัติ แต่แจ้งให้คนตัดสิน

## ตัวอย่างที่ 2: แก้ให้เองเมื่อมั่นใจ และเติมช่องที่ขาด

```ts
check({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'ศรีภมู', postalCode: '50200' })
// status 'corrected'; subdistrict 'ศรีภมู' -> 'ศรีภูมิ' (MISSPELLED_NAME, confidence 0.914)

check({ subdistrict: 'ศรีภูมิ', postalCode: '50200' })
// status 'corrected'; เติม province 'เชียงใหม่' และ district 'เมืองเชียงใหม่' (MISSING_FIELD)
// เพราะมีที่อยู่เดียวที่เข้ากัน
```

รูปแบบการเขียนจะถูกทำให้เป็นมาตรฐานด้วย เช่น `กรุงเทพ` กลายเป็น `กรุงเทพมหานคร` (`FORMAT_NORMALIZED`
ระดับ info ความหมายไม่เปลี่ยน)

ตัวเลือกใน `check(input, options)`: `autoCorrectThreshold` (ค่าเริ่มต้น 0.9), `autoCorrect: false`
(รายงานอย่างเดียว ไม่แก้), `maxSuggestions` (ค่าเริ่มต้น 3) สำหรับข้อมูลจำนวนมากใช้ `checkMany(rows)` ซึ่งคืนค่าเป็น generator
(ตรวจทีละแถวเมื่อวนอ่าน ไม่มี `.length`) ถ้าต้องการ array ใช้ `[...checkMany(rows)]`

อำเภอที่เขียนว่า `เมือง`, `อ.เมือง`, `Mueang` หรือ `Muang` หมายถึงอำเภอเมืองของจังหวัดที่ระบุ (เช่น เชียงใหม่ + `อ.เมือง` = `เมืองเชียงใหม่`)
ผลเป็น `valid` พร้อม `FORMAT_NORMALIZED` กฎ `mueang-province` ชื่ออำเภอที่ได้เป็นภาษาเดียวกับที่เขียนในช่องอำเภอ (`เมือง` ได้ชื่อไทย, `Mueang` ได้ชื่ออังกฤษ แม้จังหวัดเขียนเป็นไทย) ถ้าไม่ระบุจังหวัดจะใช้ตำบลและรหัสไปรษณีย์ช่วยหาเมื่อเหลือที่เดียว
กรุงเทพฯ และพระนครศรีอยุธยาไม่มีอำเภอชื่อ "เมือง..." จึงไม่ขยายให้ เขตของกรุงเทพฯ เขียนได้ทั้ง `เขตพระนคร` และ `พระนคร`

รหัสไปรษณีย์อ่านได้เมื่อเป็นตัวเลข 5 หลัก (เลขไทยได้) คั่นด้วยช่องว่าง ขีด หรือจุลภาคหลักพัน (`50 200`, `50-200`, `50,200`) หรือมีทศนิยมศูนย์จากตารางคำนวณ (`50200.0`)
ค่าอื่นที่มีตัวอักษรหรือจุด (`5020.0`, `50200abc`, `TH-50200`, `ปณ.50200`) ได้ `POSTAL_CODE_INVALID` พร้อมค่าที่เขียนมา ไม่มีการเลือกเฉพาะตัวเลขออกมาใช้

## ตัวอย่างที่ 3: ตรวจทั้งไฟล์ CSV/Excel

```bash
npx thai-address-check customers.csv --out customers.checked.csv --report summary.json --fail-over 5
```

หาคอลัมน์จังหวัด/อำเภอ/ตำบล/รหัสไปรษณีย์จากหัวตารางเอง (ชื่อไทยหรืออังกฤษ) ถ้าหาไม่เจอให้ระบุเอง
เช่น `--map subdistrict=ต.,postalCode=5` ไฟล์ผลลัพธ์เป็น CSV เพิ่ม 4 คอลัมน์ `tac_status`, `tac_codes`,
`tac_message`, `tac_changes` และพิมพ์สรุปบนหน้าจอ รับ `.xlsx` เป็นข้อมูลเข้าได้ (`--sheet`)

| ตัวเลือก | ความหมาย |
|---|---|
| `--out <file>` | ไฟล์ CSV ที่เขียน (ค่าเริ่มต้น `<file>.checked.csv`) |
| `--report <file>` | เขียนสรุปเป็น JSON |
| `--threshold <0..1>` | ความมั่นใจขั้นต่ำที่จะแก้เอง (ค่าเริ่มต้น 0.9) |
| `--no-fix` | รายงานอย่างเดียว ไม่แก้เซลล์ใด |
| `--fail-over <pct>` | จบด้วยรหัส 1 เมื่อสัดส่วนแถวที่ invalid เกิน pct% (ใช้ใน CI ได้) |
| `--map <field=col>` | ระบุคอลัมน์เอง ใช้ชื่อหัวตารางหรือเลขลำดับเริ่มที่ 1 |
| `--sheet`, `--delimiter`, `--no-header`, `--no-bom`, `--quiet` | ดู `thai-address-check --help` |

รหัสออก: `0` เสร็จ · `1` สัดส่วน invalid เกิน `--fail-over` · `2` อาร์กิวเมนต์หรือไฟล์มีปัญหา
(ข้อความข้างต้นตรวจได้ด้วย `thai-address-check --help`) `thai-address-check --version` พิมพ์เลขเวอร์ชัน
`--delimiter` รับอักขระตัวเดียวหรือคำว่า `tab` ถ้าระบุผิด (เช่น ไฟล์คั่นด้วย `,` แต่ใส่ `;`) จะหยุดพร้อมบอกตัวคั่นที่น่าจะใช่
แถวที่ทุกเซลล์ว่าง (เช่น `,,,`) จะถูกข้ามและแจ้งจำนวนในสรุป ไม่นับเป็นแถวที่ผิด แถวเหล่านี้ไม่อยู่ในไฟล์ผลลัพธ์ด้วย ดังนั้นแถวที่ N ของผลลัพธ์อาจไม่ตรงกับแถวที่ N ของไฟล์ต้นฉบับ

## ตัวอย่างที่ 4: ใช้เป็นข้อมูลตั้งต้นของ database

แทนการหาไฟล์ JSON จากอินเทอร์เน็ตแล้วแก้เองทีละแถว ให้ส่งออกข้อมูลอ้างอิงชุดเดียวกับที่ใช้ตรวจ:

```bash
npx thai-address-check export > addresses.csv                     # CSV (ค่าเริ่มต้น) ออกทาง stdout
npx thai-address-check export --format json --out addresses.json  # หรือ JSON ลงไฟล์
```

ในโค้ด: `import { listAddresses, dataVersion } from 'thai-address-check'` ได้ข้อมูลชุดเดียวกันเป็น array

- **หนึ่งแถวต่อ (ตำบล, รหัสไปรษณีย์)** คอลัมน์: `province_code`, `province_name_th`, `province_name_en`, `district_code`,
  `district_name_th`, `district_name_en`, `subdistrict_code`, `subdistrict_name_th`, `subdistrict_name_en`, `postal_code`
  (JSON ใช้ชื่อแบบ camelCase เช่น `provinceCode`) เรียงตามรหัสตำบลแล้วตามรหัสไปรษณีย์ ทุกค่าเป็นข้อความ
- ข้อมูลรุ่น `2026.10.23` (`@geothai/core` 5.0.0): 7,600 แถว, 7,436 ตำบล, 928 อำเภอ/เขต, 77 จังหวัด
- ตำบลหนึ่งมีรหัสไปรษณีย์ได้มากกว่าหนึ่งรหัส (160 ตำบลในรุ่นนี้) ดังนั้น key ของตารางคือ `subdistrict_code` + `postal_code`
  ไม่ใช่ `subdistrict_code` อย่างเดียว
- ชื่อเป็นชื่อตามชุดข้อมูลโดยไม่ดัดแปลง: เขตของกรุงเทพฯ มีคำว่า "เขต" นำหน้า (เช่น `เขตพระนคร`) เวลาตรวจที่อยู่ รับได้ทั้ง
  `เขตพระนคร` และ `พระนคร` และไม่เปลี่ยนค่าที่ส่งมา
- อัปเดตตารางเมื่อขึ้นเวอร์ชัน: โหลดไฟล์ใหม่เข้าตารางพัก แล้ว upsert ด้วย key `subdistrict_code` + `postal_code` (เพิ่ม key ใหม่ แก้ชื่อของ key เดิม
  ส่วน key ที่หายไปจะลบหรือเก็บไว้ ให้ตัดสินเอง) รันซ้ำกี่ครั้งก็ได้ผลเดิม
- ข้อมูลใช้สัญญาอนุญาต CC BY 4.0: ถ้านำไปเผยแพร่หรือแสดงต่อ ต้องใส่เครดิตตาม[ส่วนเครดิตข้อมูล](#เครดิตข้อมูล-attribution)
  คำสั่ง `export` พิมพ์บรรทัดเครดิตทาง stderr ทุกครั้ง (ไม่ปนกับข้อมูล)

**ตรวจตารางที่มีอยู่แล้ว:** ส่งออกตารางของคุณเป็น CSV แล้วรัน `npx thai-address-check my-table.csv --no-fix` อ่านคอลัมน์ `tac_codes`
ของแต่ละแถว (เช่น `POSTAL_CODE_MISMATCH` คือรหัสไปรษณีย์ไม่ใช่ของตำบลนั้น) หัวตารางแบบเดียวกับที่ `export` เขียน
(`province_name_th`, …, `postal_code`) หาคอลัมน์ได้เองโดยไม่ต้องใช้ `--map`

## ติดตั้ง

ติดตั้งจากซอร์สในโฟลเดอร์โปรเจกต์ เมื่อต้องการแก้โค้ดหรือลองเวอร์ชันล่าสุด (ต้องใช้ Node 22.12 ขึ้นไป):

```bash
npm ci
npm run build                          # สร้าง dist/ (ไลบรารี + คำสั่ง)
node dist/cli.js customers.csv         # ลองใช้คำสั่ง
```

ติดตั้งจาก npm: `npm install thai-address-check` หรือรันทันที `npx thai-address-check <file>`
ใช้ในโค้ดได้ทั้ง `import { check } from 'thai-address-check'` และ `require('thai-address-check')` (`require()` โหลดโมดูล ES ตรง ๆ
ซึ่ง Node 22.12 ขึ้นไปทำได้ ทดสอบแล้วบน Node 24 และ CI มีขั้นตอนตรวจทั้งสองแบบบน Node 22.12 และ 22.x)

หน้าเว็บ (วางที่อยู่ หรือลากไฟล์ **CSV** แล้วเห็นผล ทุกอย่างประมวลผลในเบราว์เซอร์):

```bash
npm --prefix web ci
npm --prefix web run dev               # เปิดทดลอง
npm --prefix web run build             # ได้ web/dist/ (หน้าเว็บที่บล็อกการเชื่อมต่อออกนอกเครื่องด้วย CSP)
npm --prefix web test                  # ชุดทดสอบของหน้าเว็บ
```

ข้อจำกัดของหน้าเว็บ: รับเฉพาะไฟล์ **CSV** (ไม่รับ `.xlsx`) และไฟล์ที่ดาวน์โหลดมี **คอลัมน์ผลลัพธ์คนละชุดกับคำสั่ง terminal**
คือเพิ่ม `check_status`, `check_findings`, `checked_province`, `checked_district`, `checked_subdistrict`, `checked_postal_code`,
`check_suggestions` และ **ไม่แก้เซลล์เดิม** (ค่าที่แก้แล้วอยู่ในคอลัมน์ `checked_*`) ส่วนคำสั่ง terminal เพิ่ม `tac_*` และเขียนค่าที่แก้ลงในเซลล์เดิม
ชุดทดสอบของหน้าเว็บจำลองเบราว์เซอร์ด้วย jsdom (กรอกที่อยู่เดียว, อัปโหลด CSV แบบ UTF-8 / คั่นด้วย `;` หรือแท็บ / TIS-620, ตรวจ, ดาวน์โหลด,
ไฟล์ที่มีแถวชื่อเรื่อง, ไฟล์ว่าง, 3,000 แถว) และไม่ใช่การทดสอบในเบราว์เซอร์จริงทุกยี่ห้อ

## รหัสผลตรวจ (finding code)

ทุกผลตรวจมีรหัสที่โปรแกรมอ่านได้, ช่องที่เกี่ยวข้อง (`fields`), ข้อความไทยและอังกฤษ (`message.th`, `message.en`)
และข้อมูลหลักฐาน (`detail`) ไม่มีผลตรวจที่ไม่มีคำอธิบาย

| รหัส | ความหมาย |
|---|---|
| `MISSING_FIELD` | ขาดช่องที่ต้องใช้ตัดสิน (ถ้ามีที่อยู่เดียวที่เข้ากัน จะเติมให้) |
| `UNKNOWN_NAME` | ไม่มีพื้นที่ปัจจุบันชื่อนี้ในระดับนี้ |
| `MISSPELLED_NAME` | ใกล้กับชื่อที่ถูกต้องชื่อเดียวอย่างชัดเจน (สะกดผิด) ถ้ามีอีกชื่อใกล้พอกัน (ห่างไม่ถึง 0.15) จะเสนอทั้งสองและไม่แก้เอง |
| `PARENT_MISMATCH` | พื้นที่มีอยู่ แต่ไม่อยู่ใต้พื้นที่แม่ที่ระบุ |
| `POSTAL_CODE_MISMATCH` | รหัสไปรษณีย์ไม่ตรงกับตำบลที่ระบุ (บอกรหัสที่ถูก) |
| `POSTAL_CODE_INVALID` | ไม่ครบ 5 หลัก หรือไม่มีที่ไหนใช้ |
| `ABOLISHED_AREA` | ชื่อหรือรหัสนี้เป็นพื้นที่ที่ถูกยุบแล้ว (บอกพื้นที่ที่มาแทนและระดับหลักฐาน) |
| `AMBIGUOUS` | มีมากกว่าหนึ่งที่อยู่ที่เข้ากัน ต้องมีอีกช่องมาตัดสิน |
| `FORMAT_NORMALIZED` | ข้อมูลเท่านั้น: ปรับรูปแบบการเขียน ความหมายไม่เปลี่ยน |

สถานะรวมต่อที่อยู่ (`status`): `valid` ตรงกับที่อยู่เดียวและไม่มีข้อผิดพลาด · `corrected` ถูกแก้อัตโนมัติจนใช้ได้ ·
`ambiguous` เข้ากันได้หลายที่อยู่ · `invalid` ไม่เข้ากับที่ไหนหรือยังมีข้อผิดพลาด

**กฎการแก้เอง:** แก้ก็ต่อเมื่อความมั่นใจ ≥ เกณฑ์ (ค่าเริ่มต้น 0.9) **และ** มีตัวเลือกที่ผ่านเกณฑ์เพียงตัวเดียว
นอกนั้นรายงานเป็นคำแนะนำหรือ `ambiguous` เพื่อให้คนตัดสิน

## ต่างจากแพ็กเกจที่คล้ายกันอย่างไร

เราไม่อ้างว่า "ไม่มีใครทำ" มีแพ็กเกจสองตัวที่ทับซ้อนกับโปรเจกต์นี้บางส่วน (ตรวจโดยติดตั้งและรันจริง บันทึกไว้ใน
[`docs/recon.md`](docs/recon.md) ณ 2026-11-25):

- **`thai-address-universal`** 2.2.1 ตรวจรายช่องว่าช่องไหนขัดกัน แต่หยุดที่ข้อผิดแรก ข้อความเป็นอังกฤษอย่างเดียว ไม่มีรหัสประเภท
  ไม่เสนอค่าที่ถูก ไม่รู้จัก "กรุงเทพ" ไม่รู้พื้นที่ที่ถูกยุบ และไม่ตรวจทั้งไฟล์
- **`thai-address-sdk`** 0.1.3 แก้ชื่อที่สะกดผิดได้ แต่ **แก้เงียบ ๆ ด้วยหลักฐานอ่อน** และไม่ตรวจรหัสไปรษณีย์ เช่น เปลี่ยน
  "แม่แดด" เป็นตำบล "แม่แรม" แล้วทิ้งรหัสเดิม และเขียนทับรหัสไปรษณีย์ที่ผิดโดยไม่แจ้ง

ความต่างของเรา: รายงานทุกข้อผิดพร้อมรหัสที่โปรแกรมอ่านได้, **ไม่แก้เองเมื่อไม่แน่ใจ**, รู้จักพื้นที่ที่ถูกยุบ และตรวจได้ทั้งไฟล์
อินพุตชุดเดียวกับที่บันทึกใน recon เมื่อรันกับโปรเจกต์นี้ (`check()` บน `dist/index.js`):

| อินพุต | ผลของเรา | ที่แพ็กเกจเดิมทำ (ตามที่บันทึกใน recon) |
|---|---|---|
| แม่แดด / แม่ริม / เชียงใหม่ / 58130 | `invalid` + `PARENT_MISMATCH` (ตำบลนี้อยู่ใต้อำเภอกัลยาณิวัฒนา) ไม่แก้เป็นตำบลอื่น | sdk: เปลี่ยนเป็น "แม่แรม" และทิ้งรหัส 58130 |
| เกาะพะงัน / สุราษฎร์ธานี / 84360 | `invalid` + `POSTAL_CODE_MISMATCH` บอกรหัสที่ถูก `84280` | sdk: เขียนทับเป็น 84280 โดยไม่แจ้ง |
| บางนา / เขตบางนา / กรุงเทพ | `ambiguous` + `ABOLISHED_AREA` เสนอ บางนาเหนือ และ บางนาใต้ ความมั่นใจ 0.5 ไม่แก้เอง | sdk: ตอบ `ambiguous` พร้อมตัวเลือก (`bestMatch` คือ "แขวงบางนาใต้") แต่ไม่บอกว่าชื่อ "บางนา" ถูกยุบ |

คอลัมน์ขวารันซ้ำเมื่อ 2026-11-25 กับ `thai-address-universal` 2.2.1 และ `thai-address-sdk` 0.1.3 แถวที่ 1 และ 2 ตรงตามที่เขียนทุกประการ
เวอร์ชันที่ใหม่กว่าอาจให้ผลต่างออกไป

## ความแม่นยำและความเร็ว

ชุดทดสอบใส่ข้อผิดพลาดที่ระบุชนิดลงในที่อยู่จริงจาก `@geothai/core` (สุ่มด้วย seed คงที่) แล้วเทียบผลกับคำตอบที่รู้
"Detected" คือพบรหัสผลตรวจที่ควรพบ, "Fixed correctly" คือถูกแก้แล้วได้ที่อยู่ที่ถูก, "Fixed wrongly" คือถูกแก้เป็นที่อยู่อื่น,
"Reported only" คือรายงานโดยไม่แก้ ตารางด้านล่างสร้างจาก `bench/results.json` ด้วย `node docs/bench-table.mjs --write`
ไม่ได้พิมพ์ด้วยมือ

<!-- bench:start -->

| Error injected | Rows | Detected % | Fixed correctly % | Fixed wrongly % | Reported only % |
|---|---:|---:|---:|---:|---:|
| Formatting only (ต./อ./จ., Thai digits, กทม.) | 300 | 100.0 | 100.0 | 0.0 | 0.0 |
| Misspelling: dropped tone mark or vowel | 300 | 100.0 | 51.7 | 0.0 | 48.3 |
| Misspelling: look-alike letter | 300 | 100.0 | 99.3 | 0.0 | 0.7 |
| Misspelling: swapped letters | 300 | 100.0 | 93.3 | 0.0 | 6.7 |
| Misspelling: neighbouring key | 300 | 100.0 | 86.3 | 0.0 | 13.7 |
| Misspelling: deleted consonant | 300 | 100.0 | 20.0 | 0.0 | 80.0 |
| Misspelled name with no other help | 300 | 100.0 | 0.0 | 0.0 | 100.0 |
| Wrong postal code | 300 | 100.0 | 0.0 | 0.0 | 100.0 |
| Subdistrict under the wrong district | 300 | 100.0 | 0.0 | 0.0 | 100.0 |
| Abolished name, official notice, one successor | 48 | 100.0 | 100.0 | 0.0 | 0.0 |
| Abolished name, weak evidence (must not be auto-fixed) | 300 | 100.0 | 0.0 | 0.0 | 100.0 |
| Missing fields, exactly one answer | 300 | 100.0 | 100.0 | 0.0 | 0.0 |
| Missing fields, several answers (must stay ambiguous) | 300 | 100.0 | 0.0 | 0.0 | 100.0 |

Clean set (1500 correct addresses): 0 false alarms, 0 resolved to a different address, 0 came back with the same address written differently (output text not equal to the input).

Reproduce: `npm run bench` · seed 20261125 · 300 rows per class · 1500 clean rows · `@geothai/core` 5.0.0 (data 2026.10.23) · result digest `8956262ed323c8f0`. Counts are deterministic for a given seed and data version. Timings are deliberately not printed here: they depend on the machine, so run `npm run bench` to measure your own.

<!-- bench:end -->

## ข้อจำกัด

- ตรวจ **สี่ช่อง** เท่านั้น (จังหวัด อำเภอ ตำบล รหัสไปรษณีย์) ไม่แกะที่อยู่จากข้อความยาว ๆ และไม่ตรวจบ้านเลขที่ ถนน ซอย
- ข้อมูลอ้างอิงคือ `@geothai/core` รุ่นที่ติดตั้ง ผลตรวจบอกเวอร์ชันข้อมูลใน `dataVersion` ถ้าข้อมูลต้นทางผิด เราก็ผิดตาม
- พื้นที่ที่ถูกยุบมี 1,583 รายการ แต่แก้อัตโนมัติได้เฉพาะ 111 รายการที่มีประกาศทางการรองรับ อีก 1,071 รายการเป็นการจับคู่ด้วยชื่อ
  (เสนอได้ แต่ไม่แก้เอง) และ 401 รายการไม่มีพื้นที่ที่มาแทน (ที่มา: `docs/recon.md`)
- ชื่อตำบลที่ซ้ำกันมี 795 ชื่อ ต้องใช้ช่องอื่นช่วยตัดสิน ถ้าช่องไม่พอจะได้ `AMBIGUOUS` ไม่ใช่การเดา
- ตารางความแม่นยำวัดบนข้อผิดพลาดที่ **จำลองขึ้น** ไม่ใช่ข้อมูลลูกค้าจริง ข้อมูลจริงอาจผิดแบบอื่นที่ชุดทดสอบไม่ได้ครอบคลุม
- **ความเร็ว:** README ไม่ระบุเวลาเป็นมิลลิวินาที เพราะขึ้นกับเครื่อง เป้าหมายการออกแบบคือเฉลี่ยต่ำกว่า 5 ms ต่อการตรวจหนึ่งรายการบนชุดทดสอบ (เป็นเป้าหมาย ไม่ใช่ค่าที่วัดแล้วรับรอง) กรณีที่ช้าที่สุดคือชื่อตำบลที่สะกดผิดโดยไม่มีช่องอื่นช่วย เพราะต้องไล่เทียบกับชื่อตำบลทั้งหมด 7,436 ชื่อ ซึ่งช้ากว่าค่าเฉลี่ยชัดเจนและเรายอมรับข้อนี้ ให้รัน `npm run bench` เพื่อวัดบนเครื่องของคุณ
- **ไฟล์:** หัวตารางต้องอยู่ **แถวแรก** ของไฟล์หรือชีต ไม่รองรับแถวชื่อเรื่องหรือหมายเหตุเหนือหัวตาราง (ให้ลบก่อน) `.xlsx` ถูกอ่านทั้งชีตเข้าหน่วยความจำ
  (CSV อ่านแบบ streaming) และไม่รองรับ `.xls` (บันทึกเป็น `.xlsx` หรือ `.csv` ก่อน)
- **ขนาดบนเบราว์เซอร์:** เมื่อ bundle ไลบรารีรวมข้อมูล GeoThai ทั้งชุด ได้ประมาณ 886 KB (minified) หรือประมาณ 159 KB (gzip) ตัวเลขนี้ได้จาก
  `npm run build` แล้ว `npx esbuild dist/index.js --bundle --minify --format=esm --platform=neutral | wc -c` (ต่อด้วย `| gzip -9 | wc -c` สำหรับ gzip)
  และขึ้นกับ bundler
<!-- homonyms-th:start -->
- **ชื่อตำบลอย่างเดียว (ไม่มีจังหวัดหรืออำเภอ):** 212 จาก 5,849 ชื่อตำบล (ข้อมูลรุ่น `2026.10.23`) เคยเป็นชื่อของพื้นที่ที่ถูกยุบในที่อื่นด้วย จึงได้ `ambiguous` และไม่เติมจังหวัด/อำเภอให้ (เช่น "บางนา" ไม่ถูกเติมเป็นพระนครศรีอยุธยา) บางชื่อเป็นที่เดียวกันก่อนแยกจังหวัด (เช่น ศาลาลำดวน) แต่ข้อมูลไม่ได้เชื่อมไว้จึงบอกไม่ได้ ใส่จังหวัด อำเภอ หรือรหัสไปรษณีย์ที่ตรงกันเพื่อให้ตรวจได้ (นับด้วย `node docs/known-limits.mjs`)
<!-- homonyms-th:end -->
- **ข้อจำกัดอื่นที่ผู้ทดสอบพบ:** ถ้าใส่ชื่ออำเภอกับตำบลสลับช่อง จะได้ `UNKNOWN_NAME` หรือ `MISSPELLED_NAME` โดยไม่บอกว่าน่าจะสลับกัน, ช่องที่ใส่ที่อยู่ทั้งบรรทัด (เช่น "เชียงใหม่ 50200")
  ได้ `UNKNOWN_NAME`, ตำบลที่มีรหัสไปรษณีย์หลายรหัสแต่ไม่ได้ใส่รหัส ได้ `valid` พร้อม `MISSING_FIELD` ระดับ info (กรองเฉพาะ `tac_status=valid` จึงอาจได้แถวที่รหัสว่าง)
  และชื่อสั้นที่พิมพ์ผิดหนึ่งตัวอักษรมักไม่ถูกแก้เอง (ความมั่นใจต่ำกว่า 0.9 โดยตั้งใจ)
- **การแก้ชื่อที่พิมพ์ผิดแบบอัตโนมัติ** ไม่ทำเมื่อมีชื่อจริงอีกชื่อที่ใกล้เคียงกัน (ห่างกันไม่ถึง 0.15 ในความมั่นใจ) จะเสนอทั้งสองชื่อให้เลือกเอง แต่การพิมพ์ผิดที่ใกล้ชื่อจริงอีกชื่อ
  มากกว่าชื่อที่ตั้งใจเขียน ยังถูกแก้ไปเป็นชื่ออื่นได้ (พบน้อยมากในการทดลองกับการพิมพ์ผิดทีละตัวอักษรของทุกตำบล) ตรวจผลก่อนใช้กับข้อมูลสำคัญ

**ไม่อยู่ในขอบเขต:** การแกะที่อยู่จากข้อความอิสระ, ระดับบ้านเลขที่/ถนน/ซอย/หมู่บ้าน, พิกัดและแผนที่, ชุดข้อมูลของตัวเอง,
บริการออนไลน์ที่ต้องมีเซิร์ฟเวอร์ (ดูเหตุผลใน [`PLAN.md`](PLAN.md))

## ข้อมูลอัปเดตอย่างไร

- ข้อมูลที่มากับแพ็กเกจรุ่นนี้: รุ่น `2026.10.23` จาก `@geothai/core` 5.0.0 ซึ่ง `package.json` ระบุเวอร์ชันตายตัว (ไม่มี `^`)
- ข้อมูลจึงเปลี่ยน **เฉพาะเมื่อแพ็กเกจนี้ออกเวอร์ชันใหม่** อัปเกรดเวอร์ชันแล้วได้ข้อมูลใหม่ทุกคนพร้อมกัน ไม่ต้องแก้ไฟล์เอง
  (เราไม่รับประกันว่าข้อมูลต้นทางตามประกาศของทางราชการได้เร็วแค่ไหน)
- ดูว่ากำลังใช้ข้อมูลรุ่นไหน: `thai-address-check --help` (บรรทัด `Data version:`) หรือ `dataVersion` ในโค้ด
  และทุกผลของ `check()` มี `dataVersion`
- เมื่อ `@geothai/core` ออกรุ่นใหม่ Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) เปิด pull request ซึ่ง CI รันทดสอบให้
  ทดสอบที่ผูกกับรุ่นข้อมูลและจำนวนแถวจะล้มโดยตั้งใจ เพื่อให้ตรวจตัวเลขก่อนรับ การออกเวอร์ชันยังต้องให้ผู้ดูแลอนุมัติเสมอ ไม่มีงานไหนเผยแพร่เอง

## Dependency

ไลบรารีพึ่ง `@geothai/core` ตัวเดียวสำหรับข้อมูล ส่วนชั้นอ่านไฟล์เพิ่มอีกสองตัว: `csv-parse` (อ่าน/แยก CSV แบบ streaming
ที่จัดการเครื่องหมายคำพูดและบรรทัดใหม่ในเซลล์ได้ถูกต้อง) และ `read-excel-file` (อ่าน `.xlsx`) ไม่มี dependency โดยตรงอื่นใน runtime (แพ็กเกจทั้งสามอาจมี dependency ของตัวเอง ดูใน `package-lock.json`)

## พัฒนาและ CI

```bash
npm run typecheck && npm test && npm run build   # เกณฑ์ผ่านของทุกงาน
npm run bench                                    # วัดความแม่นยำ (เขียน bench/results.json)
```

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml): ทุก push/PR รัน typecheck, test, build (Node 22.12 และ 22.x),
  benchmark ตัวอย่างเล็ก, ทดสอบคำสั่ง terminal กับไฟล์ตัวอย่าง และ test + build ของหน้าเว็บ
- [`.github/workflows/weekly-data-check.yml`](.github/workflows/weekly-data-check.yml): ทุกวันจันทร์ตรวจว่า `@geothai/core`
  มีรุ่นใหม่หรือไม่ ถ้ามีจะติดตั้งแบบไม่บันทึก รัน test และ benchmark เต็ม แล้วเปิด issue พร้อมผลเทียบกับตัวเลขที่ commit ไว้
  (ไม่แก้ไฟล์ใดและไม่ commit เอง)
- [`.github/dependabot.yml`](.github/dependabot.yml): ตรวจ npm ทุกวัน (`@geothai/core` ได้ pull request แยกของตัวเอง) และ GitHub Actions ทุกสัปดาห์

## เครดิตข้อมูล (Attribution)

Address data © 2026 Pongsakorn Thipayanate ("GeoThai"), licensed under CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/), via https://github.com/GeoThai/data and the
`@geothai/core` package. Underlying sources: Department of Provincial Administration (DOPA),
Thailand Post, and thailand-geography-json © Joe Takara (MIT). Changes: none to the data;
this tool reads it and reports inconsistencies. GeoThai does not endorse this project.

## สัญญาอนุญาต

โค้ดของโปรเจกต์นี้ใช้สัญญาอนุญาต MIT ดู [`LICENSE`](LICENSE) ส่วนข้อมูลเป็นของ GeoThai ตามเครดิตด้านบน

---

## English

Check Thai addresses field by field (province, district, subdistrict, postal code): find **which field is wrong
and why**, suggest the fix, and **correct automatically only when the evidence is strong enough**. Use it as a TypeScript
library, as a command for CSV/Excel files, or as a web page that runs entirely in the browser. No AI, no server calls;
everything runs on your machine.

> **Install:** `npm install thai-address-check` (published on npm).

### Example 1: check one address

```ts
import { check } from 'thai-address-check'

const r = check({
  province: 'เชียงใหม่',
  district: 'เมืองเชียงใหม่',
  subdistrict: 'ศรีภูมิ',
  postalCode: '10110', // wrong: this subdistrict uses 50200
})

r.status // 'invalid'
r.findings[0].code // 'POSTAL_CODE_MISMATCH'
r.suggestions[0] // { field: 'postalCode', from: '10110', to: '50200', confidence: 0.85, ... }
```

Actual output of this code (`node` against `dist/index.js` after `npm run build`): `status = invalid`,
`POSTAL_CODE_MISMATCH: Postal code 10110 does not belong to subdistrict "ศรีภูมิ" (it uses 50200)`, and a suggestion
`50200` with confidence 0.85, **below the 0.9 auto-fix threshold**, so it is reported and left for a person to decide.

### Example 2: fix when sure, fill what is missing

```ts
check({ province: 'เชียงใหม่', district: 'เมืองเชียงใหม่', subdistrict: 'ศรีภมู', postalCode: '50200' })
// status 'corrected'; subdistrict 'ศรีภมู' -> 'ศรีภูมิ' (MISSPELLED_NAME, confidence 0.914)

check({ subdistrict: 'ศรีภูมิ', postalCode: '50200' })
// status 'corrected'; province and district filled in (MISSING_FIELD) because only one address fits
```

Formatting is normalised too (`กรุงเทพ` becomes `กรุงเทพมหานคร`; `FORMAT_NORMALIZED`, severity info, meaning unchanged).
Options of `check(input, options)`: `autoCorrectThreshold` (default 0.9), `autoCorrect: false` (report only),
`maxSuggestions` (default 3). Use `checkMany(rows)` for large inputs: it returns a generator (each row is checked as you
iterate; it has no `.length`), so use `[...checkMany(rows)]` when you need an array.
A district written `เมือง`, `อ.เมือง`, `Mueang` or `Muang` means the capital district of the given province (เชียงใหม่ + `อ.เมือง` =
`เมืองเชียงใหม่`): `valid` with `FORMAT_NORMALIZED`, rule `mueang-province`. The full name is in the language of the district field as written (`เมือง` gives the Thai name, `Mueang` the English one, even under a Thai province). Without a province, the subdistrict and postal code decide when
exactly one place fits. Bangkok and Phra Nakhon Si Ayutthaya have no "เมือง…" district, so it is not expanded there. Bangkok districts are
accepted both as `เขตพระนคร` and `พระนคร`.
A postal code is read when it is 5 digits (Thai digits too), optionally separated by spaces, hyphens or a thousands comma (`50 200`, `50-200`,
`50,200`), or with a spreadsheet's zero decimal (`50200.0`). Anything else with a letter or a dot (`5020.0`, `50200abc`, `TH-50200`, `ปณ.50200`)
is `POSTAL_CODE_INVALID`, quoted as written: digits are never picked out of it.

### Example 3: check a whole CSV/Excel file

```bash
npx thai-address-check customers.csv --out customers.checked.csv --report summary.json --fail-over 5
```

Columns are found from the header (Thai or English names); override with `--map`, for example
`--map subdistrict=ต.,postalCode=5`. The output is a CSV with four added columns (`tac_status`, `tac_codes`,
`tac_message`, `tac_changes`) plus a summary on screen. `.xlsx` input is supported (`--sheet`).
Options are listed in the Thai table above and in `thai-address-check --help`. Exit codes: `0` done ·
`1` invalid share over `--fail-over` · `2` bad arguments or file problem. `thai-address-check --version` prints the version.
`--delimiter` takes one character or the word `tab`; a wrong one (a comma file given `;`) stops with the likely delimiter named.
Rows in which every cell is empty (such as `,,,`) are skipped and counted in the summary, not counted as invalid. They are also left out of the output file, so output row N no longer lines up with input row N.

### Example 4: seed your own table

Instead of a JSON file found on the internet and patched by hand, export the same reference data the checker uses:

```bash
npx thai-address-check export > addresses.csv                     # CSV (default) on stdout
npx thai-address-check export --format json --out addresses.json  # or JSON into a file
```

In code: `import { listAddresses, dataVersion } from 'thai-address-check'` gives the same rows as an array.

- **One row per (subdistrict, postal code).** Columns: `province_code`, `province_name_th`, `province_name_en`, `district_code`,
  `district_name_th`, `district_name_en`, `subdistrict_code`, `subdistrict_name_th`, `subdistrict_name_en`, `postal_code`
  (JSON uses camelCase, e.g. `provinceCode`), sorted by subdistrict code then postal code; every value is a string.
- Data `2026.10.23` (`@geothai/core` 5.0.0): 7,600 rows, 7,436 subdistricts, 928 districts, 77 provinces.
- A subdistrict can have more than one postal code (160 do in this data), so the table key is `subdistrict_code` + `postal_code`,
  not `subdistrict_code` alone.
- Names are the dataset's own, unmodified: Bangkok districts carry the `เขต` prefix (`เขตพระนคร`). When checking an address, both
  `เขตพระนคร` and `พระนคร` are accepted and neither is rewritten.
- To update after an upgrade: load the new file into a staging table and upsert on `subdistrict_code` + `postal_code` (insert new keys,
  update names on existing keys, and decide yourself whether to delete keys that disappeared); running it twice gives the same table.
- The data is CC BY 4.0: if you publish or display it, keep the credit from [Attribution](#attribution). `export` prints the credit line
  on stderr every time (never mixed into the data).

**Audit a table you already have:** export your table to CSV, run `npx thai-address-check my-table.csv --no-fix`, and read each row's
`tac_codes` (for example `POSTAL_CODE_MISMATCH`: the postal code is not one of that subdistrict's). The headers `export` writes
(`province_name_th`, …, `postal_code`) are found without `--map`.

### Install

From source, to work on the code or try the latest version (Node 22.12 or newer):

```bash
npm ci
npm run build
node dist/cli.js customers.csv
```

Install: `npm install thai-address-check`, or run `npx thai-address-check <file>`. In code, both
`import { check } from 'thai-address-check'` and `require('thai-address-check')` work (`require()` loads the ES module directly, which Node 22.12
and newer can do; tested on Node 24, and CI has a step that checks both forms on Node 22.12 and 22.x).
Web page: `npm --prefix web ci`, then `npm --prefix web run dev` (try it), `npm --prefix web test` or `npm --prefix web run build`
(`web/dist/`, with a Content-Security-Policy that blocks any connection leaving the browser).
Limits of the web page: it reads **CSV only** (not `.xlsx`), and the file it downloads has **different output columns from the command**:
it adds `check_status`, `check_findings`, `checked_province`, `checked_district`, `checked_subdistrict`, `checked_postal_code`,
`check_suggestions` and **leaves the original cells untouched** (corrected values are in the `checked_*` columns); the command adds `tac_*`
and writes corrections into the original cells. The page's tests simulate a browser with jsdom (one address; CSV upload as UTF-8, `;`- or
tab-separated, TIS-620; check; download; a file with a title row; an empty file; 3,000 rows) and are not a test in every real browser.

### Finding codes

Every finding has a machine-readable code, the fields involved, a Thai and an English message, and structured evidence
(`detail`). See the Thai table above for the meaning of each code: `MISSING_FIELD`, `UNKNOWN_NAME`, `MISSPELLED_NAME`,
`PARENT_MISMATCH`, `POSTAL_CODE_MISMATCH`, `POSTAL_CODE_INVALID`, `ABOLISHED_AREA`, `AMBIGUOUS`, `FORMAT_NORMALIZED`.
Overall `status`: `valid`, `corrected`, `ambiguous`, `invalid`. **Auto-correct rule:** apply a fix only when confidence is at
least the threshold (default 0.9), exactly one candidate qualifies **and** no other candidate is within 0.15 of it; otherwise
report a suggestion or `ambiguous`.

### How it differs from similar packages

We do not claim nobody does this. Two packages overlap partly (installed and run; recorded in
[`docs/recon.md`](docs/recon.md), 2026-11-25): **`thai-address-universal`** 2.2.1 checks field by field but stops at the first
error, has English-only messages, no codes, no suggestions, no "กรุงเทพ" alias, no abolished areas, no file mode;
**`thai-address-sdk`** 0.1.3 fixes misspelled names but **rewrites silently on weak evidence** and does not check postal codes
(it turned "แม่แดด" into "แม่แรม" and dropped the postal code; it overwrote a wrong postal code without saying so).
What we add: every error with a machine-readable code, **no automatic fix when unsure**, abolished areas, whole files.
On the same three inputs (run `check()` from `dist/index.js`): แม่แดด / แม่ริม gives `PARENT_MISMATCH` and no rewrite;
เกาะพะงัน + 84360 gives `POSTAL_CODE_MISMATCH` with the right code `84280`; บางนา / เขตบางนา / กรุงเทพ gives `ambiguous` +
`ABOLISHED_AREA` with two suggestions at confidence 0.5, none applied. For comparison, `thai-address-sdk` 0.1.3 answers
`ambiguous` with alternatives (its `bestMatch` is "แขวงบางนาใต้") but does not say that "บางนา" is an abolished name. The competitor
column was re-run on 2026-11-25 with `thai-address-universal` 2.2.1 and `thai-address-sdk` 0.1.3 (rows 1 and 2 exactly as written);
newer versions may behave differently.

### Accuracy and speed

The Thai section above has the table, generated from `bench/results.json` by `node docs/bench-table.mjs --write`; the same
numbers come back from `npm run bench` (seeded, so counts repeat exactly for the same data version; timings do not).

### Limits and out of scope

Four fields only; no free-text address parsing, no house/road/soi level, no coordinates, no server. The reference is the installed
`@geothai/core` (`dataVersion` is in every result). Of 1,583 abolished areas, only 111 have an official notice and can be
fixed automatically; 1,071 are name matches (suggested, never applied) and 401 have no successor (source: `docs/recon.md`).
795 subdistrict names are shared by several places, so ambiguous input yields `AMBIGUOUS`, not a guess. The accuracy table
measures **simulated** errors, not real customer data. **Speed:** the README quotes no milliseconds, because they depend on the machine. The design target is an average under 5 ms per check on the benchmark mix (a target, not a certified measurement); the slowest case is a misspelled subdistrict with no other field to help, which scans all 7,436 subdistrict names; that case is clearly slower than the average and we accept it. Run `npm run bench` to measure your own machine.

- **Files:** the header must be the **first row** of the file or sheet; a title or note above it is not supported (delete it first). `.xlsx` is read
  as a whole sheet into memory (CSV is streamed) and `.xls` is not supported (save as `.xlsx` or `.csv`).
- **Size in a browser bundle:** bundling the library includes the whole GeoThai dataset: about 886 KB minified, about 159 KB gzipped. Re-run with
  `npm run build` then `npx esbuild dist/index.js --bundle --minify --format=esm --platform=neutral | wc -c` (add `| gzip -9 | wc -c` for gzip); it depends on the bundler.
<!-- homonyms-en:start -->
- **Subdistrict name alone (no province or district):** 212 of 5,849 subdistrict names (data `2026.10.23`) also named an abolished area elsewhere, so they come back `ambiguous` and nothing is filled (`บางนา` is not filled as Phra Nakhon Si Ayutthaya). Some are the same place before a province split (`ศาลาลำดวน`), which the data does not link, so it cannot tell. Give the province, the district or a postal code that matches. (Counted by `node docs/known-limits.mjs`.)
<!-- homonyms-en:end -->
- **Other limits a tester found:** district and subdistrict swapped between columns give `UNKNOWN_NAME` or `MISSPELLED_NAME` with no hint that they are swapped; a whole
  address in one field ("เชียงใหม่ 50200") gives `UNKNOWN_NAME`; a subdistrict with several postal codes and no code given is `valid` with an info
  `MISSING_FIELD` (so filtering on `tac_status=valid` can keep rows with an empty postal code); a one-character typo in a short name is often not
  corrected automatically (confidence below 0.9, on purpose).
- **Automatic correction of misspelled names** is not applied when another real name is nearly as close (less than 0.15 apart in confidence): both
  are suggested and you choose. A typo that happens to be closer to a different real name than to the intended one can still be corrected to
  that other name (very rare in a trial on every one-character typo of every subdistrict): review the result before using it on important data.

### How the data stays current

- Data shipped with this version: `2026.10.23`, from `@geothai/core` 5.0.0, which `package.json` pins exactly (no `^`).
- So the data changes **only when this package releases a new version**: everyone who upgrades gets the same new data, with no file
  mapping by hand. (We make no promise about how quickly the upstream data follows official announcements.)
- To see which data you run: `thai-address-check --help` (the `Data version:` line) or `dataVersion` in code; every `check()`
  result also carries `dataVersion`.
- When `@geothai/core` publishes a new version, Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens a pull request and CI
  tests it; the tests tied to the data version and row counts fail on purpose so the numbers are re-checked before merging. A release
  always needs the maintainer's approval; nothing publishes by itself.

### Dependencies

`@geothai/core` for the data, plus `csv-parse` (streaming CSV with correct quoting and embedded newlines) and
`read-excel-file` (`.xlsx` input) for the file layer. No other direct runtime dependency (those three packages may carry their own; see `package-lock.json`).

### Attribution

See the attribution notice in the Thai section above (CC BY 4.0, GeoThai). GeoThai does not endorse this project.

### License

Code: MIT ([`LICENSE`](LICENSE)). Data: GeoThai, CC BY 4.0.
