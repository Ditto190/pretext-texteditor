import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The projected classes, in id order. A set of classes must fit an int32 mask.
const GENERATED_CLASSES = [
  'AL', 'AK', 'B2', 'BA', 'BB', 'BK', 'CJ', 'CL', 'CM', 'CP', 'EB', 'EM', 'EX', 'GL', 'HH', 'HL',
  'HY', 'ID', 'IN', 'IS', 'NS', 'NU', 'OP', 'PO', 'PR', 'QU', 'RI', 'SA', 'SP', 'SY', 'WJ', 'ZW',
] as const

type GeneratedLineBreakClass = (typeof GENERATED_CLASSES)[number]

// Classes that preprocessing does not tell apart. AI, SG, XX and CB resolve to
// AL (LB1, with CB only against other text); Hangul and jamo classes to ID; the
// aksara classes to AK; the line feeds to BK; and ZWJ to CM, since LB8a stays
// an explicit U+200D test.
const projectedClasses = new Map<string, GeneratedLineBreakClass>([
  ['AI', 'AL'], ['SG', 'AL'], ['XX', 'AL'], ['CB', 'AL'],
  ['H2', 'ID'], ['H3', 'ID'], ['JL', 'ID'], ['JV', 'ID'], ['JT', 'ID'],
  ['AP', 'AK'], ['AS', 'AK'], ['VF', 'AK'], ['VI', 'AK'],
  ['CR', 'BK'], ['LF', 'BK'], ['NL', 'BK'],
  ['ZWJ', 'CM'],
])

const BLOCK_SHIFT = 7
const BLOCK_SIZE = 1 << BLOCK_SHIFT
// Stage 1 stops below plane 14. Its few assigned classes become explicit checks.
const STAGE1_LIMIT = 0xE0000
// Every table character is this code plus a value below 32, so the strings stay
// printable ASCII without double quotes or backslashes.
const CHARACTER_BASE = 0x23
const DIGIT_LIMIT = 32

type LineBreakTable = {
  unicodeVersion: string
  stage1: number[]
  stage2: Uint8Array
  tailRanges: Array<[number, number, number]>
  defaultClass: number
}

const generatedClassToCode = new Map<string, number>()
for (let i = 0; i < GENERATED_CLASSES.length; i++) {
  generatedClassToCode.set(GENERATED_CLASSES[i]!, i)
}
for (const [raw, projected] of projectedClasses) {
  generatedClassToCode.set(raw, generatedClassToCode.get(projected)!)
}
if (GENERATED_CLASSES.length > DIGIT_LIMIT) throw new Error('Too many line-break classes for one character')

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`
}

function parseCodePointRange(raw: string): { start: number, end: number } {
  const [startRaw, endRaw] = raw.split('..')
  const start = Number.parseInt(startRaw!, 16)
  const end = endRaw === undefined ? start : Number.parseInt(endRaw, 16)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 0x10FFFF) {
    throw new Error(`Invalid code point range: ${raw}`)
  }
  return { start, end }
}

function classCode(raw: string): number {
  const code = generatedClassToCode.get(raw)
  if (code === undefined) throw new Error(`Unsupported line-break class ${raw}`)
  return code
}

function buildTable(sourceText: string): LineBreakTable {
  const sourceLines = sourceText.split(/\r?\n/)
  const versionMatch = sourceLines[0]?.match(/^# LineBreak-(.+)\.txt$/)
  if (versionMatch === null || versionMatch === undefined) {
    throw new Error('Could not determine Unicode version from LineBreak header')
  }

  const classes = new Uint8Array(0x110000)
  let sawMissing = false
  for (let i = 0; i < sourceLines.length; i++) {
    const missingMatch = sourceLines[i]!.match(/^# @missing:\s*([0-9A-Fa-f]+(?:\.\.[0-9A-Fa-f]+)?)\s*;\s*([A-Za-z0-9_]+)/)
    if (missingMatch === null) continue
    const { start, end } = parseCodePointRange(missingMatch[1]!)
    classes.fill(classCode(missingMatch[2]!), start, end + 1)
    sawMissing = true
  }
  if (!sawMissing) throw new Error('LineBreak has no @missing default')

  for (let i = 0; i < sourceLines.length; i++) {
    const line = sourceLines[i]!.split('#', 1)[0]!.trim()
    if (line.length === 0) continue
    const entryMatch = line.match(/^([0-9A-Fa-f]+(?:\.\.[0-9A-Fa-f]+)?)\s*;\s*([A-Za-z0-9_]+)$/)
    if (entryMatch === null) throw new Error(`Unexpected LineBreak entry: ${line}`)
    const { start, end } = parseCodePointRange(entryMatch[1]!)
    classes.fill(classCode(entryMatch[2]!), start, end + 1)
  }

  const defaultClass = classes[0x10FFFF]!
  let stage1Length = 1
  for (let codePoint = BLOCK_SIZE; codePoint < STAGE1_LIMIT; codePoint++) {
    if (classes[codePoint] !== defaultClass) stage1Length = (codePoint >> BLOCK_SHIFT) + 1
  }

  const blockIds = new Map<string, number>()
  const stage1: number[] = []
  const blocks: Uint8Array[] = []
  for (let block = 0; block < stage1Length; block++) {
    const values = classes.subarray(block << BLOCK_SHIFT, (block + 1) << BLOCK_SHIFT)
    const key = values.join(',')
    let id = blockIds.get(key)
    if (id === undefined) {
      id = blocks.length
      blockIds.set(key, id)
      blocks.push(values)
    }
    stage1.push(id)
  }
  if (blocks.length > DIGIT_LIMIT * DIGIT_LIMIT) throw new Error('Too many distinct line-break blocks for a two-character id')

  const stage2 = new Uint8Array(blocks.length << BLOCK_SHIFT)
  for (let i = 0; i < blocks.length; i++) {
    stage2.set(blocks[i]!, i << BLOCK_SHIFT)
  }

  const tailRanges: Array<[number, number, number]> = []
  for (let codePoint = stage1Length << BLOCK_SHIFT; codePoint < 0x110000; codePoint++) {
    const code = classes[codePoint]!
    if (code === defaultClass) continue
    const last = tailRanges[tailRanges.length - 1]
    if (last !== undefined && last[1] === codePoint - 1 && last[2] === code) {
      last[1] = codePoint
    } else {
      tailRanges.push([codePoint, codePoint, code])
    }
  }

  return { unicodeVersion: versionMatch[1]!, stage1, stage2, tailRanges, defaultClass }
}

function encodeDigit(value: number): string {
  return String.fromCharCode(CHARACTER_BASE + value)
}

function buildSource(table: LineBreakTable, sourceLabel: string): string {
  let stage1 = ''
  for (let i = 0; i < table.stage1.length; i++) {
    const id = table.stage1[i]!
    stage1 += encodeDigit(id >> 5) + encodeDigit(id & (DIGIT_LIMIT - 1))
  }
  // One literal, so emitted JavaScript has no concatenation left to evaluate.
  let stage2 = ''
  for (let i = 0; i < table.stage2.length; i++) stage2 += encodeDigit(table.stage2[i]!)
  const classRows = GENERATED_CLASSES.map((name, code) => `  ${name}: ${code},`).join('\n')
  const tailChecks = table.tailRanges
    .map(([start, end, code]) => start === end
      ? `codePoint === ${formatHex(start)} ? ${code}`
      : `codePoint >= ${formatHex(start)} && codePoint <= ${formatHex(end)} ? ${code}`)
    .join(' :\n      ')

  return `// Generated by scripts/generate-line-break-data.ts from ${sourceLabel}.
// Do not edit by hand. Regenerate with \`bun run generate:line-break-data\`.
// UAX #14 line-break classes (Unicode ${table.unicodeVersion}), projected for
// preprocessing: AI, SG, XX and CB read as AL; H2, H3, JL, JV and JT as ID; AP,
// AS, VF and VI as AK; CR, LF and NL as BK; and ZWJ as CM.

export const LineBreakClass = {
${classRows}
} as const

// A two-stage table in ASCII strings. Stage 1 gives every ${BLOCK_SIZE} code points below
// ${formatHex(STAGE1_LIMIT)} a block id in two base-${DIGIT_LIMIT} digits, and stage 2 gives one class per
// code point. Each digit is a character code minus ${formatHex(CHARACTER_BASE)}. Each string has one
// reference, so a minifier has no reason to copy it.
const stage1 = ${JSON.stringify(stage1)}
const stage2 = ${JSON.stringify(stage2)}

export function getLineBreakClass(codePoint: number): number {
  let index = codePoint
  if (codePoint >= ${formatHex(BLOCK_SIZE)}) {
    const block = codePoint >> ${BLOCK_SHIFT}
    if (block >= ${table.stage1.length}) {
      return ${tailChecks === '' ? '' : `${tailChecks} :\n      `}${table.defaultClass}
    }
    const ids = stage1
    const id = ((ids.charCodeAt(block << 1) - ${formatHex(CHARACTER_BASE)}) << 5) | (ids.charCodeAt((block << 1) + 1) - ${formatHex(CHARACTER_BASE)})
    index = (id << ${BLOCK_SHIFT}) | (codePoint & ${formatHex(BLOCK_SIZE - 1)})
  }
  return stage2.charCodeAt(index) - ${formatHex(CHARACTER_BASE)}
}
`
}

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const sourceFile = join(scriptsDir, 'unicode', 'LineBreak-17.0.0.txt')
const generatedDir = join(scriptsDir, '..', 'src', 'generated')
const outputPath = join(generatedDir, 'line-break-data.ts')

const table = buildTable(readFileSync(sourceFile, 'utf8'))
const nextSource = buildSource(table, 'scripts/unicode/LineBreak-17.0.0.txt')

if (process.argv.includes('--check')) {
  const currentSource = readFileSync(outputPath, 'utf8')
  if (currentSource !== nextSource) {
    throw new Error(`Generated line-break data is stale: ${outputPath}`)
  }
  console.log(`Generated line-break data is up to date (${table.unicodeVersion}).`)
} else {
  mkdirSync(generatedDir, { recursive: true })
  await Bun.write(outputPath, nextSource)
  console.log(`Wrote ${outputPath} (${table.unicodeVersion}; ${table.stage1.length} stage-1 blocks, ${table.stage2.length >> BLOCK_SHIFT} distinct).`)
}
