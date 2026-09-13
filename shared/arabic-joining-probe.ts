import arAlBukhala from '../corpora/ar-al-bukhala.txt' with { type: 'text' }
import arRisalatAlGhufranPart1 from '../corpora/ar-risalat-al-ghufran-part-1.txt' with { type: 'text' }
import urChughd from '../corpora/ur-chughd.txt' with { type: 'text' }
import type { BrowserEnvironmentReport } from './browser-environment.ts'
import type { NativeRect } from '../tests/wrapping/types.ts'

// Inputs, Canvas recipes and scoring for the Firefox joined-Arabic probe. The
// page supplies Canvas widths and native geometry; nothing here reads the DOM,
// so the runner and the unit test use the same definitions.

export type ProbeFont = { label: string; font: string; fixture: string | null; corpus: boolean }
export type ProbeWord = { family: string; text: string; parts?: string[] }
type ProbeUnit = { text: string; start: number; end: number }
export type ProbeSite = {
  offset: number
  // Graphemes before the site.
  units: number
  kind: 'shy' | 'grapheme' | 'part'
  joins: boolean
  // The letters on each side with any controls between them, soft hyphens
  // deleted: the pair the additivity gate measures.
  left: string
  right: string
}
export type WordPlan = { text: string; units: ProbeUnit[]; sites: ProbeSite[] }
export type CanvasContextKind = 'offscreen' | 'connected' | 'legibility' | 'kerning-normal' | 'kerning-none'
export type Measure = (recipe: string, context: CanvasContextKind, direction: CanvasDirection, text: string) => number
export type ProbeRow = {
  font: string
  direction: 'ltr' | 'rtl'
  word: number
  measure: 'whole' | 'head' | 'tail' | 'hyphen-normal' | 'hyphen-pre-wrap' | 'emergency'
  site: ProbeSite['kind'] | 'whole'
  offset: number
  units: number
  joins: boolean
  // The whole-word Range agrees with the Canvas run within one app unit.
  trusted: boolean
  // A Range width or a threshold width; null when the search found none.
  native: number | null
  predictions: Record<string, number>
  residual: number | null
  wordResidual: number
  rects?: NativeRect[]
  lineCount?: number
  firstLineEnd?: number
  bracket?: Array<{ recipe: string; delta: number; lineCount: number; fits: boolean | null }>
}
export type ProbeQuery = {
  context: CanvasContextKind
  direction: CanvasDirection
  text: string
  width: number
  left: number
  right: number
  recipes: string[]
}
export type ArabicJoiningProbeReport = { requestId: string } & (
  | {
    status: 'ready'
    environment: BrowserEnvironmentReport
    font: string
    batch: number
    from: number
    to: number
    total: number
    hyphens: { u2010: number; minus: number }
    features: Record<string, boolean>
    words: Array<ProbeWord & { index: number; features: string[] }>
    rows: ProbeRow[]
    queries: ProbeQuery[]
  }
  | { status: 'error'; message: string; environment?: BrowserEnvironmentReport }
)
export type RecipeTally = {
  pass: number
  fail: number
  thresholdPass: number
  thresholdFail: number
  skipped: number
  accepted: number
  falseAccepts: number
  falseRejects: number
  bracketAgree: number
  bracketTotal: number
}

export const BATCH_WORDS = 200
const SHY = '\u00AD'
const ZWJ = '\u200D'

// Summary order. `isolated` is main's Firefox basis: each grapheme measured alone.
export const RECIPES = [
  'isolated',
  // Recipe 1: the unbroken run with soft hyphens deleted; 1b keeps them.
  'r1-run', 'r1b-shy-kept',
  // Recipe 1's head at a soft hyphen: `head + ZWJ` in an rtl canvas. 2c is the
  // same query at every other boundary. Tails put the ZWJ first.
  'r2-head-zwj', 'r2c-prefix-zwj',
  // Recipe 2: each grapheme with a ZWJ on every joined side, rtl, summed.
  'r2b-grapheme-forms',
  // Recipe 3: W(L+ZWJ) + W(ZWJ+R) − W(L+R) per site. It predicts nothing; it gates.
  'r3-gate',
  // Negative control: the run minus the other side's ZWJ query.
  'r4-complement',
  // Canvas controls: an ltr ZWJ query, a connected lang=en canvas, textRendering and fontKerning.
  'r7-ltr-zwj', 'r7-connected', 'r7-legibility', 'r7-kerning-normal', 'r7-kerning-none',
]

// Joined recipes apply only where the gate proves the partition: the site's own
// pair for a ZWJ query, every site of the word for summed grapheme forms.
export const GATED_RECIPES: Record<string, 'site' | 'word'> = {
  'r2-head-zwj': 'site',
  'r2c-prefix-zwj': 'site',
  'r2b-grapheme-forms': 'word',
}

// One Firefox app unit. The epsilon absorbs float noise at exact multiples.
export function withinTolerance(difference: number): boolean {
  return Math.abs(difference) <= 1 / 60 + 1e-9
}

// Arabic fixtures, installed faces, and two Latin faces without Arabic glyphs,
// where Firefox falls back. Corpus words run at 16px in the fixtures and Arial.
export const probeFonts: ProbeFont[] = [
  { label: 'amiri-16', font: '16px Amiri', fixture: 'Amiri', corpus: true },
  { label: 'amiri-24', font: '24px Amiri', fixture: 'Amiri', corpus: false },
  { label: 'naskh-16', font: '16px "Noto Naskh Arabic"', fixture: 'Noto Naskh Arabic', corpus: true },
  { label: 'naskh-24', font: '24px "Noto Naskh Arabic"', fixture: 'Noto Naskh Arabic', corpus: false },
  { label: 'nastaliq-16', font: '16px "Noto Nastaliq Urdu"', fixture: 'Noto Nastaliq Urdu', corpus: true },
  { label: 'nastaliq-24', font: '24px "Noto Nastaliq Urdu"', fixture: 'Noto Nastaliq Urdu', corpus: false },
  { label: 'arial-16', font: '16px Arial', fixture: null, corpus: true },
  { label: 'arial-24', font: '24px Arial', fixture: null, corpus: false },
  // Below Canvas's 20px optimize-speed band.
  { label: 'arial-12', font: '12px Arial', fixture: null, corpus: false },
  { label: 'times-16', font: '16px "Times New Roman"', fixture: null, corpus: false },
  // AAT font shaped through CoreText.
  { label: 'geeza-16', font: '16px "Geeza Pro"', fixture: null, corpus: false },
  { label: 'georgia-fallback-16', font: '16px Georgia', fixture: null, corpus: false },
  { label: 'shantell-fallback-16', font: '16px "Shantell Sans"', fixture: 'Shantell Sans', corpus: false },
]

const pairLetters = ['ب', 'ن', 'س', 'ع', 'ل', 'ه', 'ي', 'ک', 'گ']
const pairFollowers = [...pairLetters, 'ا', 'د', 'ر', 'و', 'ے']
const medialLetters = ['ب', 'ل', 'ه']
const witnesses = [
  'بببب', 'ولقد', 'سلام', 'سلامسلام',
  'لالالا', 'العربية', 'مكتبة',
  'كتابخانه', 'ب\u0650ب\u0650', 'أمون',
  // The suite witness first, then more soft hyphens inside joins.
  '\u200Bب\u00ADب', 'ب\u00ADب\u00ADب', 'سلا\u00ADم',
  'الل\u00ADغة', 'كتاب\u00ADخانه',
  // The three corpora contain no tatweel.
  'ب\u0640ب',
]
// Soft hyphen, ZWSP, WJ, ZWNBSP, ZWNJ, ZWJ, LRM, RLM, ALM and an empty RLE…PDF
// embedding between two behs.
const joinControls = ['\u00AD', '\u200B', '\u2060', '\uFEFF', '\u200C', '\u200D', '\u200E', '\u200F', '\u061C', '\u202B\u202C']
const corpora = [
  { id: 'ar-risalat-al-ghufran-part-1', text: arRisalatAlGhufranPart1, count: 200 },
  { id: 'ar-al-bukhala', text: arAlBukhala, count: 200 },
  { id: 'ur-chughd', text: urChughd, count: 100 },
]
const CORPUS_SEED = 0x5eed
const FEATURE_QUOTA = 10
const CORPUS_SHY_EVERY = 10
const sampledFeatures = ['voweled', 'lam-alef', 'hamza-seat']
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const arabicWordRe = /^[\p{Script=Arabic}\p{Mn}\u0640\u200C]+$/u
const excludedWordRe = /[\p{P}\p{N}\p{S}]|(?!\u200C)\p{Cf}/u

// DerivedJoiningType-17.0.0 dual-joining, right-joining and join-causing ranges
// from U+0620 to U+08C8 (Arabic, Syriac, NKo, Mandaic and the Arabic
// supplements), plus ZWJ. The probe has no other cursive script.
const joiningRanges: ReadonlyArray<readonly [number, number, 'D' | 'R' | 'C']> = [
  [0x620, 0x620, 'D'], [0x622, 0x625, 'R'], [0x626, 0x626, 'D'], [0x627, 0x627, 'R'], [0x628, 0x628, 'D'], [0x629, 0x629, 'R'],
  [0x62A, 0x62E, 'D'], [0x62F, 0x632, 'R'], [0x633, 0x63F, 'D'], [0x640, 0x640, 'C'], [0x641, 0x647, 'D'], [0x648, 0x648, 'R'],
  [0x649, 0x64A, 'D'], [0x66E, 0x66F, 'D'], [0x671, 0x673, 'R'], [0x675, 0x677, 'R'], [0x678, 0x687, 'D'], [0x688, 0x699, 'R'],
  [0x69A, 0x6BF, 'D'], [0x6C0, 0x6C0, 'R'], [0x6C1, 0x6C2, 'D'], [0x6C3, 0x6CB, 'R'], [0x6CC, 0x6CC, 'D'], [0x6CD, 0x6CD, 'R'],
  [0x6CE, 0x6CE, 'D'], [0x6CF, 0x6CF, 'R'], [0x6D0, 0x6D1, 'D'], [0x6D2, 0x6D3, 'R'], [0x6D5, 0x6D5, 'R'], [0x6EE, 0x6EF, 'R'],
  [0x6FA, 0x6FC, 'D'], [0x6FF, 0x6FF, 'D'], [0x710, 0x710, 'R'], [0x712, 0x714, 'D'], [0x715, 0x719, 'R'], [0x71A, 0x71D, 'D'],
  [0x71E, 0x71E, 'R'], [0x71F, 0x727, 'D'], [0x728, 0x728, 'R'], [0x729, 0x729, 'D'], [0x72A, 0x72A, 'R'], [0x72B, 0x72B, 'D'],
  [0x72C, 0x72C, 'R'], [0x72D, 0x72E, 'D'], [0x72F, 0x72F, 'R'], [0x74D, 0x74D, 'R'], [0x74E, 0x758, 'D'], [0x759, 0x75B, 'R'],
  [0x75C, 0x76A, 'D'], [0x76B, 0x76C, 'R'], [0x76D, 0x770, 'D'], [0x771, 0x771, 'R'], [0x772, 0x772, 'D'], [0x773, 0x774, 'R'],
  [0x775, 0x777, 'D'], [0x778, 0x779, 'R'], [0x77A, 0x77F, 'D'], [0x7CA, 0x7EA, 'D'], [0x7FA, 0x7FA, 'C'], [0x840, 0x840, 'R'],
  [0x841, 0x845, 'D'], [0x846, 0x847, 'R'], [0x848, 0x848, 'D'], [0x849, 0x849, 'R'], [0x84A, 0x853, 'D'], [0x854, 0x854, 'R'],
  [0x855, 0x855, 'D'], [0x856, 0x858, 'R'], [0x860, 0x860, 'D'], [0x862, 0x865, 'D'], [0x867, 0x867, 'R'], [0x868, 0x868, 'D'],
  [0x869, 0x86A, 'R'], [0x870, 0x882, 'R'], [0x883, 0x885, 'C'], [0x886, 0x886, 'D'], [0x889, 0x88D, 'D'], [0x88E, 0x88E, 'R'],
  [0x88F, 0x88F, 'D'], [0x8A0, 0x8A9, 'D'], [0x8AA, 0x8AC, 'R'], [0x8AE, 0x8AE, 'R'], [0x8AF, 0x8B0, 'D'], [0x8B1, 0x8B2, 'R'],
  [0x8B3, 0x8B8, 'D'], [0x8B9, 0x8B9, 'R'], [0x8BA, 0x8C8, 'D'], [0x200D, 0x200D, 'C'],
]
// Other Mn, Me and Cf characters are Transparent; Unicode lists these as Non_Joining.
const nonJoiningFormatRe = /[\u0600-\u0605\u06DD\u0890\u0891\u08E2\u200C\u2066-\u2069]/u
const transparentRe = /[\p{Mn}\p{Me}\p{Cf}]/u

function joiningType(char: string): 'D' | 'R' | 'C' | 'T' | 'U' {
  const codePoint = char.codePointAt(0)!
  for (let i = 0; i < joiningRanges.length; i++) {
    const range = joiningRanges[i]!
    if (codePoint >= range[0] && codePoint <= range[1]) return range[2]
  }
  return nonJoiningFormatRe.test(char) || !transparentRe.test(char) ? 'U' : 'T'
}

// A cursive join crosses `offset` when the last non-transparent character before
// it joins forward (D, C) and the first after it joins backward (D, R, C). Soft
// hyphens, ZWSP, WJ and bidi controls are transparent; ZWNJ is not.
function joinsAt(text: string, offset: number): boolean {
  const before = Array.from(text.slice(0, offset))
  let left = 'U'
  for (let i = before.length - 1; i >= 0; i--) {
    const type = joiningType(before[i]!)
    if (type !== 'T') {
      left = type
      break
    }
  }
  if (left !== 'D' && left !== 'C') return false
  const after = Array.from(text.slice(offset))
  for (let i = 0; i < after.length; i++) {
    const type = joiningType(after[i]!)
    if (type !== 'T') return type === 'D' || type === 'R' || type === 'C'
  }
  return false
}

function hasNonTransparent(text: string): boolean {
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i++) if (joiningType(chars[i]!) !== 'T') return true
  return false
}

function strip(text: string): string {
  return text.replaceAll(SHY, '')
}

function segmentUnits(text: string): ProbeUnit[] {
  return Array.from(graphemeSegmenter.segment(text), ({ segment, index }) => ({ text: segment, start: index, end: index + segment.length }))
}

export function wordFeatures(text: string): string[] {
  const features: string[] = []
  if (text.includes(SHY)) features.push('shy')
  if (/\p{Mn}/u.test(text)) features.push('voweled')
  if (/ل\p{Mn}*[آأإا]/u.test(text)) features.push('lam-alef')
  if (/[أؤإئ]/u.test(text)) features.push('hamza-seat')
  if (text.includes('\u0640')) features.push('tatweel')
  if (/[\u061C\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/u.test(text)) features.push('control')
  return features
}

// mulberry32: a fixed seed keeps every page load and the runner on one sample.
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Distinct letter-only words of 2-4, 5-7 and 8-12 graphemes, shuffled within each
// stratum and interleaved so any prefix stays stratified. A few words with each
// named feature come first.
function sampleCorpus(text: string, count: number, random: () => number): string[] {
  const strata: string[][] = [[], [], []]
  const seen = new Set<string>()
  const tokens = text.split(/\s+/u)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (seen.has(token)) continue
    seen.add(token)
    if (!arabicWordRe.test(token) || excludedWordRe.test(token)) continue
    const units = segmentUnits(token).length
    if (units < 2 || units > 12) continue
    strata[units <= 4 ? 0 : units <= 7 ? 1 : 2]!.push(token)
  }
  let longest = 0
  for (let s = 0; s < strata.length; s++) {
    const stratum = strata[s]!
    for (let i = stratum.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const swap = stratum[i]!
      stratum[i] = stratum[j]!
      stratum[j] = swap
    }
    longest = Math.max(longest, stratum.length)
  }
  const interleaved: string[] = []
  for (let i = 0; i < longest; i++) {
    for (let s = 0; s < strata.length; s++) if (i < strata[s]!.length) interleaved.push(strata[s]![i]!)
  }
  const selected: string[] = []
  const taken = new Set<string>()
  for (let f = 0; f < sampledFeatures.length; f++) {
    let found = 0
    for (let i = 0; i < interleaved.length && found < FEATURE_QUOTA && selected.length < count; i++) {
      const word = interleaved[i]!
      if (taken.has(word) || !wordFeatures(word).includes(sampledFeatures[f]!)) continue
      taken.add(word)
      selected.push(word)
      found++
    }
  }
  for (let i = 0; i < interleaved.length && selected.length < count; i++) {
    const word = interleaved[i]!
    if (taken.has(word)) continue
    taken.add(word)
    selected.push(word)
  }
  return selected
}

let corpusWords: ProbeWord[] | null = null

function getCorpusWords(): ProbeWord[] {
  if (corpusWords !== null) return corpusWords
  const random = createRandom(CORPUS_SEED)
  const words: ProbeWord[] = []
  for (let c = 0; c < corpora.length; c++) {
    const corpus = corpora[c]!
    const sample = sampleCorpus(corpus.text, corpus.count, random)
    for (let i = 0; i < sample.length; i++) words.push({ family: `corpus:${corpus.id}`, text: sample[i]! })
  }
  // A soft hyphen at the middle grapheme boundary of every tenth sampled word.
  const sampled = words.length
  for (let i = 0; i < sampled; i += CORPUS_SHY_EVERY) {
    const word = words[i]!
    const units = segmentUnits(word.text)
    const offset = units[units.length >> 1]!.start
    words.push({ family: word.family.replace('corpus:', 'corpus-shy:'), text: word.text.slice(0, offset) + SHY + word.text.slice(offset) })
  }
  corpusWords = words
  return words
}

// Witnesses and controls first, so a small --limit still covers them.
export function probeInputs(font: ProbeFont): ProbeWord[] {
  const words: ProbeWord[] = []
  for (let i = 0; i < witnesses.length; i++) words.push({ family: 'witness', text: witnesses[i]! })
  for (let i = 0; i < joinControls.length; i++) words.push({ family: 'control', text: `ب${joinControls[i]!}ب` })
  words.push(
    { family: 'rich-same', text: 'بب', parts: ['ب', 'ب'] },
    { family: 'rich-color', text: 'بب', parts: ['ب', 'ب'] },
  )
  // Every recipe must reduce to main's widths where nothing joins.
  const nonJoining = ['AV', 'office', 'אב']
  for (let i = 0; i < nonJoining.length; i++) words.push({ family: 'non-joining', text: nonJoining[i]! })
  for (let l = 0; l < pairLetters.length; l++) {
    for (let r = 0; r < pairFollowers.length; r++) words.push({ family: 'pair', text: pairLetters[l]! + pairFollowers[r]! })
  }
  for (let m = 0; m < medialLetters.length; m++) {
    for (let l = 0; l < pairLetters.length; l++) {
      for (let r = 0; r < pairFollowers.length; r++) words.push({ family: 'triple', text: pairLetters[l]! + medialLetters[m]! + pairFollowers[r]! })
    }
  }
  if (font.corpus) {
    const corpus = getCorpusWords()
    for (let i = 0; i < corpus.length; i++) words.push(corpus[i]!)
  }
  return words
}

// Probe sites: every interior grapheme boundary, once per soft hyphen (the
// boundaries before and after it are the same break), or the rich-item boundaries.
export function planWord(word: ProbeWord): WordPlan {
  const text = word.text
  const units = segmentUnits(text)
  const offsets: Array<{ offset: number; units: number; kind: ProbeSite['kind'] }> = []
  if (word.parts === undefined) {
    for (let i = 1; i < units.length; i++) {
      if (units[i - 1]!.text === SHY) continue
      offsets.push({ offset: units[i]!.start, units: i, kind: units[i]!.text === SHY ? 'shy' : 'grapheme' })
    }
  } else {
    let offset = 0
    for (let i = 0; i < word.parts.length - 1; i++) {
      offset += word.parts[i]!.length
      let before = 0
      while (before < units.length && units[before]!.end <= offset) before++
      offsets.push({ offset, units: before, kind: 'part' })
    }
  }
  const sites: ProbeSite[] = []
  for (let i = 0; i < offsets.length; i++) {
    const { offset, units: before, kind } = offsets[i]!
    let leftStart = 0
    for (let j = before - 1; j >= 0; j--) {
      if (!hasNonTransparent(units[j]!.text)) continue
      leftStart = units[j]!.start
      break
    }
    let rightEnd = text.length
    for (let j = before; j < units.length; j++) {
      if (!hasNonTransparent(units[j]!.text)) continue
      rightEnd = units[j]!.end
      break
    }
    sites.push({ offset, units: before, kind, joins: joinsAt(text, offset), left: strip(text.slice(leftStart, offset)), right: strip(text.slice(offset, rightEnd)) })
  }
  return { text, units, sites }
}

function isolatedSum(plan: WordPlan, from: number, to: number, measure: Measure): number {
  let sum = 0
  for (let i = 0; i < plan.units.length; i++) {
    const unit = plan.units[i]!
    const text = strip(unit.text)
    if (unit.start >= from && unit.end <= to && text.length > 0) sum += measure('isolated', 'offscreen', 'inherit', text)
  }
  return sum
}

// Firefox Canvas honours a ZWJ only with an rtl direction.
function formsSum(plan: WordPlan, from: number, to: number, measure: Measure): number {
  let sum = 0
  for (let i = 0; i < plan.units.length; i++) {
    const unit = plan.units[i]!
    const text = strip(unit.text)
    if (unit.start < from || unit.end > to || text.length === 0) continue
    const form = (joinsAt(plan.text, unit.start) ? ZWJ : '') + text + (joinsAt(plan.text, unit.end) ? ZWJ : '')
    sum += measure('r2b-grapheme-forms', 'offscreen', 'rtl', form)
  }
  return sum
}

export function predictWhole(plan: WordPlan, measure: Measure): Record<string, number> {
  const run = strip(plan.text)
  const predictions: Record<string, number> = {
    'isolated': isolatedSum(plan, 0, plan.text.length, measure),
    'r1-run': measure('r1-run', 'offscreen', 'inherit', run),
    'r2b-grapheme-forms': formsSum(plan, 0, plan.text.length, measure),
    'r7-connected': measure('r7-connected', 'connected', 'inherit', run),
    'r7-legibility': measure('r7-legibility', 'legibility', 'inherit', run),
    'r7-kerning-normal': measure('r7-kerning-normal', 'kerning-normal', 'inherit', run),
    'r7-kerning-none': measure('r7-kerning-none', 'kerning-none', 'inherit', run),
  }
  if (plan.text.includes(SHY)) predictions['r1b-shy-kept'] = measure('r1b-shy-kept', 'offscreen', 'inherit', plan.text)
  return predictions
}

export function predictSite(plan: WordPlan, site: ProbeSite, measure: Measure): { head: Record<string, number>; tail: Record<string, number>; residual: number } {
  const head = strip(plan.text.slice(0, site.offset))
  const tail = strip(plan.text.slice(site.offset))
  const join = site.joins ? ZWJ : ''
  const recipe = site.kind === 'shy' ? 'r2-head-zwj' : 'r2c-prefix-zwj'
  const zwjHead = measure(recipe, 'offscreen', 'rtl', head + join)
  const zwjTail = measure(recipe, 'offscreen', 'rtl', join + tail)
  const run = measure('r4-complement', 'offscreen', 'inherit', strip(plan.text))
  // The complement reuses the ZWJ queries; record that it needs them.
  measure('r4-complement', 'offscreen', 'rtl', head + join)
  measure('r4-complement', 'offscreen', 'rtl', join + tail)
  const residual =
    measure('r3-gate', 'offscreen', 'rtl', site.left + join) +
    measure('r3-gate', 'offscreen', 'rtl', join + site.right) -
    measure('r3-gate', 'offscreen', 'rtl', site.left + site.right)
  return {
    head: {
      'isolated': isolatedSum(plan, 0, site.offset, measure),
      [recipe]: zwjHead,
      'r2b-grapheme-forms': formsSum(plan, 0, site.offset, measure),
      'r4-complement': run - zwjTail,
      'r7-ltr-zwj': measure('r7-ltr-zwj', 'offscreen', 'ltr', head + join),
    },
    tail: {
      'isolated': isolatedSum(plan, site.offset, plan.text.length, measure),
      [recipe]: zwjTail,
      'r2b-grapheme-forms': formsSum(plan, site.offset, plan.text.length, measure),
      'r4-complement': run - zwjHead,
      'r7-ltr-zwj': measure('r7-ltr-zwj', 'offscreen', 'ltr', join + tail),
    },
    residual,
  }
}

export function createTally(): RecipeTally {
  return { pass: 0, fail: 0, thresholdPass: 0, thresholdFail: 0, skipped: 0, accepted: 0, falseAccepts: 0, falseRejects: 0, bracketAgree: 0, bracketTotal: 0 }
}

// A recipe passes an observation within one app unit. Rows whose whole-word
// Range and Canvas run disagree are skipped for partition scoring. The gate
// accepts a partition when its residual is within the same bound; an accepted
// partition whose recipe misses the native value is a false accept.
export function tallyRow(tallies: Map<string, RecipeTally>, row: ProbeRow): void {
  const recipes = Object.keys(row.predictions)
  for (let i = 0; i < recipes.length; i++) {
    const recipe = recipes[i]!
    const key = `${row.font} ${recipe}`
    let tally = tallies.get(key)
    if (tally === undefined) {
      tally = createTally()
      tallies.set(key, tally)
    }
    if (row.native === null || (!row.trusted && row.measure !== 'whole')) {
      tally.skipped++
      continue
    }
    const pass = withinTolerance(row.predictions[recipe]! - row.native)
    if (row.measure === 'whole' || row.measure === 'head' || row.measure === 'tail') {
      if (pass) tally.pass++
      else tally.fail++
    } else if (pass) tally.thresholdPass++
    else tally.thresholdFail++
    const gate = GATED_RECIPES[recipe]
    const residual = gate === 'site' ? row.residual : gate === 'word' ? row.wordResidual : null
    if (residual !== null) {
      if (withinTolerance(residual)) {
        tally.accepted++
        if (!pass) tally.falseAccepts++
      } else if (pass) tally.falseRejects++
    }
    const bracket = row.bracket ?? []
    for (let j = 0; j < bracket.length; j++) {
      const entry = bracket[j]!
      if (entry.recipe !== recipe || entry.fits === null) continue
      tally.bracketTotal++
      // The recipe predicts that the head fits at or above its threshold.
      if ((entry.delta > 0) === entry.fits) tally.bracketAgree++
    }
  }
}
