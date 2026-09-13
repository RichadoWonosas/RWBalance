import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(fileURLToPath(new URL('..', import.meta.url)))
const sourceRoot = join(projectRoot, 'src')

const approvedExternalResources = new Map()

const tailwindReservedSemanticNames = new Set([
  'absolute', 'block', 'container', 'contents', 'filter', 'fixed', 'flex', 'grid',
  'hidden', 'inline', 'isolate', 'relative', 'ring', 'shadow', 'sticky', 'table',
  'transform', 'transition', 'visible',
])

const approvedTailwindCollisions = new Map()

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  })
}

function lineOf(source, offset) {
  return source.slice(0, offset).split('\n').length
}

function location(path, source, offset) {
  return `${relative(projectRoot, path).replaceAll('\\', '/')}:${lineOf(source, offset)}`
}

export function auditStyles() {
  const sourceFiles = walk(sourceRoot).filter((path) => ['.css', '.ts', '.vue'].includes(extname(path)))
  const sources = sourceFiles.map((path) => ({ path, source: readFileSync(path, 'utf8') }))
  const styleSources = sources.filter(({ path }) => ['.css', '.vue'].includes(extname(path)))
  const cssSources = sources.filter(({ path }) => extname(path) === '.css')
  const errors = []
  const warnings = []
  const definedVariables = new Set()
  const usedVariables = new Map()

  for (const { source } of sources) {
    for (const match of source.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) definedVariables.add(match[1])
    for (const match of source.matchAll(/['"](--[a-zA-Z0-9-]+)['"]\s*:/g)) definedVariables.add(match[1])
    for (const match of source.matchAll(/setProperty\(\s*['"](--[a-zA-Z0-9-]+)['"]/g)) definedVariables.add(match[1])
  }

  for (const { path, source } of styleSources) {
    for (const match of source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,|\))/g)) {
      const variable = match[1]
      const entries = usedVariables.get(variable) ?? []
      entries.push(location(path, source, match.index))
      usedVariables.set(variable, entries)
      if (!definedVariables.has(variable) && match[2] !== ',') {
        errors.push(`${location(path, source, match.index)} uses undefined ${variable} without a fallback.`)
      }
    }
  }

  for (const { path, source } of cssSources) {
    for (const match of source.matchAll(/(?:@import\s+(?:url\()?|url\()\s*['"]?(https?:\/\/[^'"\s)]+)/g)) {
      const url = match[1]
      const reason = approvedExternalResources.get(url)
      if (reason) warnings.push(`${location(path, source, match.index)} temporarily allows ${url}. ${reason}`)
      else errors.push(`${location(path, source, match.index)} references unapproved external resource ${url}.`)
    }
  }

  const staticClasses = new Set()
  for (const { source } of sources.filter(({ path }) => extname(path) === '.vue')) {
    for (const match of source.matchAll(/\bclass\s*=\s*['"]([^'"]+)['"]/g)) {
      for (const token of match[1].split(/\s+/)) if (/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(token)) staticClasses.add(token)
    }
  }

  const combinedCss = cssSources.map(({ source }) => source).join('\n')
  for (const className of staticClasses) {
    if (!tailwindReservedSemanticNames.has(className)) continue
    const customSelector = new RegExp(`\\.${className}(?![-_a-zA-Z0-9])`).test(combinedCss)
    if (!customSelector) continue
    const reason = approvedTailwindCollisions.get(className)
    if (reason) warnings.push(`Tailwind semantic class collision .${className} is temporarily allowed. ${reason}`)
    else errors.push(`Tailwind utility name .${className} is also used as a custom semantic selector.`)
  }

  const unusedVariables = [...definedVariables]
    .filter((variable) => !usedVariables.has(variable))
    .filter((variable) => combinedCss.includes(`${variable}:`))
    .filter((variable) => !variable.startsWith('--breakpoint-'))
    .filter((variable) => !['--font-sans', '--font-serif'].includes(variable))
    .filter((variable) => !variable.startsWith('--color-app-'))
    .sort()

  if (unusedVariables.length) {
    errors.push(`CSS custom properties defined but unused: ${unusedVariables.join(', ')}.`)
  }

  return { errors, warnings }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])

if (isDirectRun) {
  const { errors, warnings } = auditStyles()
  for (const warning of warnings) console.warn(`STYLE WARNING: ${warning}`)
  if (errors.length) {
    for (const error of errors) console.error(`STYLE ERROR: ${error}`)
    process.exitCode = 1
  } else {
    console.log(`Style audit passed with ${warnings.length} documented layout exception(s).`)
  }
}
