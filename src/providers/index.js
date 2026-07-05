// Provider registry — vibescope is agent-agnostic by construction.
//
// A provider is a module exporting:
//   id           stable slug ('claude-code', 'cursor', …)
//   label        human name shown in the UI
//   experimental (optional) true while the format mapping is best-effort
//   detect(opts) -> Promise<boolean>   — is this agent installed here?
//   scan(opts)   -> Promise<Stats>     — normalized stats:
//     { found, sessions[], models: Map, daily: Map, hourly[24], weekday[7],
//       toolUsage: Map, totals: {sessions, userMessages, assistantMessages,
//       toolCalls, inputTokens, outputTokens, cacheReadTokens,
//       cacheWriteTokens, estCostUSD} }
//   Every session carries `provider: id`. Fields a source can't know
//   (tokens, cost) stay 0 — never guessed.
//
// docs/providers.md walks through writing one.

import * as claudeCode from './claude-code.js'
import * as cursor from './cursor.js'

export const providers = [claudeCode, cursor]

export async function scanAll(opts = {}, onScan = () => {}) {
  const results = []
  for (const p of providers) {
    if (opts.only && opts.only.length && !opts.only.includes(p.id)) continue
    const entry = { id: p.id, label: p.label, experimental: !!p.experimental, detected: false, stats: null }
    try {
      entry.detected = await p.detect(opts)
      if (entry.detected) {
        onScan(p)
        entry.stats = await p.scan(opts)
      }
    } catch (err) {
      entry.error = String(err && err.message ? err.message : err)
    }
    results.push(entry)
  }
  return results
}
