import { expect, test } from 'bun:test'
import {
  BATCH_WORDS, createTally, planWord, predictSite, probeFonts, probeInputs, tallyRow, wordFeatures,
  type Measure, type ProbeRow, type RecipeTally,
} from './arabic-joining-probe.ts'

// Fake Canvas widths keyed by direction and text, with a direction-free fallback.
function fakeMeasure(widths: Record<string, number>): { measure: Measure; queries: Map<string, Set<string>> } {
  const queries = new Map<string, Set<string>>()
  const measure: Measure = (recipe, context, direction, text) => {
    const key = `${context} ${direction} ${text}`
    let recipes = queries.get(key)
    if (recipes === undefined) {
      recipes = new Set()
      queries.set(key, recipes)
    }
    recipes.add(recipe)
    const width = widths[`${direction} ${text}`] ?? widths[text]
    if (width === undefined) throw new Error(`No fake width for ${direction} ${JSON.stringify(text)}`)
    return width
  }
  return { measure, queries }
}

function row(overrides: Partial<ProbeRow>): ProbeRow {
  return {
    font: 'additive', direction: 'rtl', word: 0, measure: 'head', site: 'grapheme', offset: 1, units: 1, joins: true,
    trusted: true, native: 3.9, predictions: {}, residual: 0, wordResidual: 0, ...overrides,
  }
}

test('sites join across transparent controls, but not after a right-joining letter or ZWNJ', () => {
  const sites = (text: string) => planWord({ family: 'test', text }).sites.map(site => [site.offset, site.kind, site.joins])
  expect(sites('بب')).toEqual([[1, 'grapheme', true]])
  expect(sites('اب')).toEqual([[1, 'grapheme', false]])
  expect(sites('ب\u00ADب\u00ADب')).toEqual([[1, 'shy', true], [3, 'shy', true]])
  expect(sites('\u200Bب\u00ADب')).toEqual([[1, 'grapheme', false], [2, 'shy', true]])
  expect(sites('ب\u200Cب')).toEqual([[2, 'grapheme', false]])
  expect(sites('ب\u200Dب')).toEqual([[2, 'grapheme', true]])
  expect(sites('ب\u2060ب')).toEqual([[1, 'grapheme', true], [2, 'grapheme', true]])
  expect(sites('ب\u0650ب')).toEqual([[2, 'grapheme', true]])
  expect(sites('AV')).toEqual([[1, 'grapheme', false]])
  const shy = planWord({ family: 'test', text: 'سلا\u00ADم' }).sites.find(site => site.kind === 'shy')
  expect(shy).toMatchObject({ offset: 3, joins: false, left: 'ا', right: 'م' })
  expect(planWord({ family: 'rich-same', text: 'بب', parts: ['ب', 'ب'] }).sites)
    .toEqual([{ offset: 1, units: 1, kind: 'part', joins: true, left: 'ب', right: 'ب' }])
})

test('ZWJ queries partition a joining-state font, and the gate rejects a neighbour-dependent one', () => {
  const plan = planWord({ family: 'test', text: 'بب' })
  const site = plan.sites[0]!
  // Arial-like: the initial and final forms add up to the joined word.
  const additive = fakeMeasure({
    'ب': 11.414, 'بب': 11.414, 'rtl ب\u200D': 3.906, 'rtl \u200Dب': 7.508, 'ltr ب\u200D': 11.414, 'ltr \u200Dب': 11.414,
  })
  const joined = predictSite(plan, site, additive.measure)
  expect(joined.residual).toBeCloseTo(0, 9)
  expect(joined.head).toEqual({
    'isolated': 11.414, 'r2c-prefix-zwj': 3.906, 'r2b-grapheme-forms': 3.906, 'r4-complement': 11.414 - 7.508, 'r7-ltr-zwj': 11.414,
  })
  expect(joined.tail['r2c-prefix-zwj']).toBe(7.508)
  // Each recipe lists the distinct queries it needs.
  const needs = (recipe: string) => Array.from(additive.queries).filter(([, recipes]) => recipes.has(recipe)).map(([key]) => key).sort()
  expect(needs('r2c-prefix-zwj')).toEqual(['offscreen rtl \u200Dب', 'offscreen rtl ب\u200D'].sort())
  expect(needs('r3-gate')).toEqual(['offscreen rtl \u200Dب', 'offscreen rtl ب\u200D', 'offscreen rtl بب'].sort())
  // Amiri-like: the in-word calt head differs from the generic initial form.
  const contextual = fakeMeasure({
    'ب': 14.816, 'بب': 16.3, 'rtl ب\u200D': 3.04, 'rtl \u200Dب': 14.13, 'ltr ب\u200D': 14.816, 'ltr \u200Dب': 14.816,
  })
  expect(predictSite(plan, site, contextual.measure).residual).toBeCloseTo(0.87, 9)
})

test('scoring counts a false accept only where the gate accepted a wrong partition', () => {
  const tallies = new Map<string, RecipeTally>()
  const additive = { 'isolated': 11.414, 'r2c-prefix-zwj': 3.906 }
  tallyRow(tallies, row({ native: 3.9, predictions: additive }))
  // The same accepted partition against a native head it misses.
  tallyRow(tallies, row({ native: 4.2, predictions: additive }))
  // A rejected partition that misses is a true reject; one that fits is a false reject.
  tallyRow(tallies, row({ native: 3.95, predictions: { 'r2c-prefix-zwj': 3.04 }, residual: 0.87, wordResidual: 0.87 }))
  tallyRow(tallies, row({ native: 3.04, predictions: { 'r2c-prefix-zwj': 3.04 }, residual: 0.87, wordResidual: 0.87 }))
  // Untrusted words and unobserved thresholds are skipped; a whole-word row is its own check.
  tallyRow(tallies, row({ trusted: false, predictions: additive }))
  tallyRow(tallies, row({ measure: 'emergency', native: null, predictions: additive }))
  tallyRow(tallies, row({ measure: 'whole', site: 'whole', trusted: false, native: 11.5, predictions: { 'r1-run': 11.414 }, residual: null }))
  expect(tallies.get('additive r2c-prefix-zwj')).toEqual({ ...createTally(), pass: 2, fail: 2, skipped: 2, accepted: 2, falseAccepts: 1, falseRejects: 1 })
  expect(tallies.get('additive isolated')).toEqual({ ...createTally(), fail: 2, skipped: 2 })
  expect(tallies.get('additive r1-run')).toEqual({ ...createTally(), fail: 1 })
  // One app unit is the bound.
  tallyRow(tallies, row({ font: 'bound', native: 3, predictions: { 'r2c-prefix-zwj': 3 + 1 / 60 } }))
  tallyRow(tallies, row({ font: 'bound', native: 3, predictions: { 'r2c-prefix-zwj': 3.02 } }))
  expect(tallies.get('bound r2c-prefix-zwj')).toMatchObject({ pass: 1, fail: 1, falseAccepts: 1 })
})

test('threshold rows score line counts at the bracketing widths against the recipe fit', () => {
  const tallies = new Map<string, RecipeTally>()
  tallyRow(tallies, row({
    measure: 'hyphen-normal', site: 'shy', native: 9.85, predictions: { 'r2-head-zwj': 9.84 }, bracket: [
      { recipe: 'r2-head-zwj', delta: -0.02, lineCount: 3, fits: false },
      { recipe: 'r2-head-zwj', delta: 0.02, lineCount: 2, fits: true },
      { recipe: 'r2-head-zwj', delta: 0.1, lineCount: 3, fits: false },
      { recipe: 'r2-head-zwj', delta: 0.5, lineCount: 2, fits: null },
      { recipe: 'isolated', delta: 0.5, lineCount: 2, fits: true },
    ],
  }))
  expect(tallies.get('additive r2-head-zwj')).toMatchObject({ pass: 0, thresholdPass: 1, bracketAgree: 2, bracketTotal: 3 })
})

test('inputs are deterministic, cover the named features and fill bounded batches', () => {
  const geeza = probeFonts.find(font => font.label === 'geeza-16')!
  const arial = probeFonts.find(font => font.label === 'arial-16')!
  const base = probeInputs(geeza)
  expect(base.length).toBe(16 + 10 + 2 + 3 + 9 * 14 + 3 * 9 * 14)
  expect(base.some(word => wordFeatures(word.text).includes('tatweel'))).toBe(true)
  const inputs = probeInputs(arial)
  expect(inputs.length).toBe(base.length + 500 + 50)
  expect(Math.ceil(inputs.length / BATCH_WORDS)).toBe(6)
  expect(probeInputs(arial).map(word => word.text)).toEqual(inputs.map(word => word.text))
  const corpus = inputs.filter(word => word.family.startsWith('corpus:'))
  const features = new Set(corpus.flatMap(word => wordFeatures(word.text)))
  expect(['voweled', 'lam-alef', 'hamza-seat'].filter(feature => !features.has(feature))).toEqual([])
  const shy = inputs.filter(word => word.family.startsWith('corpus-shy:'))
  expect(shy.length).toBe(50)
  expect(shy.every(word => planWord(word).sites.filter(site => site.kind === 'shy').length === 1)).toBe(true)
})
