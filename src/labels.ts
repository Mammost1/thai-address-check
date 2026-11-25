/**
 * Names of the four address fields for human-readable messages. Thai messages must use the Thai
 * name and English messages the English one; a field id such as 'subdistrict' never appears in a
 * Thai sentence.
 */
import type { Field } from './types'

/** Thai names of the address fields, as the dataset's own levels are called. */
export const LABEL_TH: Readonly<Record<Field, string>> = {
  province: 'จังหวัด',
  district: 'อำเภอ/เขต',
  subdistrict: 'ตำบล/แขวง',
  postalCode: 'รหัสไปรษณีย์',
}

/** English names of the address fields. */
export const LABEL_EN: Readonly<Record<Field, string>> = {
  province: 'province',
  district: 'district',
  subdistrict: 'subdistrict',
  postalCode: 'postal code',
}
