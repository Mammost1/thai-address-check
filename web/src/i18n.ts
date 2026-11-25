import type { Field, FindingCode, Severity, Status } from 'thai-address-check'

export type Lang = 'th' | 'en'

export const FIELD_LABEL: Record<Field, Record<Lang, string>> = {
  province: { th: 'จังหวัด', en: 'Province' },
  district: { th: 'อำเภอ / เขต', en: 'District' },
  subdistrict: { th: 'ตำบล / แขวง', en: 'Subdistrict' },
  postalCode: { th: 'รหัสไปรษณีย์', en: 'Postal code' },
}

export const STATUS_LABEL: Record<Status, Record<Lang, string>> = {
  valid: { th: 'ถูกต้อง', en: 'Valid' },
  corrected: { th: 'แก้ให้แล้ว', en: 'Corrected' },
  ambiguous: { th: 'ต้องเลือกเพิ่ม', en: 'Needs a choice' },
  invalid: { th: 'ไม่ถูกต้อง', en: 'Invalid' },
}

export const STATUS_HINT: Record<Status, Record<Lang, string>> = {
  valid: { th: 'ทุกช่องตรงกับที่อยู่ปัจจุบันหนึ่งแห่ง', en: 'Every field fits one current address.' },
  corrected: {
    th: 'แก้หรือเติมให้เฉพาะจุดที่หลักฐานชัด ตรวจดูรายการด้านล่างก่อนใช้',
    en: 'Fixed or filled only where the evidence is strong. Review the list below before using it.',
  },
  ambiguous: {
    th: 'มีที่อยู่ปัจจุบันมากกว่าหนึ่งแห่งที่เข้ากันได้ ต้องมีข้อมูลเพิ่มเพื่อเลือก',
    en: 'More than one current address fits. Another field is needed to pick one.',
  },
  invalid: { th: 'มีช่องที่ขัดกันหรือหาไม่พบ ดูรายละเอียดด้านล่าง', en: 'Some fields conflict or were not found. See below.' },
}

export const SEVERITY_LABEL: Record<Severity, Record<Lang, string>> = {
  error: { th: 'ผิด', en: 'Error' },
  warning: { th: 'ควรตรวจ', en: 'Check' },
  info: { th: 'แจ้งให้ทราบ', en: 'Note' },
}

export const FINDING_LABEL: Record<FindingCode, Record<Lang, string>> = {
  MISSING_FIELD: { th: 'ไม่ได้กรอก', en: 'Missing field' },
  UNKNOWN_NAME: { th: 'ไม่พบชื่อนี้', en: 'Unknown name' },
  MISSPELLED_NAME: { th: 'สะกดผิด', en: 'Misspelled' },
  PARENT_MISMATCH: { th: 'ไม่ได้อยู่ในพื้นที่นี้', en: 'Wrong parent' },
  POSTAL_CODE_MISMATCH: { th: 'รหัสไปรษณีย์ไม่ตรง', en: 'Postal code mismatch' },
  POSTAL_CODE_INVALID: { th: 'รหัสไปรษณีย์ใช้ไม่ได้', en: 'Invalid postal code' },
  ABOLISHED_AREA: { th: 'พื้นที่ถูกยุบ', en: 'Abolished area' },
  AMBIGUOUS: { th: 'มีหลายคำตอบ', en: 'Ambiguous' },
  FORMAT_NORMALIZED: { th: 'จัดรูปแบบ', en: 'Formatting cleaned' },
}

const UI = {
  title: { th: 'ตรวจที่อยู่ไทย', en: 'Thai address check' },
  tagline: {
    th: 'ตรวจจังหวัด อำเภอ ตำบล และรหัสไปรษณีย์ทีละช่อง บอกว่าผิดตรงไหน และแก้ให้เฉพาะเมื่อมั่นใจ',
    en: 'Checks province, district, subdistrict and postal code field by field, says what is wrong, and fixes only when sure.',
  },
  privacy: {
    th: 'ทุกอย่างประมวลผลในเบราว์เซอร์นี้ ที่อยู่และไฟล์ไม่ถูกส่งออกจากเครื่อง',
    en: 'Everything runs in this browser. Addresses and files never leave your machine.',
  },
  modeSingle: { th: 'ตรวจทีละที่อยู่', en: 'One address' },
  modeFile: { th: 'ตรวจทั้งไฟล์ CSV', en: 'A CSV file' },
  examples: { th: 'ลองตัวอย่าง', en: 'Try an example' },
  clear: { th: 'ล้าง', en: 'Clear' },
  autoCorrect: { th: 'แก้ให้อัตโนมัติเมื่อมั่นใจ', en: 'Auto-correct when confident' },
  threshold: { th: 'ความมั่นใจขั้นต่ำที่จะแก้ให้', en: 'Minimum confidence to correct' },
  emptyResult: {
    th: 'กรอกอย่างน้อยหนึ่งช่อง ผลจะขึ้นทันทีที่พิมพ์',
    en: 'Fill in at least one field. The result updates as you type.',
  },
  colField: { th: 'ช่อง', en: 'Field' },
  colGiven: { th: 'ที่กรอก', en: 'Given' },
  colChecked: { th: 'หลังตรวจ', en: 'Checked' },
  findings: { th: 'สิ่งที่พบ', en: 'Findings' },
  noFindings: { th: 'ไม่พบปัญหา', en: 'Nothing to report' },
  suggestions: { th: 'ค่าที่เสนอ', en: 'Suggestions' },
  use: { th: 'ใช้ค่านี้', en: 'Use this' },
  confidence: { th: 'ความมั่นใจ', en: 'confidence' },
  resolved: { th: 'ที่อยู่ปัจจุบันที่ตรงกัน', en: 'Matching current address' },
  changed: { th: 'เปลี่ยน', en: 'changed' },
  dropTitle: { th: 'วางไฟล์ CSV ที่นี่ หรือเลือกไฟล์', en: 'Drop a CSV file here, or choose one' },
  dropHint: {
    th: 'แถวแรกต้องเป็นหัวคอลัมน์ รองรับ UTF-8 และไฟล์ภาษาไทยจาก Excel รุ่นเก่า (TIS-620)',
    en: 'The first row must be the header. UTF-8 and older Thai Excel files (TIS-620) are supported.',
  },
  chooseFile: { th: 'เลือกไฟล์', en: 'Choose file' },
  sampleFile: { th: 'ใช้ไฟล์ตัวอย่าง', en: 'Use a sample file' },
  columns: { th: 'คอลัมน์ในไฟล์', en: 'Columns in the file' },
  notInFile: { th: '— ไม่มีในไฟล์ —', en: '— not in file —' },
  needColumn: {
    th: 'ต้องเลือกคอลัมน์ตำบลหรือรหัสไปรษณีย์อย่างน้อยหนึ่งคอลัมน์',
    en: 'Pick at least the subdistrict or the postal code column.',
  },
  run: { th: 'ตรวจไฟล์', en: 'Check file' },
  checking: { th: 'กำลังตรวจ', en: 'Checking' },
  rows: { th: 'แถว', en: 'rows' },
  download: { th: 'ดาวน์โหลดไฟล์ที่ตรวจแล้ว', en: 'Download checked file' },
  filterStatus: { th: 'สถานะ', en: 'Status' },
  filterFinding: { th: 'สิ่งที่พบ', en: 'Finding' },
  all: { th: 'ทั้งหมด', en: 'All' },
  line: { th: 'บรรทัด', en: 'Line' },
  showing: { th: 'แสดง', en: 'Showing' },
  of: { th: 'จาก', en: 'of' },
  firstRows: { th: 'แสดง 500 แถวแรกที่ตรงตัวกรอง ไฟล์ที่ดาวน์โหลดมีครบทุกแถว', en: 'Showing the first 500 matching rows. The download has every row.' },
  readError: { th: 'อ่านไฟล์ไม่ได้', en: 'Could not read the file' },
  emptyFile: { th: 'ไฟล์ไม่มีแถวข้อมูล', en: 'The file has no data rows' },
  encodingNote: { th: 'อ่านไฟล์เป็น TIS-620 (Windows-874)', en: 'Read the file as TIS-620 (Windows-874)' },
  langGroup: { th: 'ภาษา', en: 'Language' },
  modeGroup: { th: 'รูปแบบการตรวจ', en: 'Mode' },
  findingCount: { th: 'รายการที่พบ', en: 'findings' },
  checkedRows: { th: 'ตรวจแล้ว', en: 'Checked' },
  dataVersion: { th: 'ข้อมูลพื้นที่ฉบับ', en: 'Area data release' },
  noNetwork: { th: 'หน้านี้ไม่เรียกเครือข่ายหลังโหลดเสร็จ', en: 'This page makes no network requests after it loads.' },
} as const satisfies Record<string, Record<Lang, string>>

export type UiKey = keyof typeof UI

export function t(key: UiKey, lang: Lang): string {
  return UI[key][lang]
}
