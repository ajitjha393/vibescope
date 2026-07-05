import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { dayBucket } from '../util.js'

// OpenAI Codex CLI rollouts: ~/.codex/sessions/**/rollout-*.jsonl.
// Lines are {timestamp, type, payload}; user/assistant messages arrive as
// response items with a role, and cumulative token usage as token_count
// events. Marked experimental until exercised against more real installs —
// unknown shapes are skipped, never guessed at.

export const id = 'codex'
export const label = 'Codex CLI'
export const experimental = true

const rootDir = (codexDir) => codexDir || join(homedir(), '.codex', 'sessions')

export async function detect({ codexDir } = {}) {
  try {
    return (await stat(rootDir(codexDir))).isDirectory()
  } catch {
    return false
  }
}

async function jsonlFiles(dir, out = []) {
  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await jsonlFiles(p, out)
    else if (e.name.endsWith('.jsonl')) out.push(p)
  }
  return out
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
  const files = await jsonlFiles(rootDir(opts.codexDir))
  if (files.length === 0) return out
  out.found = true
  const sinceMs = opts.sinceMs || 0

  for (const file of files) {
    const s = {
      id: basename(file, '.jsonl'), provider: id, title: null, project: null,
      start: null, end: null, userMsgs: 0, assistantMsgs: 0, toolCalls: 0,
      outputTokens: 0, cost: 0, activeMs: 0,
    }
    let usage = null // cumulative token_count snapshots; keep the last
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line) continue
      let obj
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN
      if (Number.isFinite(ts)) {
        if (ts < sinceMs) continue
        if (s.start === null || ts < s.start) s.start = ts
        if (s.end === null || ts > s.end) s.end = ts
      }
      const p = obj.payload || obj
      if (p && typeof p.cwd === 'string' && !s.project) s.project = p.cwd
      const role = p && p.role
      if (role === 'user' || role === 'assistant') {
        const text = Array.isArray(p.content)
          ? p.content.map((c) => (c && (c.text || c.input_text)) || '').join('')
          : typeof p.content === 'string' ? p.content : ''
        if (role === 'user') {
          if (text && !text.startsWith('<')) {
            s.userMsgs += 1
            if (Number.isFinite(ts)) {
              dayBucket(out.daily, ts).prompts += 1
              const local = new Date(ts)
              out.hourly[local.getHours()] += 1
              out.weekday[local.getDay()] += 1
            }
          }
        } else {
          s.assistantMsgs += 1
          if (Number.isFinite(ts)) dayBucket(out.daily, ts).aiMsgs += 1
        }
      }
      if (p && (p.type === 'function_call' || p.type === 'local_shell_call')) {
        s.toolCalls += 1
        const tool = p.name || p.type
        out.toolUsage.set(tool, (out.toolUsage.get(tool) || 0) + 1)
      }
      const info = p && p.info
      if (info && info.total_token_usage) usage = info.total_token_usage
    }
    if (s.userMsgs + s.assistantMsgs === 0) continue
    if (usage) {
      out.totals.inputTokens += usage.input_tokens || 0
      out.totals.outputTokens += usage.output_tokens || 0
      s.outputTokens = usage.output_tokens || 0
    }
    out.sessions.push(s)
    out.totals.sessions += 1
    out.totals.userMessages += s.userMsgs
    out.totals.assistantMessages += s.assistantMsgs
    out.totals.toolCalls += s.toolCalls
  }
  return out
}
