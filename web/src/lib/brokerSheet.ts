/** Reading and writing the Match my broker spreadsheet (.xlsx, .xls or .csv). The
 * spreadsheet library is loaded only when this is used, so other pages don't carry it. */

/** Cells of the file's first sheet, numbers kept as numbers. */
export async function readSheetFile(file: File): Promise<unknown[][]> {
  const XLSX = await import('xlsx')
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
  const wb = isCsv ? XLSX.read(await file.text(), { type: 'string', raw: false }) : XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
}

/** Saves the rows as an .xlsx file in the browser's downloads. */
export async function downloadSheet(rows: (string | number)[][], fileName: string) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 22 }, { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 8 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Positions')
  XLSX.writeFile(wb, fileName)
}
