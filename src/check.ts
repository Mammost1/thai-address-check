/**
 * The integration seam: `check()` runs normalize, then validate, fuzzy+suggest and abolished,
 * then decides the status. Each later task adds its call ONLY inside its own marked block
 * (docs/TASKS.md, module layout); everything outside the blocks belongs to tac-scaffold.
 */
import { checkAbolished } from './abolished'
import { dataVersion } from './data'
import { LABEL_EN, LABEL_TH } from './labels'
import { normalize } from './normalize'
import { suggest } from './suggest'
import type {
  AddressInput,
  CheckContext,
  CheckOptions,
  CheckResult,
  Field,
  Finding,
  NormalizedAddress,
  Status,
} from './types'
import { validate } from './validate'

const FIELDS: readonly Field[] = ['province', 'district', 'subdistrict', 'postalCode']

/** Defaults of `CheckOptions` (docs/TASKS.md, Global constraint 9 and the API contract). */
export const DEFAULT_OPTIONS: Readonly<Required<CheckOptions>> = Object.freeze({
  autoCorrectThreshold: 0.9,
  autoCorrect: true,
  maxSuggestions: 3,
})

function withDefaults(options: CheckOptions = {}): Required<CheckOptions> {
  const threshold = options.autoCorrectThreshold ?? DEFAULT_OPTIONS.autoCorrectThreshold
  const max = options.maxSuggestions ?? DEFAULT_OPTIONS.maxSuggestions
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new RangeError(`autoCorrectThreshold must be between 0 and 1, got ${threshold}`)
  }
  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError(`maxSuggestions must be a whole number >= 0, got ${max}`)
  }
  return { autoCorrectThreshold: threshold, autoCorrect: options.autoCorrect ?? DEFAULT_OPTIONS.autoCorrect, maxSuggestions: max }
}

function fieldsOf(a: AddressInput): AddressInput {
  const out: AddressInput = {}
  for (const f of FIELDS) if (a[f] !== undefined) out[f] = a[f]
  return out
}

/** One info finding per field whose formatting `normalize()` cleaned. */
function formatFindings(input: AddressInput, normalized: NormalizedAddress): Finding[] {
  const found: Finding[] = []
  for (const field of FIELDS) {
    const rules = normalized.applied[field]
    if (!rules || rules.length === 0) continue
    found.push({
      code: 'FORMAT_NORMALIZED',
      severity: 'info',
      fields: [field],
      message: {
        th: `ปรับรูปแบบการเขียนของช่อง${LABEL_TH[field]} (${rules.join(', ')}) ความหมายไม่เปลี่ยน`,
        en: `Cleaned the formatting of the ${LABEL_EN[field]} (${rules.join(', ')}); the meaning is unchanged.`,
      },
      detail: { given: input[field], normalized: normalized[field], rules: [...rules] },
    })
  }
  return found
}

function sameFields(a: AddressInput, b: AddressInput): boolean {
  return FIELDS.every((f) => a[f] === b[f])
}

/**
 * Status rules (docs/TASKS.md): an error finding other than AMBIGUOUS makes the address invalid;
 * several candidates make it ambiguous; exactly one candidate makes it valid, or corrected when
 * `output` differs from the normalized fields (a correction or a filled field was applied).
 */
function statusOf(ctx: CheckContext): Status {
  const blocking = ctx.findings.some((f) => f.severity === 'error' && f.code !== 'AMBIGUOUS')
  if (blocking) return 'invalid'
  if (ctx.candidates.length > 1) return 'ambiguous'
  if (ctx.candidates.length === 1) return sameFields(ctx.output, fieldsOf(ctx.normalized)) ? 'valid' : 'corrected'
  return 'invalid'
}

/**
 * Checks one address field by field: cleans its formatting, resolves it against the current
 * GeoThai data, reports every problem with a machine code and a Thai/English explanation, and
 * applies a correction only when the evidence clears `autoCorrectThreshold` with exactly one
 * candidate.
 *
 * @param input - Province, district, subdistrict and postal code as the caller has them.
 * @param options - Auto-correct threshold (default 0.9), whether to correct at all (default true),
 *   and how many suggestions per field to return (default 3).
 * @returns The status, the findings and suggestions, the corrected `output`, and the data version.
 * @throws RangeError when an option is out of range.
 */
export function check(input: AddressInput, options?: CheckOptions): CheckResult {
  const opts = withDefaults(options)
  const normalized = normalize(input)
  const ctx: CheckContext = {
    input: fieldsOf(input),
    normalized,
    options: opts,
    output: fieldsOf(normalized),
    findings: formatFindings(input, normalized),
    suggestions: [],
    candidates: [],
  }

  // <validate>
  validate(ctx)
  // </validate>

  // <fuzzy+suggest>
  suggest(ctx)
  // </fuzzy+suggest>

  // <abolished>
  checkAbolished(ctx)
  // </abolished>

  const status = statusOf(ctx)
  const result: CheckResult = {
    status,
    input: ctx.input,
    normalized,
    output: ctx.output,
    findings: ctx.findings,
    suggestions: ctx.suggestions,
    dataVersion,
  }
  const only = ctx.candidates[0]
  if ((status === 'valid' || status === 'corrected') && only) result.resolved = only
  return result
}

/**
 * Checks many addresses lazily, one result per input in the same order. Options are
 * validated once, before the first input is read.
 *
 * @param inputs - Any iterable of addresses (an array, a generator, rows streamed from a file).
 * @param options - Same as `check()`.
 * @throws RangeError when an option is out of range.
 */
export function checkMany(inputs: Iterable<AddressInput>, options?: CheckOptions): Generator<CheckResult> {
  const opts = withDefaults(options)
  return (function* () {
    for (const input of inputs) yield check(input, opts)
  })()
}
