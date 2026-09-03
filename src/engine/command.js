/**
 * Turning the options object into an argv, and back again.
 *
 * The "back again" half is the point. A GUI that hides the command line leaves you stuck
 * the moment you need to script something, and it gives you no way to check what it is
 * actually doing. Here the command preview is exact, copyable, and reversible: paste a
 * command someone sent you and the form fills in from it.
 *
 * Everything reads its flag spellings from OPTION_SPEC, so adding a flag there is enough
 * to make it build, display and parse.
 */

import { OPTION_SPEC, OPTION_BY_KEY, defaultOptions, isActive } from './options.js'

/** Name shown in the preview. The real path is resolved by the shell at spawn time. */
export const EXE_NAME = 'stl2step'

/**
 * argv for a conversion, not including the executable.
 *
 * Note what is absent: `--quiet`. Upstream suggests it so the RESULT line is the only
 * thing on stdout, but progress lines are exactly what a progress bar needs, and finding
 * the RESULT line is a one line filter. So we take the chattier output on purpose, and the
 * preview shows the real invocation rather than a tidied up version of it.
 */
export function buildConvertArgs(options, { input, output } = {}) {
  const args = []

  if (input) args.push(input)

  for (const spec of OPTION_SPEC) {
    const value = options[spec.key]

    // Unset means "let the engine decide", and an inactive option would be ignored anyway.
    if (value === null || value === undefined || value === '') continue
    if (!isActive(spec, options)) continue

    if (spec.type === 'bool') {
      // Booleans only ever emit in their non default direction.
      if (value === true && spec.onFlag) args.push(spec.onFlag)
      if (value === false && spec.offFlag) args.push(spec.offFlag)
      continue
    }

    if (value === spec.default) continue
    args.push(spec.flag, String(value))
  }

  if (output) args.push('-o', output)
  return args
}

/**
 * argv for mesh mode, which tessellates a STEP back to a mesh.
 *
 * This is how the viewer previews a result. `--edges` is the interesting half: it writes
 * the real B-Rep edges, which is what lets the viewer show the actual face boundaries
 * rather than a triangle soup.
 */
export function buildMeshArgs({ input, output, edges, threads } = {}) {
  const args = ['--mesh', input, '-o', output]
  if (edges) args.push('--edges', edges)
  if (threads) args.push('--threads', String(threads))
  return args
}

/** Quote a single argument for display and for .bat export. */
export function quoteArg(arg) {
  const s = String(arg)
  if (s === '') return '""'
  return /[\s"^&|<>()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s
}

/** A copyable one line command. */
export function formatCommand(args, exe = EXE_NAME) {
  return [quoteArg(exe), ...args.map(quoteArg)].join(' ')
}

/**
 * Split a command string into tokens, respecting quotes.
 *
 * Deliberately small: it handles the quoting a person actually types or that we emit, not
 * the full horror of cmd.exe escaping.
 */
export function tokenize(text) {
  const tokens = []
  let current = ''
  let quote = null
  let started = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (quote) {
      if (ch === '\\' && text[i + 1] === quote) {
        current += quote
        i++
      } else if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }

    if (/\s/.test(ch)) {
      if (started || current) tokens.push(current)
      current = ''
      started = false
      continue
    }

    current += ch
  }

  if (started || current) tokens.push(current)
  return tokens
}

/** Flag lookup built from the spec, including the negative and alias spellings. */
function flagIndex() {
  const index = new Map()

  for (const spec of OPTION_SPEC) {
    if (spec.flag) index.set(spec.flag, { spec, kind: 'value' })
    if (spec.onFlag) index.set(spec.onFlag, { spec, kind: 'bool', value: true })
    if (spec.offFlag) index.set(spec.offFlag, { spec, kind: 'bool', value: false })
    for (const alias of spec.aliases ?? []) {
      index.set(alias.flag, { spec, kind: 'alias', value: alias.value })
    }
  }

  return index
}

const FLAGS = flagIndex()

/**
 * Read a command string back into an options object.
 *
 * Returns everything it understood plus everything it did not, rather than throwing. A
 * command with one unrecognised flag should still populate the other twenty, and the UI
 * can report the leftovers instead of silently dropping them.
 */
export function parseCommand(text) {
  const tokens = tokenize(text.trim())
  const options = defaultOptions()
  const result = {
    options,
    input: null,
    output: null,
    edges: null,
    mode: 'convert',
    unknown: [],
    errors: [],
    touched: []
  }

  if (!tokens.length) return result

  // Drop a leading executable, however it was written: stl2step, .\stl2step.exe,
  // or a full path. A bare positional that is not the exe is the input file.
  const first = tokens[0].replace(/\\/g, '/').split('/').pop().toLowerCase()
  if (first === 'stl2step' || first === 'stl2step.exe') tokens.shift()

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token === '-o' || token === '--output') {
      const value = tokens[++i]
      if (value === undefined) result.errors.push(`${token} needs a file path`)
      else result.output = value
      continue
    }

    if (token === '--mesh') {
      const value = tokens[++i]
      result.mode = 'mesh'
      if (value === undefined) result.errors.push('--mesh needs a file path')
      else result.input = value
      continue
    }

    if (token === '--edges') {
      const value = tokens[++i]
      if (value === undefined) result.errors.push('--edges needs a file path')
      else result.edges = value
      continue
    }

    // Accepted and intentionally not surfaced as an option: we always want progress.
    if (token === '--quiet') continue

    if (token.startsWith('-')) {
      // Support --flag=value as well as --flag value.
      const eq = token.indexOf('=')
      const name = eq === -1 ? token : token.slice(0, eq)
      const inlineValue = eq === -1 ? null : token.slice(eq + 1)
      const entry = FLAGS.get(name)

      if (!entry) {
        result.unknown.push(token)
        continue
      }

      const { spec, kind } = entry

      if (kind === 'bool' || kind === 'alias') {
        options[spec.key] = entry.value
        result.touched.push(spec.key)
        continue
      }

      const raw = inlineValue ?? tokens[++i]
      if (raw === undefined) {
        result.errors.push(`${name} needs a value`)
        continue
      }

      if (spec.type === 'number') {
        const n = Number(raw)
        if (Number.isNaN(n)) {
          result.errors.push(`${name} expects a number, got "${raw}"`)
          continue
        }
        options[spec.key] = n
      } else if (spec.type === 'enum') {
        const match = spec.choices.find((c) => c.value.toLowerCase() === raw.toLowerCase())
        if (!match) {
          const allowed = spec.choices.map((c) => c.value).join(', ')
          result.errors.push(`${name} expects one of ${allowed}, got "${raw}"`)
          continue
        }
        options[spec.key] = match.value
      } else {
        options[spec.key] = raw
      }

      result.touched.push(spec.key)
      continue
    }

    // A bare token is the input file. A second one is a mistake worth reporting,
    // because silently ignoring it would convert the wrong file.
    if (result.input === null) result.input = token
    else result.unknown.push(token)
  }

  return result
}

/**
 * A .bat file that runs the current settings over every file dropped onto it, or over
 * every STL beside it if run directly.
 *
 * This is the handoff from GUI to terminal: dial the options in here, export, and the
 * result is a reusable script that does not need this app at all.
 */
export function toBatchScript(options, { exe = EXE_NAME, schemaNote = true } = {}) {
  const args = buildConvertArgs(options).map(quoteArg).join(' ')
  const lines = [
    '@echo off',
    'setlocal',
    '',
    'REM Generated by Basilisk Step Studio.',
    'REM Drag STL files onto this file, or run it in a folder of STL files.',
    ''
  ]

  if (schemaNote) {
    lines.push(`REM Options: ${args || '(engine defaults)'}`, '')
  }

  lines.push(
    `set "ENGINE=${exe}"`,
    '',
    'if "%~1"=="" goto folder',
    '',
    ':args',
    'for %%F in (%*) do call :convert "%%~fF"',
    'goto done',
    '',
    ':folder',
    'for %%F in ("%~dp0*.stl") do call :convert "%%~fF"',
    'goto done',
    '',
    ':convert',
    'echo Converting %~nx1',
    `"%ENGINE%" "%~f1" ${args} -o "%~dpn1.step"`,
    'if errorlevel 1 echo   FAILED %~nx1',
    'exit /b',
    '',
    ':done',
    'echo.',
    'echo Finished.',
    'pause'
  )

  return lines.join('\r\n')
}

/** Human readable summary of what differs from the engine defaults. */
export function describeOptions(options) {
  const parts = []
  for (const spec of OPTION_SPEC) {
    const value = options[spec.key]
    if (value === null || value === undefined || value === '') continue
    if (!isActive(spec, options)) continue
    if (spec.type === 'bool') {
      if (value === true && spec.onFlag) parts.push(spec.label)
      if (value === false && spec.offFlag) parts.push(`No ${spec.label.toLowerCase()}`)
      continue
    }
    if (value === spec.default) continue
    const choice = spec.choices?.find((c) => c.value === value)
    parts.push(`${spec.label}: ${choice ? choice.label : value}${spec.unit ? ' ' + spec.unit : ''}`)
  }
  return parts
}

export { OPTION_BY_KEY }
