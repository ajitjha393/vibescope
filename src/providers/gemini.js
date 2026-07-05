import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { dayBucket } from '../util.js'

// Gemini CLI keeps per-project prompt logs at ~/.gemini/tmp/<hash>/logs.json:
// an array of {sessionId, messageId, timestamp, type: 'user', message}.
// The <hash> is a digest of the working directory, so the project name is
// not recoverable — sessions surface under the agent, not a folder. Token
// usage isn't persisted; counts only. Experimental.

export const id = 'gemini'
export const label = 'Gemini CLI'
export const experimental = true

const rootDir = (geminiDir) => geminiDir || join(homedir(), '.gemini', 'tmp')

export async function detect({ geminiDir } = {}) {
  try {
    return (await stat(rootDir(geminiDir))).isDirectory()
  } catch {
    return false
  }
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
  const base = rootDir(opts.geminiDir)
  const sinceMs = opts.sinceMs || 0
  let dirs = []
  try {
    dirs = (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory())
  } catch {
    return out
  }

  const bySession = new Map()
  for (const d of dirs) {
    let entries = []
    try {
      entries = JSON.parse(await readFile(join(base, d.name, 'logs.json'), 'utf8'))
      out.found = true
    } catch {
      continue
    }
    if (!Array.isArray(entries)) continue
    for (const e of entries) {
      if (!e || e.type !== 'user') continue
      const ts = e.timestamp ? Date.parse(e.timestamp) : NaN
      if (!Number.isFinite(ts) || ts < sinceMs) continue
      const key = e.sessionId || d.name
      let s = bySession.get(key)
      if (!s) {
        s = {
          id: String(key), provider: id, title: null, project: null,
          start: ts, end: ts, userMsgs: 0, assistantMsgs: 0, toolCalls: 0,
          outputTokens: 0, cost: 0, activeMs: 0,
        }
        bySession.set(key, s)
      }
      s.userMsgs += 1
      if (ts < s.start) s.start = ts
      if (ts > s.end) s.end = ts
      dayBucket(out.daily, ts).prompts += 1
      const local = new Date(ts)
      out.hourly[local.getHours()] += 1
      out.weekday[local.getDay()] += 1
    }
  }

  for (const s of bySession.values()) {
    out.sessions.push(s)
    out.totals.sessions += 1
    out.totals.userMessages += s.userMsgs
  }
  return out
}
