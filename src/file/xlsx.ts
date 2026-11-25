/**
 * XLSX in. Unlike CSV, an XLSX is a zip of XML that the reader loads as a whole, so memory grows
 * with the sheet; that is the cost of the format and is stated in the README.
 */
import { readSheet } from 'read-excel-file/node'

/**
 * Reads one sheet as rows of text. Numbers become their plain text (a postal code typed as the
 * number 10200 reads as '10200'), dates their ISO form, empty cells ''.
 *
 * @param path - The .xlsx file.
 * @param sheet - Sheet name or 1-based number; the first sheet by default.
 */
export async function readXlsxRows(path: string, sheet?: string): Promise<string[][]> {
  const data = await (sheet === undefined
    ? readSheet(path)
    : readSheet(path, /^\d+$/.test(sheet) ? Number(sheet) : sheet))
  return data.map((row) =>
    row.map((cell) => {
      if (cell === null || cell === undefined) return ''
      if (cell instanceof Date) return cell.toISOString()
      return String(cell)
    }),
  )
}
