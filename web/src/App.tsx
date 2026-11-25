import { useEffect, useState } from 'react'
import { check } from 'thai-address-check'
import { FileCheck } from './FileCheck'
import { t, type Lang } from './i18n'
import { SingleCheck } from './SingleCheck'

type Mode = 'single' | 'file'

const DATA_VERSION = check({}).dataVersion

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('tac-lang')
    if (saved === 'th' || saved === 'en') return saved
  } catch {
    // Storage can be blocked; Thai is the default.
  }
  return 'th'
}

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang)
  const [mode, setMode] = useState<Mode>('single')

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${t('title', lang)} · thai-address-check`
    try {
      localStorage.setItem('tac-lang', lang)
    } catch {
      // Not saved; the toggle still works for this visit.
    }
  }, [lang])

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <h1>{t('title', lang)}</h1>
          <p className="tagline">{t('tagline', lang)}</p>
        </div>
        <div className="lang" role="group" aria-label={t('langGroup', lang)}>
          <button type="button" aria-pressed={lang === 'th'} onClick={() => setLang('th')}>
            ไทย
          </button>
          <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
            English
          </button>
        </div>
      </header>

      <p className="privacy">{t('privacy', lang)}</p>

      <nav className="modes" aria-label={t('modeGroup', lang)}>
        <button type="button" aria-pressed={mode === 'single'} onClick={() => setMode('single')}>
          {t('modeSingle', lang)}
        </button>
        <button type="button" aria-pressed={mode === 'file'} onClick={() => setMode('file')}>
          {t('modeFile', lang)}
        </button>
      </nav>

      {/* Both modes stay mounted so a loaded file and its results survive a mode switch. */}
      <main>
        <div hidden={mode !== 'single'}>
          <SingleCheck lang={lang} />
        </div>
        <div hidden={mode !== 'file'}>
          <FileCheck lang={lang} />
        </div>
      </main>

      <footer className="credit">
        <p>
          {t('dataVersion', lang)} <span className="num">{DATA_VERSION}</span> · {t('noNetwork', lang)}
        </p>
        <p>
          Address data © 2026 Pongsakorn Thipayanate (“GeoThai”), licensed under{' '}
          <a href="https://creativecommons.org/licenses/by/4.0/" rel="noreferrer">
            CC BY 4.0
          </a>
          , via <a href="https://github.com/GeoThai/data" rel="noreferrer">github.com/GeoThai/data</a> and the{' '}
          <code>@geothai/core</code> package. Underlying sources: Department of Provincial Administration (DOPA), Thailand
          Post, and thailand-geography-json © Joe Takara (MIT). Changes: none to the data; this tool reads it and reports
          inconsistencies. GeoThai does not endorse this tool. <a href="./NOTICE-geothai.txt">NOTICE</a>
        </p>
      </footer>
    </div>
  )
}
