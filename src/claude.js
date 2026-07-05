import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import { estimateCost } from './pricing.js'

// Parses Claude Code session transcripts (~/.claude/projects/**/*.jsonl).
//
// Notes on the format, learned from real data:
// - Assistant lines repeat the same usage object across streamed chunks of one
//   API response (same requestId) — usage must be deduped by requestId.
// - `isMeta`, command stdout, caveats and system reminders masquerade as user
//   lines; genuine typed prompts are the rest.
// - `isSidechain: true` lines belong to subagents: their cost is real, but
//   they are not prompts the human typed.
// - `aiTitle` lines carry a generated session title.

const PROMPT_NOISE = [
  '<', // <command-name>, <local-command-stdout>, <system-reminder>, <task-notification>…
  'Caveat:',
  '[Request interrupted',
]

function extractText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function isGenuinePrompt(text) {
  const t = text.trim()
  if (t.length < 1) return false
  return !PROMPT_NOISE.some((p) => t.startsWith(p))
}

export async function scanClaude({ claudeDir = join(homedir(), '.claude', 'projects'), sinceMs = 0 } = {}) {
  const sessions = []
  const models = new Map() // model -> {inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, messages}
  const daily = new Map() // YYYY-MM-DD -> {prompts, aiMsgs, outputTokens, cost}
  const hourly = new Array(24).fill(0) // prompts by local hour
  const weekday = new Array(7).fill(0) // prompts by local weekday (0=Sun)
  const totals = {
    sessions: 0,
    userMessages: 0,
    assistantMessages: 0,
    subagentMessages: 0,
    toolCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estCostUSD: 0,
  }

  let projectDirs = []
  try {
    projectDirs = (await readdir(claudeDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => join(claudeDir, d.name))
  } catch {
    return { sessions, models, daily, hourly, weekday, totals, found: false }
  }

  for (const dir of projectDirs) {
    let files = []
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

    for (const file of files) {
      const session = {
        id: basename(file, '.jsonl'),
        title: null,
        cwds: new Map(),
        start: null,
        end: null,
        userMsgs: 0,
        assistantMsgs: 0,
        toolCalls: 0,
        outputTokens: 0,
        cost: 0,
      }
      const seenRequests = new Set()
      const seenToolIds = new Set()

      const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity })
      for await (const line of rl) {
        if (!line) continue
        let obj
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }

        if (obj.aiTitle && !session.title) session.title = String(obj.aiTitle).slice(0, 120)
        if (obj.type === 'summary' && obj.summary && !session.title) session.title = String(obj.summary).slice(0, 120)

        const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN
        if (Number.isFinite(ts)) {
          if (ts < sinceMs) continue
          if (session.start === null || ts < session.start) session.start = ts
          if (session.end === null || ts > session.end) session.end = ts
        }
        if (obj.cwd) session.cwds.set(obj.cwd, (session.cwds.get(obj.cwd) || 0) + 1)

        if (obj.type === 'assistant' && obj.message) {
          const msg = obj.message
          const key = obj.requestId || msg.id
          const dupe = key && seenRequests.has(key)
          if (key) seenRequests.add(key)

          // Streamed responses land as several lines sharing one requestId, each
          // carrying a slice of content — so tool_use blocks are deduped by their
          // own id across ALL lines, not gated on the first line per request.
          if (Array.isArray(msg.content)) {
            for (const b of msg.content) {
              if (b && b.type === 'tool_use' && b.id && !seenToolIds.has(b.id)) {
                seenToolIds.add(b.id)
                session.toolCalls += 1
              }
            }
          }

          if (msg.usage && !dupe) {
            session.assistantMsgs += 1
            totals.assistantMessages += 1
            if (obj.isSidechain) totals.subagentMessages += 1

            const u = msg.usage
            const cost = estimateCost(u, msg.model)
            const cacheWrite = u.cache_creation_input_tokens || 0

            totals.inputTokens += u.input_tokens || 0
            totals.outputTokens += u.output_tokens || 0
            totals.cacheReadTokens += u.cache_read_input_tokens || 0
            totals.cacheWriteTokens += cacheWrite
            totals.estCostUSD += cost
            session.outputTokens += u.output_tokens || 0
            session.cost += cost

            const m = models.get(msg.model) || {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cost: 0,
              messages: 0,
            }
            m.inputTokens += u.input_tokens || 0
            m.outputTokens += u.output_tokens || 0
            m.cacheReadTokens += u.cache_read_input_tokens || 0
            m.cacheWriteTokens += cacheWrite
            m.cost += cost
            m.messages += 1
            models.set(msg.model, m)

            if (Number.isFinite(ts)) {
              const d = dayBucket(daily, ts)
              d.aiMsgs += 1
              d.outputTokens += u.output_tokens || 0
              d.cost += cost
            }
          }
        }

        if (
          obj.type === 'user' &&
          !obj.isMeta &&
          !obj.isSidechain &&
          obj.message &&
          obj.message.role === 'user'
        ) {
          const text = extractText(obj.message.content)
          if (isGenuinePrompt(text)) {
            session.userMsgs += 1
            totals.userMessages += 1
            if (Number.isFinite(ts)) {
              dayBucket(daily, ts).prompts += 1
              const local = new Date(ts)
              hourly[local.getHours()] += 1
              weekday[local.getDay()] += 1
            }
          }
        }
      }

      if (session.assistantMsgs === 0 && session.userMsgs === 0) continue
      let topCwd = null
      let topCount = 0
      for (const [cwd, n] of session.cwds) if (n > topCount) ((topCwd = cwd), (topCount = n))
      sessions.push({
        id: session.id,
        title: session.title,
        project: topCwd,
        start: session.start,
        end: session.end,
        userMsgs: session.userMsgs,
        assistantMsgs: session.assistantMsgs,
        toolCalls: session.toolCalls,
        outputTokens: session.outputTokens,
        cost: session.cost,
      })
      totals.sessions += 1
      totals.toolCalls += session.toolCalls
    }
  }

  return { sessions, models, daily, hourly, weekday, totals, found: true }
}

export function dayKey(ts) {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function dayBucket(daily, ts) {
  const key = dayKey(ts)
  let b = daily.get(key)
  if (!b) {
    b = { prompts: 0, aiMsgs: 0, outputTokens: 0, cost: 0, commits: 0 }
    daily.set(key, b)
  }
  return b
}
