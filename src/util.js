// Shared date bucketing — all providers bin activity the same way.

export function dayKey(ts) {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function dayBucket(daily, ts) {
  const key = dayKey(ts)
  let b = daily.get(key)
  if (!b) {
    b = { prompts: 0, aiMsgs: 0, outputTokens: 0, cost: 0, commits: 0 }
    daily.set(key, b)
  }
  return b
}
