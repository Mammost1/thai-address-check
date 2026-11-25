import { useEffect, useMemo, useState } from 'react'
import { check, type AddressInput, type CheckResult, type Field, type Suggestion } from 'thai-address-check'
import { FIELDS } from './lib/columns'
import { FIELD_LABEL, FINDING_LABEL, SEVERITY_LABEL, STATUS_HINT, STATUS_LABEL, t, type Lang } from './i18n'

interface Example {
  label: Record<Lang, string>
  input: AddressInput
}

/** Real cases from docs/TASKS.md (A7) and the recon, one per kind of result. */
const EXAMPLES: readonly Example[] = [
  {
    label: { th: 'รหัสไปรษณีย์ไม่ตรง', en: 'Wrong postal code' },
    input: { province: 'สุราษฎร์ธานี', district: 'เกาะพะงัน', subdistrict: 'เกาะพะงัน', postalCode: '84360' },
  },
  {
    label: { th: 'ตำบลไม่ได้อยู่ในอำเภอนี้', en: 'Subdistrict in another district' },
    input: { province: 'เชียงใหม่', district: 'แม่ริม', subdistrict: 'แม่แดด' },
  },
  {
    label: { th: 'ชื่อจังหวัดสะกดผิด', en: 'Misspelled province' },
    input: { province: 'จ.สุราษฎร์ธาณี', district: 'อ.เกาะพะงัน', subdistrict: 'ต.เกาะพะงัน', postalCode: '84280' },
  },
  {
    label: { th: 'แขวงที่ถูกยุบ', en: 'Abolished subdistrict' },
    input: { province: 'กทม.', district: 'เขตบางนา', subdistrict: 'บางนา' },
  },
  {
    label: { th: 'มีแค่ตำบลกับรหัสไปรษณีย์', en: 'Only subdistrict and postal code' },
    input: { subdistrict: 'ตลาด', postalCode: '84000' },
  },
]

const EMPTY: AddressInput = {}

function percent(x: number): string {
  return `${Math.round(x * 100)}%`
}

export function SingleCheck({ lang }: { lang: Lang }) {
  const [fields, setFields] = useState<AddressInput>(EXAMPLES[0]?.input ?? EMPTY)
  const [autoCorrect, setAutoCorrect] = useState(true)
  const [threshold, setThreshold] = useState(0.9)

  const result = useMemo<CheckResult | null>(() => {
    const hasAny = FIELDS.some((f) => (fields[f] ?? '').trim() !== '')
    return hasAny ? check(fields, { autoCorrect, autoCorrectThreshold: threshold }) : null
  }, [fields, autoCorrect, threshold])

  // Screen readers hear only a short summary, and only once typing pauses (review F2).
  const summary = result
    ? `${STATUS_LABEL[result.status][lang]} · ${result.findings.filter((f) => f.code !== 'FORMAT_NORMALIZED').length} ${t('findingCount', lang)}`
    : ''
  const [announced, setAnnounced] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(summary), 600)
    return () => clearTimeout(timer)
  }, [summary])

  const setField = (field: Field, value: string) => setFields((prev) => ({ ...prev, [field]: value }))
  const applySuggestion = (s: Suggestion) => setField(s.field, s.to)

  return (
    <div className="single">
      <section className="panel form" aria-label={t('modeSingle', lang)}>
        {FIELDS.map((field) => (
          <label key={field} className="field">
            <span className="label">{FIELD_LABEL[field][lang]}</span>
            <input
              type="text"
              value={fields[field] ?? ''}
              inputMode={field === 'postalCode' ? 'numeric' : 'text'}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setField(field, e.target.value)}
            />
          </label>
        ))}

        <div className="options">
          <label className="check">
            <input type="checkbox" checked={autoCorrect} onChange={(e) => setAutoCorrect(e.target.checked)} />
            <span>{t('autoCorrect', lang)}</span>
          </label>
          <label className="range">
            <span className="label">
              {t('threshold', lang)} <strong className="num">{percent(threshold)}</strong>
            </span>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={threshold}
              disabled={!autoCorrect}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
        </div>

        <div className="examples">
          <span className="label">{t('examples', lang)}</span>
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button key={ex.label.en} type="button" className="chip" onClick={() => setFields(ex.input)}>
                {ex.label[lang]}
              </button>
            ))}
            <button type="button" className="chip ghost" onClick={() => setFields(EMPTY)}>
              {t('clear', lang)}
            </button>
          </div>
        </div>
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {announced}
      </p>
      <section className="result">
        {result ? <ResultView result={result} lang={lang} onUse={applySuggestion} /> : <p className="empty">{t('emptyResult', lang)}</p>}
      </section>
    </div>
  )
}

function ResultView({ result, lang, onUse }: { result: CheckResult; lang: Lang; onUse: (s: Suggestion) => void }) {
  const findings = result.findings
  return (
    <>
      <header className="verdict">
        <span className={`status status-${result.status}`}>{STATUS_LABEL[result.status][lang]}</span>
        <p>{STATUS_HINT[result.status][lang]}</p>
      </header>

      <table className="compare">
        <thead>
          <tr>
            <th scope="col">{t('colField', lang)}</th>
            <th scope="col">{t('colGiven', lang)}</th>
            <th scope="col">{t('colChecked', lang)}</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map((field) => {
            const given = result.input[field] ?? ''
            const checked = result.output[field] ?? ''
            const changed = given.trim() !== checked
            return (
              <tr key={field}>
                <th scope="row">{FIELD_LABEL[field][lang]}</th>
                <td>{given || <span className="muted">—</span>}</td>
                <td className={changed ? 'changed' : undefined}>
                  {checked || <span className="muted">—</span>}
                  {changed && checked ? <span className="sr-only"> ({t('changed', lang)})</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {result.resolved ? (
        <div className="resolved">
          <h3>{t('resolved', lang)}</h3>
          <p>
            {lang === 'th'
              ? `${result.resolved.subdistrict.th} · ${result.resolved.district.th} · ${result.resolved.province.th}`
              : `${result.resolved.subdistrict.en}, ${result.resolved.district.en}, ${result.resolved.province.en}`}{' '}
            <span className="num">{result.resolved.postalCodes.join(', ')}</span>
          </p>
          <p className="code">
            {result.resolved.subdistrictCode} / {result.resolved.districtCode} / {result.resolved.provinceCode}
          </p>
        </div>
      ) : null}

      <h3>{t('findings', lang)}</h3>
      {findings.length === 0 ? (
        <p className="muted">{t('noFindings', lang)}</p>
      ) : (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={`${f.code}-${i}`} className={`finding sev-${f.severity}`}>
              <div className="finding-head">
                <span className="sev">{SEVERITY_LABEL[f.severity][lang]}</span>
                <strong>{FINDING_LABEL[f.code][lang]}</strong>
                <span className="fields">{f.fields.map((x) => FIELD_LABEL[x][lang]).join(', ')}</span>
                <code>{f.code}</code>
              </div>
              <p>{f.message[lang]}</p>
            </li>
          ))}
        </ul>
      )}

      {result.suggestions.length > 0 ? (
        <>
          <h3>{t('suggestions', lang)}</h3>
          <ul className="suggestions">
            {result.suggestions.map((s, i) => (
              <li key={`${s.field}-${s.to}-${i}`}>
                <span className="label">{FIELD_LABEL[s.field][lang]}</span>
                <span className="to">{s.to}</span>
                <span className="conf num" title={t('confidence', lang)}>
                  {percent(s.confidence)}
                </span>
                <span className="reason">{FINDING_LABEL[s.reason][lang]}</span>
                <button type="button" className="use" onClick={() => onUse(s)} disabled={result.input[s.field] === s.to}>
                  {t('use', lang)}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  )
}
