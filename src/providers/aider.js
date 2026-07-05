import { readdir, readFile, stat } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { dayBucket } from '../util.js'

// Aider writes a markdown chat log into each repo it runs in:
// <repo>/.aider.chat.history.md — "# aider chat started at <datetime>"
// opens a session, "#### <text>" lines are the user's prompts. Prompts
// don't carry their own timestamps, so they bin to their session's start.
// Token usage isn't recoverable from the log; counts only. Experimental.

export const id = 'aider'
export const label = 'Aider'
export const experimental = true

async function historyFiles(roots = []) {
  const files = []
  for (const root of roots) {
    for (const dir of [root, ...(await subdirs(root))]) {
      const p = join(dir, '.aider.chat.history.md')
      try {
        if ((await stat(p)).isFile()) files.push(p)
      } catch {}
    }
  }
  return files
}

async function subdirs(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => join(root, e.name))
  } catch {
    return []
  }
}

export async function detect({ roots } = {}) {
  return (await historyFiles(roots)).length > 0
}

function emptyStats() {
  return {
    found: false,
    sessions: [],
    models: new Map(),
    daily: new Map(),
    hourly: new Array(24).fill(0),
    weekday: new Array(7).fill(0),
    toolUsage: new Map(),
    totals: {
      sessions: 0, userMessages: 0, assistantMessages: 0, subagentMessages: 0,
      toolCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 0, estCostUSD: 0,
    },
  }
}

export async function scan(opts = {}) {
  const out = emptyStats()
  const files = await historyFiles(opts.roots)
  if (files.length === 0) return out
  out.found = true
  const sinceMs = opts.sinceMs || 0

  for (const file of files) {
    let text = ''
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const project = dirname(file)
    let session = null
    const flush = () => {
      if (!session || session.userMsgs === 0) return
      out.sessions.push(session)
      out.totals.sessions += 1
      out.totals.userMessages += session.userMsgs
    }
    for (const line of text.split('\n')) {
      const started = line.match(/^# aider chat started at (.+)/)
      if (started) {
        flush()
        const ts = Date.parse(started[1])
        session = {
          id: `aider-${basename(project)}-${Number.isFinite(ts) ? ts : out.sessions.length}`,
          provider: id, title: `Aider · ${basename(project)}`, project,
          start: Number.isFinite(ts) ? ts : null, end: Number.isFinite(ts) ? ts : null,
          userMsgs: 0, assistantMsgs: 0, toolCalls: 0, outputTokens: 0, cost: 0, activeMs: 0,
        }
        continue
      }
      if (line.startsWith('#### ') && session) {
        const ts = session.start
        if (ts !== null && ts < sinceMs) continue
        session.userMsgs += 1
        if (ts !== null) {
          dayBucket(out.daily, ts).prompts += 1
          const local = new Date(ts)
          out.hourly[local.getHours()] += 1
          out.weekday[local.getDay()] += 1
        }
      }
    }
    flush()
  }
  return out
}
