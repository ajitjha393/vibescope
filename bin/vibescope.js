#!/usr/bin/env node
import { writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { scanAll } from '../src/providers/index.js'
import { scanGit, defaultIdentity } from '../src/gitscan.js'
import { aggregate } from '../src/aggregate.js'
import { serve } from '../src/serve.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (flag('help') || flag('h')) {
  console.log(`vibescope — local-first observability for the vibe-coding era

Usage: npx vibescope [options]

Options:
  --roots <dirs>    Comma-separated dirs to scan for git repos (default: cwd, or ~/work if cwd has no repos)
  --months <n>      How far back to look (default: 6)
  --authors <list>  Comma-separated substrings matching your git email/name (default: your git config)
  --port <n>        Dashboard port (default: 4177)
  --json            Print aggregated data as JSON to stdout instead of serving
  --out <file>      Also write the aggregated JSON to a file
  --no-open         Don't auto-open the browser

Everything runs locally. Nothing is uploaded, ever.`)
  process.exit(0)
}

const log = (msg) => console.error(`\x1b[2m◉\x1b[0m ${msg}`)

const months = Number(opt('months', '6'))
const sinceMs = Date.now() - months * 30.44 * 86400000
const rangeDays = Math.round((Date.now() - sinceMs) / 86400000)

let roots = opt('roots', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => resolve(s.replace(/^~(?=$|\/)/, homedir())))
if (roots.length === 0) {
  roots = [process.cwd()]
  const workDir = join(homedir(), 'work')
  try {
    if ((await stat(workDir)).isDirectory() && !roots.includes(workDir)) roots.push(workDir)
  } catch {}
}

const authors = opt('authors', '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

console.error(`\x1b[1m◉ vibescope\x1b[0m v0.1.0 — reading what's already on your machine`)
log(`window: last ${months} months · roots: ${roots.join(', ')}`)

const agents = await scanAll({ sinceMs }, (p) => log(`scanning ${p.label} sessions…`))
for (const a of agents) {
  if (!a.detected) continue
  const t = a.stats && a.stats.totals
  if (t) log(`  ${a.label}: ${t.sessions} sessions · ${t.userMessages} prompts · $${t.estCostUSD.toFixed(2)} est.`)
  else log(`  ${a.label}: detected, ${a.error || 'no data'}`)
}
const cc = agents.find((a) => a.id === 'claude-code')

const identity = authors.length ? authors : await defaultIdentity()
log(`scanning git repos (author: ${identity.join(', ') || 'anyone'})…`)
const gitData = await scanGit({ roots, authors: identity, sinceMs })
log(`  ${gitData.totalCommits} commits across ${gitData.repos.length} repos (${gitData.reposScanned} scanned)`)

const sources = {
  claudeCode: !!(cc && cc.stats && cc.stats.found),
  cursor: await cursorDetected(),
  git: gitData.reposScanned > 0,
}

const data = aggregate({ providers: agents, gitData, rangeDays, identity, sources })

const out = opt('out', null)
if (out) {
  await writeFile(out, JSON.stringify(data, null, 2))
  log(`wrote ${out}`)
}

if (flag('json')) {
  console.log(JSON.stringify(data, null, 2))
} else {
  const { url } = await serve(data, { port: Number(opt('port', '4177')), open: !flag('no-open') })
  log(`dashboard → \x1b[1m${url}\x1b[0m  (ctrl-c to stop)`)
}

async function cursorDetected() {
  const candidates =
    process.platform === 'darwin'
      ? [join(homedir(), 'Library', 'Application Support', 'Cursor')]
      : [join(homedir(), '.config', 'Cursor'), join(homedir(), 'AppData', 'Roaming', 'Cursor')]
  for (const c of candidates) {
    try {
      if ((await stat(c)).isDirectory()) return true
    } catch {}
  }
  return false
}
