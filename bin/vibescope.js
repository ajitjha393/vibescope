#!/usr/bin/env node
import { writeFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { scanAll } from '../src/providers/index.js'
import { scanGit, defaultIdentity } from '../src/gitscan.js'
import { aggregate } from '../src/aggregate.js'
import { loadSnapshots, mergeTeam } from '../src/team.js'
import { serve } from '../src/serve.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const log = (msg) => console.error(`\x1b[2m◉\x1b[0m ${msg}`)

if (flag('help') || flag('h')) {
  console.log(`vibescope — local-first, agent-agnostic observability for the vibe-coding era

Usage:
  npx vibescope [options]                     scan this machine, serve your dashboard
  npx vibescope team <snapshot|dir>… [opts]   merge exported snapshots, serve the team dashboard

Options:
  --roots <dirs>    Comma-separated dirs to scan for git repos (default: cwd, or ~/work if present)
  --months <n>      How far back to look (default: 6)
  --authors <list>  Comma-separated substrings matching your git email/name (default: your git config + per-repo identities)
  --providers <ids> Only scan these agents (e.g. claude-code,cursor). Default: all detected
  --claude-dir <p>  Override Claude Code history location (~/.claude/projects)
  --cursor-dir <p>  Override Cursor user-data location
  --port <n>        Dashboard port (default: 4177)
  --json            Print aggregated data as JSON to stdout instead of serving
  --name <who>      Stamp your name on the export (team mode shows it)
  --redact          Strip session titles from the export before sharing
  --out <file>      Also write the aggregated JSON to a file
  --no-open         Don't auto-open the browser

Team mode:
  Each member runs:   npx vibescope --json --name alice --redact > alice.json
  Someone serves:     npx vibescope team ./snapshots/

Everything runs locally. Nothing is uploaded, ever.`)
  process.exit(0)
}

if (args[0] === 'team') await runTeam()
else await runScan()

async function runTeam() {
  const paths = []
  for (let i = 1; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      if (['port', 'out'].includes(a.slice(2))) i++ // skip the flag's value
      continue
    }
    paths.push(resolve(a))
  }
  if (paths.length === 0) {
    console.error('usage: vibescope team <snapshot.json | dir>…  (files from `vibescope --json --name <who>`)')
    process.exit(1)
  }
  console.error(`\x1b[1m◉ vibescope team\x1b[0m`)
  const snaps = await loadSnapshots(paths)
  if (snaps.length === 0) {
    console.error('no vibescope snapshots found in: ' + paths.join(', '))
    process.exit(1)
  }
  const team = mergeTeam(snaps)
  log(`${team.members.length} member${team.members.length === 1 ? '' : 's'} · ${team.totals.prompts} prompts · $${team.totals.cost.toFixed(2)} est.`)
  const out = opt('out', null)
  if (out) {
    await writeFile(out, JSON.stringify(team, null, 2))
    log(`wrote ${out}`)
  }
  if (flag('json')) {
    console.log(JSON.stringify(team, null, 2))
    return
  }
  const { url } = await serve(team, { port: Number(opt('port', '4177')), open: !flag('no-open'), page: 'team.html' })
  log(`team dashboard → \x1b[1m${url}\x1b[0m  (ctrl-c to stop)`)
}

async function runScan() {
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

  console.error(`\x1b[1m◉ vibescope\x1b[0m — reading what's already on your machine`)
  log(`window: last ${months} months · roots: ${roots.join(', ')}`)

  const only = opt('providers', '').split(',').map((s) => s.trim()).filter(Boolean)
  const agents = await scanAll(
    { sinceMs, roots, only, claudeDir: opt('claude-dir', null), cursorDir: opt('cursor-dir', null) },
    (p) => log(`scanning ${p.label} sessions…`),
  )
  for (const a of agents) {
    if (!a.detected) continue
    const t = a.stats && a.stats.totals
    if (t) log(`  ${a.label}: ${t.sessions} sessions · ${t.userMessages} prompts · $${t.estCostUSD.toFixed(2)} est.`)
    else log(`  ${a.label}: detected, ${a.error || 'no data'}`)
  }
  const cc = agents.find((a) => a.id === 'claude-code')
  const cur = agents.find((a) => a.id === 'cursor')

  const identity = authors.length ? authors : await defaultIdentity()
  log(`scanning git repos (author: ${identity.join(', ') || 'anyone'}${authors.length ? '' : ' + per-repo identities'})…`)
  const gitData = await scanGit({ roots, authors: identity, explicitAuthors: authors.length > 0, sinceMs })
  log(`  ${gitData.totalCommits} commits across ${gitData.repos.length} repos (${gitData.reposScanned} scanned)`)

  const sources = {
    claudeCode: !!(cc && cc.stats && cc.stats.found),
    // banner-worthy only when cursor is installed but its state couldn't be read
    cursor: !!(cur && cur.detected && !(cur.stats && cur.stats.found)),
    git: gitData.reposScanned > 0,
  }

  const data = aggregate({
    providers: agents,
    gitData,
    rangeDays,
    identity,
    sources,
    member: opt('name', null),
  })

  if (flag('redact')) {
    data.recentSessions = data.recentSessions.map((s) => ({ ...s, title: '(redacted)' }))
    if (data.highlights.longestSession) data.highlights.longestSession.title = null
  }

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
}
