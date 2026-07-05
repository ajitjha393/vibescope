import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { dayBucket, dayKey } from '../util.js'

// Cursor keeps its chat state in SQLite databases:
// - <User>/globalStorage/state.vscdb, table cursorDiskKV: one
//   `composerData:<uuid>` row per composer session — `createdAt` (epoch ms),
//   `conversationMap` holds the bubbles (type 1 = user, 2 = assistant).
// - <User>/workspaceStorage/<hash>/state.vscdb, table ItemTable:
//   `aiService.prompts` (typed prompts, no timestamps) and
//   `aiService.generations` (AI responses with unixMs), plus workspace.json
//   next to it mapping the hash to a real folder.
// Cursor does not persist per-message token usage in these tables, so token
// and cost fields stay 0 — vibescope never guesses.
//
// Reading uses the `sqlite3` CLI (preinstalled on macOS, ubiquitous on
// Linux) to keep vibescope dependency-free; without it the provider
// degrades to "detected, not parsed".

const run = promisify(execFile)

export const id = 'cursor'
export const label = 'Cursor'

const rootDir = (cursorDir) => {
  if (cursorDir) return cursorDir
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Cursor', 'User')
  if (process.platform === 'win32')
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'Cursor', 'User')
  return join(homedir(), '.config', 'Cursor', 'User')
}

export async function detect({ cursorDir } = {}) {
  try {
    return (await stat(rootDir(cursorDir))).isDirectory()
  } catch {
    return false
  }
}

async function sqlite(db, query) {
  const { stdout } = await run('sqlite3', ['-json', '-readonly', db, query], {
    timeout: 10000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const text = stdout.trim()
  return text ? JSON.parse(text) : []
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
  const base = rootDir(opts.cursorDir)
  const sinceMs = opts.sinceMs || 0
  const out = emptyStats()

  try {
    await run('sqlite3', ['--version'], { timeout: 5000 })
  } catch {
    out.reason = 'sqlite3 CLI not found'
    return out
  }

  // Global composer sessions.
  try {
    const rows = await sqlite(
      join(base, 'globalStorage', 'state.vscdb'),
      `SELECT c.key AS key,
              json_extract(c.value,'$.createdAt') AS created,
              (SELECT COUNT(*) FROM json_each(json_extract(c.value,'$.conversationMap'))) AS bubbles,
              (SELECT COUNT(*) FROM json_each(json_extract(c.value,'$.conversationMap')) je
                WHERE json_extract(je.value,'$.type')=1) AS userBubbles
         FROM cursorDiskKV c WHERE c.key LIKE 'composerData:%'`,
    )
    out.found = true
    for (const r of rows) {
      const created = Number(r.created)
      const total = Number(r.bubbles) || 0
      const userMsgs = Number(r.userBubbles) || 0
      if (!created || created < sinceMs || total === 0) continue
      out.sessions.push({
        id: String(r.key).slice('composerData:'.length),
        provider: id,
        title: null,
        project: null,
        start: created,
        end: created,
        userMsgs,
        assistantMsgs: total - userMsgs,
        toolCalls: 0,
        outputTokens: 0,
        cost: 0,
        activeMs: 0,
      })
      out.totals.sessions += 1
      out.totals.userMessages += userMsgs
      out.totals.assistantMessages += total - userMsgs
      const b = dayBucket(out.daily, created)
      b.prompts += userMsgs
      b.aiMsgs += total - userMsgs
      const local = new Date(created)
      out.hourly[local.getHours()] += userMsgs
      out.weekday[local.getDay()] += userMsgs
    }
  } catch {
    // global db unreadable — workspaces may still parse
  }

  // Per-workspace prompt/generation logs.
  let wsDirs = []
  try {
    wsDirs = (await readdir(join(base, 'workspaceStorage'), { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => join(base, 'workspaceStorage', d.name))
  } catch {}

  for (const dir of wsDirs) {
    let folder = null
    try {
      const ws = JSON.parse(await readFile(join(dir, 'workspace.json'), 'utf8'))
      if (ws.folder) folder = decodeURIComponent(String(ws.folder).replace(/^file:\/\//, ''))
    } catch {}
    try {
      const rows = await sqlite(
        join(dir, 'state.vscdb'),
        `SELECT key, value FROM ItemTable WHERE key IN ('aiService.prompts','aiService.generations')`,
      )
      out.found = true
      let prompts = 0
      let generations = 0
      let lastTs = null
      for (const r of rows) {
        let arr = []
        try {
          arr = JSON.parse(r.value)
        } catch {}
        if (!Array.isArray(arr)) continue
        if (r.key === 'aiService.prompts') prompts += arr.length
        else {
          for (const g of arr) {
            const ts = Number(g && g.unixMs)
            if (!ts || ts < sinceMs) continue
            generations += 1
            if (!lastTs || ts > lastTs) lastTs = ts
            dayBucket(out.daily, ts).aiMsgs += 1
          }
        }
      }
      if (prompts + generations === 0) continue
      // Workspace prompt logs carry no timestamps — surface them on the
      // project rollup via a synthetic session rather than inventing dates.
      out.sessions.push({
        id: `cursor-ws-${basename(dir)}`,
        provider: id,
        title: folder ? `Cursor · ${basename(folder)}` : 'Cursor workspace',
        project: folder,
        start: lastTs,
        end: lastTs,
        userMsgs: prompts,
        assistantMsgs: generations,
        toolCalls: 0,
        outputTokens: 0,
        cost: 0,
        activeMs: 0,
      })
      out.totals.sessions += 1
      out.totals.userMessages += prompts
      out.totals.assistantMessages += generations
    } catch {}
  }

  return out
}
