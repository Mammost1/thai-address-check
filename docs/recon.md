# recon — คู่แข่ง, API จริงของ `@geothai/core`, สัญญาอนุญาต

วันที่สำรวจ: 2026-11-25
สภาพแวดล้อม: Node v24.21.0, ติดตั้งใน scratch dir นอก repo (`npm i --ignore-scripts`)

## Verdict: **GO**

ยังไม่มีแพ็กเกจใดทำชั้น "ตรวจ + บอกจุดผิดเป็นรหัส + แก้เฉพาะเมื่อหลักฐานแน่น + ชื่อที่ถูกยุบ + ไฟล์/CLI" ครบ
แต่ **ไม่ใช่ที่ว่างเปล่า**: มีของที่ทับซ้อนบางส่วน 2 ตัว (ดู Q1) และมีข้อผิดพลาดใน PLAN.md 1 จุด + ข้อควรระวังของ API 5 จุด (ดู "ผลกระทบต่อแผน")
ตำแหน่งที่ยังว่าง = **ความปลอดภัยของการแก้** (ไม่แก้เองเมื่อหลักฐานอ่อน), **รหัสข้อผิดพลาดที่โปรแกรมอ่านได้**, **พื้นที่ที่ถูกยุบ**, **batch/CLI**

---

## Q1. มีใครทำชั้นนี้แล้วหรือยัง

วิธี: registry search (`registry.npmjs.org/-/v1/search`, 18 คำค้น) + registry JSON ของแต่ละแพ็กเกจ + ติดตั้งและรันจริงกับอินพุตเดียวกัน
PyPI: `thaiaddress` 0.2.1 = "A Python parser for Thai address" (แกะข้อความ ไม่ใช่ตรวจ); ไม่พบอื่น
GitHub (`gh search repos`, 5 คำค้น): ไม่พบ repo ที่เป็นตัวตรวจ/แก้ที่อยู่ไทย (เจอแค่ปลั๊กอิน shipping 2 ตัว 0★)

| แพ็กเกจ | ver / อัปเดต | ทำอะไรได้ (ยืนยันโดยรัน) | ขาดอะไรเมื่อเทียบกับแผน |
|---|---|---|---|
| **thai-address-universal** 2.2.1 (ISC, 2026-11-21) | `validateAddress({province,district,subDistrict,postalCode})` → `{valid, errors:{field:msg}}` | บอกช่องที่ขัดกัน เช่น `{subDistrict:'Sub-district "แม่แดด" is not in district "แม่ริม"'}`, `{postalCode:'Postal code "84360" is not in sub-district "เกาะพะงัน"'}` | **ทับฟีเจอร์ 1 บางส่วน** แต่: ข้อความอังกฤษอย่างเดียว ไม่มีรหัสประเภท; "หยุดที่ช่องแรกที่ขัด" (ไม่รายงานหลายข้อ); ไม่มี suggestion; ไม่ normalize ("กรุงเทพ" → `Unknown province`); ไม่รู้พื้นที่ยุบ (`บางนา` ใต้ เขตบางนา → "not in district" ไม่บอกว่าถูกยุบ); ไม่มี batch/CLI |
| **thai-address-sdk** 0.1.3 (MIT, 2026-10-05) | `normalizeAddress(string)` fuzzy + alias + `corrections[]`; `search` fuzzy; `damerauLevenshtein` | แก้สะกดผิดได้ (`อยูทยา`→`พระนครศรีอยุธยา`; `พระบรมมหาราชวง`→`…วัง`) | **ทับฟีเจอร์ 3, 4 บางส่วน** แต่ **แก้เงียบ ๆ ด้วยหลักฐานอ่อน** (ดูด้านล่าง) ไม่ตรวจรหัสไปรษณีย์ ไม่มี error code ไม่รู้พื้นที่ยุบ ไม่มี batch/CLI ข้อมูลเป็น snapshot ของ thailand-geography-json (ไม่ใช่ GeoThai) |
| thaizip 0.7.9 (MIT) | autocomplete fuzzy, `lookupByZipCode`, `resolveThaiAddress` | ค้น/เติมอัตโนมัติ | เป็น autocomplete ไม่ใช่ตัวตรวจ ไม่มี validate-record |
| thai-address-search 0.3.0 (MIT) | `searchAddress`, `searchByZipcode`, fuzzy | ค้น | ไม่ตรวจความสอดคล้อง |
| @amiearth/thai-address-finder 0.0.16 | README โฆษณา `validateAddress`→boolean | — | **ติดตั้งแล้วโหลดไม่ได้**: `ERR_MODULE_NOT_FOUND …/dist/data/addresses` (แพ็กเกจพัง); boolean ไม่บอกช่อง |
| thai-address-database 0.0.33, thai-data 3.0.2, @riz007/thai-address-data, province, thai-postal-code, thai-address-select, @1moby/thai-address, @krizad/thai-address-helper, @farzai/thailand-address | ข้อมูล/ค้น/dropdown/autocomplete | — | อ่าน README + exports แล้ว ไม่มี diagnosis/correction/batch |
| thai-address-splitter, thai-addr, thai-address-cut, sabaijs | แกะข้อความยาวเป็นช่อง | — | อยู่นอกขอบเขต (ข้อ 7) และไม่ใช่ตัวตรวจ |
| geothai 4.2.2 | alias ของ `@geothai/core` | — | — |

หลักฐานรันจริง (อินพุต → ผล) ที่ใช้ตัดสิน:

```
thai-address-sdk normalizeAddress('แม่แดด 58130 แม่ริม เชียงใหม่')
  → status matched, conf 0.979, "ตำบลแม่แรม อำเภอแม่ริม จังหวัดเชียงใหม่ 50180"
    corrections: แม่แดด → แม่แรม (fuzzy)        # เปลี่ยนเป็นตำบลอื่นเงียบ ๆ และทิ้งรหัส 58130
thai-address-sdk normalizeAddress('เกาะพะงัน สุราษฎร์ธานี 84360')
  → status matched, conf 1, postal 84280, corrections []   # รหัสผิดถูกเขียนทับเงียบ ๆ ไม่แจ้ง
thai-address-sdk normalizeAddress('บางนา เขตบางนา กรุงเทพ')
  → ambiguous แต่ bestMatch = แขวงบางนาใต้ ไม่บอกว่า "บางนา" เป็นแขวงที่ถูกยุบ
thai-address-universal validateAddress({กรุงเทพ, พระนคร, พระบรมมหาราชวง})
  → { valid:false, errors:{ province:'Unknown province "กรุงเทพ"' } }
```

ข้อสรุป: คู่แข่งที่ใกล้สุดมี 2 ตัว คนละครึ่ง (universal = ตรวจรายช่อง; sdk = fuzzy/normalize) ไม่มีตัวไหนรวมกัน และทั้งคู่ไม่มี
(ก) รหัสประเภทอ่านด้วยโปรแกรม (ข) หลายข้อผิดพร้อมกัน (ค) นโยบาย "ไม่แก้เมื่อไม่แน่ใจ" (ง) ABOLISHED_AREA พร้อมหลักฐาน (จ) ไฟล์/CLI
→ **GO** แต่ README ต้องวางตำแหน่งตรง ๆ ว่า "ต่างจาก thai-address-universal / thai-address-sdk อย่างไร" ไม่ควรอ้างว่าไม่มีใครทำ
ข้อจำกัดของการสำรวจ: เช็กจาก registry/README/การรันตัวอย่าง ไม่ได้อ่านซอร์สทุกแพ็กเกจ; ไม่ได้ตรวจ npm 100% (คำค้นไม่ครอบทุกชื่อ)

---

## Q2. API จริงของ `@geothai/core` (ยืนยันจากแพ็กเกจที่ติดตั้ง)

- เวอร์ชัน **5.0.0** (เผยแพร่ 2026-10-23; มีแค่ `0.0.0-stage` กับ `5.0.0`), license `MIT AND CC-BY-4.0`, `type: module`, `engines.node >=22.12`, **zero dependencies**, `sideEffects:false`
- `require()` ก็ใช้ได้ (ทดสอบบน Node 24)
- ขนาด: unpacked **830,384 B**; ไฟล์ `dist/*.js` รวม 716,574 B; gzip index+areas ≈ **119 KB**, รวม abolished ≈ **148 KB**
- entry: `.` (main), `./abolished` (แยก bundle), `./types`

### ฟังก์ชัน (จาก `dist/index.d.ts`, `dist/abolished.d.ts`)

```ts
// '@geothai/core'
export const dataVersion: string                          // '2026.10.23'
provinces(): Province[]
province(code: string): Province | undefined              // '84'
districts(provinceCode: string): District[]               // [] ถ้ารหัสไม่รู้จัก
district(code: string): District | undefined              // '8405'
subdistricts(districtCode: string): Subdistrict[]
subdistrict(code: string): Subdistrict | undefined        // '840503'
address(subdistrictCode: string): Address | undefined
byPostalCode(postalCode: string): Subdistrict[]           // เรียงตามรหัสตำบล; [] ถ้าไม่มี
search(query: string, options?: { limit?: number }): SearchResult[]   // substring, ไม่ใช่ fuzzy
match(query: MatchQuery): Address[]                       // เรียงตามรหัสตำบล

// '@geothai/core/abolished'
abolishedAreas(): Abolished[]
matchAbolished(query: MatchQuery): Abolished[]
```

### Types

```ts
type Province    = { code: string; name_th: string; name_en: string }
type District    = { code: string; name_th: string; name_en: string; province_code: string }
type Subdistrict = { code: string; name_th: string; name_en: string;
                     district_code: string; province_code: string; postal_codes: string[] }
type Address     = { province: Province; district: District; subdistrict: Subdistrict }
type SearchResult = { level: 'province'|'district'|'subdistrict'; area: Province|District|Subdistrict }
type MatchQuery  = { subdistrict: string;        // << จำเป็น (ไม่ optional)
                     district?: string; province?: string; postalCode?: string }  // ชื่อฟิลด์: postalCode
type Abolished   = { code: string; name_th: string; name_en: string | null;
                     level: 'province'|'district'|'subdistrict'; parent_code: string | null;
                     abolished_on: string;                       // 'YYYY-MM-DD'
                     successors: string[];                       // รหัสปัจจุบัน; ว่างได้
                     successors_basis: 'notice' | 'name' | null;
                     successors_in_force: string | null;
                     successors_source: string | null }          // ชื่อประกาศ + ราชกิจจาฯ + URL
```

ตัวอย่างระเบียนจริง: ตำบล `{"code":"100101","name_th":"พระบรมมหาราชวัง","name_en":"Phra Borom Maha Ratchawang","district_code":"1001","province_code":"10","postal_codes":["10200"]}`;
เขต `{"code":"1001","name_th":"เขตพระนคร","name_en":"Phra Nakhon","province_code":"10"}` (**ชื่อเขตมีคำว่า "เขต" นำหน้าในข้อมูล** ส่วนจังหวัด `กรุงเทพมหานคร`)

### ตัวเลข (นับจากแพ็กเกจที่ติดตั้ง สคริปต์: เดิน `provinces()→districts()→subdistricts()`)

| รายการ | ค่า |
|---|---|
| จังหวัด / อำเภอเขต / ตำบลแขวง | **77 / 928 / 7,436** |
| รหัสไปรษณีย์ที่ไม่ซ้ำ | 976 |
| ตำบลที่มีหลายรหัสไปรษณีย์ | 160 (เช่น `100203 สวนจิตรลดา` → `10300, 10303`) |
| ตำบลที่ไม่มีรหัสไปรษณีย์ | 0 |
| ชื่อตำบลที่ซ้ำกัน | **795 ชื่อ** ครอบคลุม 2,382 ตำบล (สูงสุด `หนองบัว` ×28) — ตรงกับ README |
| พื้นที่ที่ถูกยุบ (`abolishedAreas()`) | **1,583** = ระดับเขต/อำเภอ 80 + ตำบล 1,503 (ไม่มีระดับจังหวัด) |
| ที่มาของ successors | `notice` 111 · `name` 1,071 · `null` 401 (ไม่มี successor ทั้ง 401) |
| ถูกแทนด้วยมากกว่า 1 รหัส | 2 รายการ (เช่น `104701 บางนา` → `104702, 104703`) |

### พฤติกรรมที่ทดสอบแล้ว (ผลกระทบต่อการออกแบบ)

| อินพุต | ผล |
|---|---|
| `match({})` / ไม่ใส่ `subdistrict` | **throw `TypeError … reading 'replace'`** (ไม่ใช่คืน `[]`) |
| `match({subdistrict:''})` | `[]` |
| `match` ไม่ตรง | คืน `[]` โดย **ไม่บอกว่าช่องไหนทำให้ไม่ตรง** — ต้องไล่ผ่อนทีละช่องเอง |
| `postalCode` ใน `match` | กรองด้วยรหัสของตำบลนั้น ๆ แบบตรงตัว: `เกาะพะงัน+84280`→1, `+84360`→0; ตัดช่องว่างหน้า-หลังให้ (`' 84000'`→1) แต่ **เลขไทยไม่ผ่าน** (`'๘๔๐๐๐'`→0) |
| ชื่อไทยหน้า/หลัง | รับ `ต.` `อ.` `จ.` `จังหวัด` `เขต` `เมือง`: `{ตลาด, อ.เมือง, จ.สุราษฎร์ธานี}`→1 |
| Bangkok | `กรุงเทพ` ✓, `Bangkok` ✓, `กทม` ✓, `กทม.` ✓ แต่ **`กรุงเทพฯ` ✗ (0)** → `normalize()` ต้องแปลง `ฯ` เอง |
| ชื่ออังกฤษ | `{Phra Borom Maha Ratchawang, Bangkok}`→1 แต่ prefix อังกฤษ `Tambon Talat` ✗ (0) → `normalize()` ต้องตัดเอง |
| สะกดผิด | `match`/`search` ไม่ทนสะกดผิด (`พระบรมมหาราชวง`→0) — fuzzy เป็นหน้าที่ของเรา |
| `byPostalCode` | รับ `string` เท่านั้น: ส่ง number→`[]`, `' 84280 '`→`[]` (ไม่ trim) |
| `byPostalCode('58130')` | 10 ตำบล, `abc`/`00000` → `[]` |
| ตำบลที่ถูกยุบแต่ชื่อยังมีใช้ | `matchAbolished({subdistrict:'บางนา'})` → `[100904 (parent 1009, basis null), 104701 (parent 1047, basis notice)]` — คืนหลายรายการ ต้องกรองด้วย district/province |
| ประสิทธิภาพ | เรียก `match` ครั้งแรก ≈ 11.8 ms (สร้างดัชนี) หลังจากนั้น ≈ 0.005 ms/ครั้ง |

`dataVersion` = `'2026.10.23'` (string, รูป `YYYY.M.D`) — ใช้เป็นค่า `CheckResult.dataVersion` ได้ตรง ๆ

---

## Q3. สัญญาอนุญาต: ใช้ข้อมูล CC BY 4.0 ในแพ็กเกจ MIT

ข้อเท็จจริง (จาก `LICENSE`, `NOTICE`, README ของแพ็กเกจ; `gh api repos/GeoThai/data` → `CC-BY-4.0`):
- โค้ดของ `@geothai/core` = MIT; ข้อมูล = CC BY 4.0 © 2026 Pongsakorn Thipayanate (GeoThai/data)
- README ของเขาขอ: *"If you show the data, credit 'GeoThai'. Source credits and the license of thailand-geography-json are in NOTICE."*
- `NOTICE` ระบุแหล่งต้นทาง: กรมการปกครอง (DOPA), ไปรษณีย์ไทย (รหัสไปรษณีย์ส่วนหนึ่ง, สมุดรหัส 2558), thailand-geography-json © Joe Takara (MIT — ต้องคง copyright + permission notice เมื่อแจกจ่ายสำเนาส่วนสำคัญ)

สิ่งที่ต้องทำ (ข้อเสนอ; ไม่ใช่คำปรึกษากฎหมาย):
1. **แพ็กเกจเราไม่ bundle ข้อมูล** แต่ประกาศ `@geothai/core` เป็น dependency — ผู้ใช้ติดตั้งข้อมูลมาพร้อม `NOTICE` ของเขาเอง ภาระหลักจึงเป็น "ให้เครดิตเมื่อแสดงข้อมูล"
2. **หน้าเว็บสาธิต (tac-web) bundle ข้อมูลลงใน JS ที่แจกจ่าย** → ต้องให้เครดิตบนหน้าเว็บ (footer) และแนบ NOTICE/ลิงก์ไปยังแหล่งต้นทาง
3. benchmark/ผลลัพธ์ที่แสดงชื่อพื้นที่จริง ถือเป็นการ "แสดงข้อมูล" → README ต้องมีเครดิต
4. ข้อความเครดิตที่เสนอ (ใส่ใน README หัวข้อ Attribution และ footer ของเว็บ):

   > Address data © 2026 Pongsakorn Thipayanate ("GeoThai"), licensed under CC BY 4.0
   > (https://creativecommons.org/licenses/by/4.0/), via https://github.com/GeoThai/data and the
   > `@geothai/core` package. Underlying sources: Department of Provincial Administration (DOPA),
   > Thailand Post, and thailand-geography-json © Joe Takara (MIT). Changes: none to the data;
   > this tool reads it and reports inconsistencies.

   (CC BY 4.0 §3(a): ระบุผู้สร้าง, ประกาศลิขสิทธิ์, ลิงก์ไปสัญญาอนุญาต, แจ้งว่ามีการแก้ไขหรือไม่, ลิงก์ไปแหล่งต้นทางตามที่เหมาะสม)
5. อย่าทำให้เข้าใจว่า GeoThai รับรองโปรเจกต์นี้ (CC BY §2(a)(6))
6. ถ้า **ไม่ได้แก้ข้อมูล** ไม่มีข้อกำหนด ShareAlike (CC BY 4.0 ไม่มี SA) — สัญญาอนุญาต MIT ของเราใช้กับโค้ดของเราได้
7. `package.json` ของเรา: `"license": "MIT"`; ไฟล์ `NOTICE` ในรีโปควรคัดลอกข้อความเครดิตข้างต้น

---

## ผลกระทบต่อแผน (ต้องแก้ก่อนให้ tac-scaffold/tac-validate เริ่ม)

1. **PLAN.md §3 ฟีเจอร์ 1 ยกตัวอย่างผิด**: "รหัสไปรษณีย์ 58130 ไม่ตรงกับตำบลแม่แดด" — จากข้อมูลจริง `match({subdistrict:'แม่แดด'})` → มีตำบลเดียว รหัส `502502` (อ.กัลยาณิวัฒนา เชียงใหม่) และใช้รหัสไปรษณีย์ **58130** พอดี จึง **ไม่ใช่ตัวอย่างของข้อผิดพลาด** ใช้ตัวอย่างอื่นแทน เช่น `เกาะพะงัน / สุราษฎร์ธานี / 84360` (ตำบลเกาะพะงัน ใช้ 84280; 84360 เป็นของเกาะเต่า) (แก้ใน PLAN.md แล้ว)
2. `match()` **ต้องมี `subdistrict`** และ throw เมื่อขาด → `validate.ts` ต้องดูแลกรณีช่องตำบลว่าง (เช่น postalCode+district ล้วน) ด้วย `byPostalCode`/`districts`/`subdistricts` เอง และห้ามเรียก `match` โดยไม่มี subdistrict (ข้อ "fill missing" ของ feature 6)
3. `match()` คืน `[]` โดยไม่บอกสาเหตุ → การทำ PARENT_MISMATCH/POSTAL_CODE_MISMATCH ต้องไล่ผ่อนทีละช่อง (ทิ้ง postalCode, ทิ้ง district, ทิ้ง province) แล้วดูว่าช่องไหนทำให้ผลเปลี่ยน
4. `normalize()` ต้องจัดการเอง (ยืนยันแล้วว่า core ไม่ทำ): `กรุงเทพฯ`, เลขไทยในรหัสไปรษณีย์, prefix อังกฤษ (`Tambon`, `Amphoe`, `Changwat` …); `byPostalCode` ไม่ trim
5. ชื่ออำเภอใน Bangkok ในข้อมูลมีคำ "เขต" นำหน้า (`เขตพระนคร`) แต่ตำบลไม่มี "แขวง" นำหน้า — `data.ts` ต้องทำดัชนีบน "ชื่อหลัง strip prefix" ทั้งสองฝั่ง
6. `successors_basis: null` (401 รายการ) = ไม่มี successor → ตามกฎ tac-abolished ต้อง report only; `name` (1,071) = จำกัด confidence ต่ำกว่า threshold; มีแค่ `notice` (111) เท่านั้นที่ auto-correct ได้ — จำนวนที่แก้อัตโนมัติได้จึงน้อยมาก ควรบอกใน README
7. คู่แข่ง (ข้อ Q1) ต้องอยู่ใน README ส่วน "ต่างจากเดิมอย่างไร" และ `thai-address-sdk` เป็นกรณีอ้างอิงที่ดีสำหรับ bench: ใส่ชุดอินพุตเดียวกัน (แม่แดด/แม่ริม, เกาะพะงัน+84360) แล้วโชว์ว่าเราไม่แก้เงียบ ๆ (ถ้าจะอ้าง ให้รันจริงและบันทึกคำสั่ง ตามข้อ 12)

## วิธีทำซ้ำ

```sh
mkdir scratch && cd scratch && npm init -y && npm i --ignore-scripts @geothai/core
node -e "import('@geothai/core').then(c=>console.log(c.dataVersion, c.provinces().length))"
npm i --ignore-scripts thai-address-sdk thai-address-universal   # คู่แข่งที่ทับซ้อน
npm view thai-address-check name   # E404 = ว่าง (2026-11-25)
```
