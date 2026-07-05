import test from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scan, detect } from '../src/providers/claude-code.js'
import { estimateCost } from '../src/pricing.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude')

test('claude-code provider parses the fixture transcript correctly', async () => {
  assert.equal(await detect({ claudeDir: FIXTURES }), true)
  const s = await scan({ claudeDir: FIXTURES, sinceMs: 0 })
  assert.equal(s.found, true)

  // one session survives; meta / sidechain / system-reminder lines are not prompts
  assert.equal(s.totals.sessions, 1)
  assert.equal(s.totals.userMessages, 1)

  // streamed duplicate (same requestId) counts once; synthetic line still counts as a turn
  assert.equal(s.totals.assistantMessages, 2)

  // duplicated tool_use block (same toolu id across chunks) counts once, with its name
  assert.equal(s.totals.toolCalls, 1)
  assert.equal(s.toolUsage.get('Bash'), 1)

  // usage deduped by requestId
  assert.equal(s.totals.inputTokens, 101)
  assert.equal(s.totals.outputTokens, 51)
  assert.equal(s.totals.cacheReadTokens, 1000)
  assert.equal(s.totals.cacheWriteTokens, 200)

  // synthetic models never reach the model rollup
  assert.equal(s.models.has('claude-opus-4-8'), true)
  assert.equal(s.models.has('<synthetic>'), false)

  // cost = one opus turn + one fallback-priced synthetic turn
  const expected =
    estimateCost(
      { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 0 } },
      'claude-opus-4-8',
    ) + estimateCost({ input_tokens: 1, output_tokens: 1 }, '<synthetic>')
  assert.ok(Math.abs(s.totals.estCostUSD - expected) < 1e-12)

  const session = s.sessions[0]
  assert.equal(session.provider, 'claude-code')
  assert.equal(session.title, 'Fix login bug')
  assert.equal(session.project, '/tmp/proj-a')
  // active time spans ALL session activity (subagent + noise lines included):
  // 10:00:00 -> 10:00:05 -> 10:10:00 -> 10:11:00 -> 10:12:00 = 12 min
  assert.equal(session.activeMs, 12 * 60 * 1000)

  // prompt bins land once across hourly/weekday
  assert.equal(s.hourly.reduce((a, b) => a + b, 0), 1)
  assert.equal(s.weekday.reduce((a, b) => a + b, 0), 1)
})

test('detect is false for a missing directory', async () => {
  assert.equal(await detect({ claudeDir: join(FIXTURES, 'nope') }), false)
})
