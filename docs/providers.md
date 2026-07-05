# Writing a provider

vibescope is agent-agnostic by construction: every coding agent is one adapter
file under `src/providers/`, and the aggregator, dashboard, per-agent breakdown
and recap all work off the same normalized shape. Adding support for a new
agent means writing one module and registering it — no core changes.

## The contract

```js
export const id = 'my-agent'        // stable slug, shows up in --providers
export const label = 'My Agent'     // human name for the UI
export const experimental = true    // optional: true while format mapping is best-effort

export async function detect(opts) → boolean
// Cheap check: is this agent installed on this machine at all?
// opts carries { roots, claudeDir, cursorDir, … } — take what you need.

export async function scan(opts) → Stats
// Parse local history and return normalized stats. opts.sinceMs is the
// window start (epoch ms) — skip anything older.
```

`Stats` is:

```js
{
  found: boolean,            // false ⇒ detected but nothing parseable
  reason: string?,           // optional: why not (surfaced in the UI banner)
  sessions: [{
    id, provider,            // provider === your id
    title,                   // or null
    project,                 // absolute folder path, or null if unknowable
    start, end,              // epoch ms, or null
    userMsgs, assistantMsgs, // counts
    toolCalls, outputTokens, // 0 when the format doesn't expose them
    cost,                    // USD estimate; 0 when tokens are unknown
    activeMs,                // active pairing time (sum gaps ≤ 30 min); 0 if unknowable
  }],
  models: Map(modelId → { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost, messages }),
  daily: Map('YYYY-MM-DD' → { prompts, aiMsgs, outputTokens, cost }),   // use dayBucket() from src/util.js
  hourly: number[24],        // prompts by local hour
  weekday: number[7],        // prompts by local weekday (0 = Sunday)
  toolUsage: Map(toolName → count),
  totals: { sessions, userMessages, assistantMessages, subagentMessages,
            toolCalls, inputTokens, outputTokens, cacheReadTokens,
            cacheWriteTokens, estCostUSD },
}
```

## Ground rules

1. **Never guess.** If the agent's format doesn't persist token usage
   (Cursor, Gemini), leave the fields at 0 — a 0 reads as "unknown", a made-up
   number reads as a lie. Same for timestamps: prompts without their own
   timestamp don't get invented dates.
2. **Degrade, don't crash.** Wrap format assumptions in try/catch; return
   `found: false` with a `reason` when the data exists but can't be read
   (missing CLI dependency, schema change). The UI shows that honestly.
3. **Local only.** Providers read the filesystem. No network calls, ever —
   that's the product's core promise.
4. **Zero dependencies.** Shell out to preinstalled tools if you must (the
   Cursor adapter uses the `sqlite3` CLI); don't add npm packages.
5. **Filter noise.** Count what the human actually typed as `userMsgs` —
   injected context, system reminders and tool results are not prompts.
   See `PROMPT_NOISE` in the Claude Code provider for the pattern.

## Register it

```js
// src/providers/index.js
import * as myAgent from './my-agent.js'
export const providers = [claudeCode, cursor, codex, gemini, aider, myAgent]
```

## Test it

Craft a small fixture exercising your format's gotchas (see
`test/fixtures/claude/` and `test/claude-code.test.js`) and assert exact
totals. A provider PR without a fixture test will be asked for one.

## Reference implementations

| Provider | Reads | Good example of |
|---|---|---|
| `claude-code.js` | JSONL transcripts | rich formats: usage dedupe, tool names, active time |
| `cursor.js` | SQLite via `sqlite3` CLI | shelling out to a preinstalled tool, workspace mapping |
| `gemini.js` | JSON prompt logs | minimal counts-only format |
| `aider.js` | markdown history in repos | repo-local (not home-dir) discovery |
