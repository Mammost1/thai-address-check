import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { FindingCode, Status } from 'thai-address-check'
import { checkRows, outputRows, summarize, type RowResult } from './lib/batch'
import { detectColumns, FIELDS, isUsable, type ColumnMap } from './lib/columns'
import { decodeText, parseCsv, toCsv } from './lib/csv'
import { FIELD_LABEL, FINDING_LABEL, STATUS_LABEL, t, type Lang, type UiKey } from './i18n'

interface Loaded {
  name: string
  header: string[]
  rows: string[][]
  encoding: 'utf-8' | 'windows-874'
}

const STATUSES: readonly Status[] = ['valid', 'corrected', 'ambiguous', 'invalid']
const SHOWN_ROWS = 500

/** A small sample built in the page (no download needed): one row per kind of result. */
const SAMPLE = [
  ['order_id', 'จังหวัด', 'อำเภอ', 'ตำบล', 'รหัสไปรษณีย์'],
  ['A-1001', 'สุราษฎร์ธานี', 'เกาะพะงัน', 'เกาะพะงัน', '84280'],
  ['A-1002', 'สุราษฎร์ธานี', 'เกาะพะงัน', 'เกาะพะงัน', '84360'],
  ['A-1003', 'เชียงใหม่', 'แม่ริม', 'แม่แดด', '50180'],
  ['A-1004', 'จ.สุราษฎร์ธาณี', 'อ.เกาะพะงัน', 'ต.เกาะพะงัน', '84280'],
  ['A-1005', 'กทม.', 'เขตบางนา', 'บางนา', ''],
  ['A-1006', '', '', 'ตลาด', '84000'],
  ['A-1007', 'กรุงเทพฯ', 'พระนคร', 'พระบรมมหาราชวัง', '๑๐๒๐๐'],
  ['A-1008', 'ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง', '40000'],
]

export function FileCheck({ lang }: { lang: Lang }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [map, setMap] = useState<ColumnMap>({})
  const [error, setError] = useState<UiKey | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [results, setResults] = useState<RowResult[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all')
  const [findingFilter, setFindingFilter] = useState<FindingCode | 'all'>('all')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // A file dropped outside the drop panel must not make the browser open it and leave the page.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => e.preventDefault()
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  const load = (name: string, text: string, encoding: Loaded['encoding']) => {
    const rows = parseCsv(text)
    setResults(null)
    setStatusFilter('all')
    setFindingFilter('all')
    if (rows.length < 2) {
      setLoaded(null)
      setError('emptyFile')
      return
    }
    const header = rows[0] as string[]
    setError(null)
    setLoaded({ name, header, rows, encoding })
    setMap(detectColumns(header))
  }

  const readFile = async (file: File) => {
    try {
      const { text, encoding } = decodeText(new Uint8Array(await file.arrayBuffer()))
      load(file.name, text, encoding)
    } catch {
      setLoaded(null)
      setError('readError')
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) void readFile(file)
  }

  const run = async () => {
    if (!loaded) return
    setResults(null)
    setProgress(0)
    const out = await checkRows(loaded.rows, map, {}, setProgress)
    setProgress(null)
    setResults(out)
  }

  const summary = useMemo(() => (results ? summarize(results) : null), [results])
  const filtered = useMemo(
    () =>
      (results ?? []).filter(
        (r) =>
          (statusFilter === 'all' || r.result.status === statusFilter) &&
          (findingFilter === 'all' || r.result.findings.some((f) => f.code === findingFilter)),
      ),
    [results, statusFilter, findingFilter],
  )

  const download = () => {
    if (!loaded || !results) return
    const blob = new Blob([toCsv(outputRows(loaded.header, results))], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = loaded.name.replace(/\.csv$/i, '') + '-checked.csv'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const dataRows = loaded ? loaded.rows.length - 1 : 0

  return (
    <div className="file">
      <p className="sr-only" role="status" aria-live="polite">
        {results ? `${t('checkedRows', lang)} ${results.length.toLocaleString()} ${t('rows', lang)}` : ''}
      </p>
      <section
        className={`panel drop${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <h2>{t('dropTitle', lang)}</h2>
        <p className="muted">{t('dropHint', lang)}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => inputRef.current?.click()}>
            {t('chooseFile', lang)}
          </button>
          <button type="button" onClick={() => load('sample.csv', toCsv(SAMPLE).slice(1), 'utf-8')}>
            {t('sampleFile', lang)}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void readFile(file)
              e.target.value = ''
            }}
          />
        </div>
        {error ? <p className="error" role="alert">{t(error, lang)}</p> : null}
      </section>

      {loaded ? (
        <section className="panel mapping">
          <div className="mapping-head">
            <h2>
              {loaded.name} <span className="muted num">· {dataRows.toLocaleString()} {t('rows', lang)}</span>
            </h2>
            {loaded.encoding === 'windows-874' ? <p className="muted">{t('encodingNote', lang)}</p> : null}
          </div>
          <h3>{t('columns', lang)}</h3>
          <div className="map-grid">
            {FIELDS.map((field) => (
              <label key={field} className="field">
                <span className="label">{FIELD_LABEL[field][lang]}</span>
                <select
                  value={map[field] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setMap((prev) => ({ ...prev, [field]: v === '' ? undefined : Number(v) }))
                  }}
                >
                  <option value="">{t('notInFile', lang)}</option>
                  {loaded.header.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h || `#${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {!isUsable(map) ? <p className="error">{t('needColumn', lang)}</p> : null}
          <div className="actions">
            <button type="button" className="primary" disabled={!isUsable(map) || progress !== null} onClick={() => void run()}>
              {progress !== null
                ? `${t('checking', lang)} ${progress.toLocaleString()} / ${dataRows.toLocaleString()}`
                : t('run', lang)}
            </button>
            {progress !== null ? (
              <progress max={dataRows} value={progress} aria-label={t('checking', lang)} />
            ) : null}
          </div>
        </section>
      ) : null}

      {results && summary && loaded ? (
        <section className="report">
          <div className="report-head">
            <div className="totals" role="group" aria-label={t('filterStatus', lang)}>
              <button
                type="button"
                className={`total${statusFilter === 'all' ? ' active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                <span className="n num">{summary.total.toLocaleString()}</span>
                <span className="label">{t('all', lang)}</span>
              </button>
              {STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`total total-${s}${statusFilter === s ? ' active' : ''}`}
                  onClick={() => setStatusFilter(s)}
                >
                  <span className="n num">{summary.byStatus[s].toLocaleString()}</span>
                  <span className="label">{STATUS_LABEL[s][lang]}</span>
                </button>
              ))}
            </div>
            <div className="report-tools">
              <label className="field inline">
                <span className="label">{t('filterFinding', lang)}</span>
                <select value={findingFilter} onChange={(e) => setFindingFilter(e.target.value as FindingCode | 'all')}>
                  <option value="all">{t('all', lang)}</option>
                  {(Object.keys(summary.byFinding) as FindingCode[])
                    .filter((code) => code !== 'FORMAT_NORMALIZED')
                    .map((code) => (
                    <option key={code} value={code}>
                      {FINDING_LABEL[code][lang]} ({summary.byFinding[code]?.toLocaleString()})
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="primary" onClick={download}>
                {t('download', lang)}
              </button>
            </div>
          </div>

          <p className="muted small">
            {t('showing', lang)} {Math.min(filtered.length, SHOWN_ROWS).toLocaleString()} {t('of', lang)}{' '}
            {filtered.length.toLocaleString()}
            {filtered.length > SHOWN_ROWS ? ` · ${t('firstRows', lang)}` : ''}
          </p>

          <div className="table-wrap">
            <table className="rows">
              <thead>
                <tr>
                  <th scope="col">{t('line', lang)}</th>
                  <th scope="col">{t('filterStatus', lang)}</th>
                  {FIELDS.map((f) => (
                    <th key={f} scope="col">
                      {FIELD_LABEL[f][lang]}
                    </th>
                  ))}
                  <th scope="col">{t('findings', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, SHOWN_ROWS).map(({ line, result }) => (
                  <tr key={line}>
                    <td className="num muted">{line}</td>
                    <td>
                      <span className={`status small status-${result.status}`}>{STATUS_LABEL[result.status][lang]}</span>
                    </td>
                    {FIELDS.map((f) => {
                      const given = result.input[f] ?? ''
                      const out = result.output[f] ?? ''
                      const changed = given.trim() !== out
                      return (
                        <td key={f}>
                          {changed && out ? (
                            <>
                              <s className="muted">{given}</s> <span className="changed">{out}</span>
                            </>
                          ) : (
                            given
                          )}
                        </td>
                      )
                    })}
                    <td className="codes">
                      {[...new Set(result.findings.filter((x) => x.code !== 'FORMAT_NORMALIZED').map((x) => x.code))]
                        .map((c) => FINDING_LABEL[c][lang])
                        .join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
