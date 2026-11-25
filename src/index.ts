/**
 * thai-address-check: check Thai addresses field by field, explain what is wrong in Thai and
 * English, and fix only when the evidence is strong. Data: @geothai/core (CC BY 4.0, GeoThai).
 */
export { check, checkMany } from './check'
export { dataVersion, listAddresses } from './export'
export { normalize } from './normalize'
export type {
  AddressInput,
  AddressRow,
  CheckOptions,
  CheckResult,
  Field,
  Finding,
  FindingCode,
  NormalizedAddress,
  ResolvedAddress,
  Severity,
  Status,
  Suggestion,
} from './types'
