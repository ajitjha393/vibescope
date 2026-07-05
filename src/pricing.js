// Per-MTok USD pricing, matched by model-id substring (most specific first).
// Cache reads bill at 0.1x input; cache writes at 1.25x (5m TTL) or 2x (1h TTL).
const PRICING = [
  { match: /fable-5|mythos/, input: 10, output: 50 },
  { match: /opus-4-[5-9]/, input: 5, output: 25 },
  { match: /opus/, input: 15, output: 75 },
  { match: /sonnet/, input: 3, output: 15 },
  { match: /haiku-4/, input: 1, output: 5 },
  { match: /haiku/, input: 0.8, output: 4 },
]

const FALLBACK = { input: 5, output: 25 }

export function ratesFor(model = '') {
  const m = String(model).toLowerCase()
  for (const p of PRICING) if (p.match.test(m)) return p
  return FALLBACK
}

// usage: an Anthropic API usage object from a Claude Code session line.
export function estimateCost(usage, model) {
  if (!usage) return 0
  const r = ratesFor(model)
  const per = 1e6
  const input = (usage.input_tokens || 0) * r.input
  const output = (usage.output_tokens || 0) * r.output
  const cacheRead = (usage.cache_read_input_tokens || 0) * r.input * 0.1
  let cacheWrite = 0
  const cc = usage.cache_creation
  if (cc && (cc.ephemeral_5m_input_tokens || cc.ephemeral_1h_input_tokens)) {
    cacheWrite =
      (cc.ephemeral_5m_input_tokens || 0) * r.input * 1.25 +
      (cc.ephemeral_1h_input_tokens || 0) * r.input * 2
  } else {
    cacheWrite = (usage.cache_creation_input_tokens || 0) * r.input * 1.25
  }
  return (input + output + cacheRead + cacheWrite) / per
}
