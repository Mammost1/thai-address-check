/** Batch file checking (features 7 and 8): the library side of the `thai-address-check` command. */
export { applyMap, ColumnError, detectColumns, headerKey, looksLikeHeader, parseMapSpec } from './columns'
export type { ColumnMap, MapEntry } from './columns'
export { csvCell, csvLine, openCsv, sniffDelimiter, sniffEncoding } from './csv'
export type { CsvEncoding } from './csv'
export { ADDED_COLUMNS, checkFile, defaultOutputPath } from './run'
export type { CheckFileOptions, FileSummary } from './run'
export { readXlsxRows } from './xlsx'
