import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, weekOverWeek } from '../src/aggregate.js'
import { dayKey } from '../src/util.js'

const DAY = 86400000
const now = Date.now()

function stats(overrides = {}) {
  return {
    found: true,
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
    ...overrides,
  }
}

function bucket(prompts, extra = {}) {
  return { prompts, aiMsgs: 0, outputTokens: 0, cost: 0, ...extra }
}

function fixture() {
  const a = stats()
  a.sessions.push({
    id: 's1', provider: 'agent-a', title: 'work', project: '/x/alpha',
    start: now - 3600000, end: now, userMsgs: 5, assistantMsgs: 9,
    toolCalls: 2, outputTokens: 10, cost: 1, activeMs: 3600000,
  })
  a.daily.set(dayKey(now), bucket(5, { cost: 1 }))
  a.daily.set(dayKey(now - 8 * DAY), bucket(10))
  a.toolUsage.set('Bash', 2)
  a.totals = { ...a.totals, sessions: 1, userMessages: 15, assistantMessages: 9, toolCalls: 2, estCostUSD: 1 }

  const b = stats()
  b.sessions.push({
    id: 's2', provider: 'agent-b', title: null, project: '/x/alpha',
    start: now - 1800000, end: now - 600000, userMsgs: 3, assistantMsgs: 4,
    toolCalls: 0, outputTokens: 0, cost: 0, activeMs: 1800000,
  })
  b.daily.set(dayKey(now), bucket(3))
  b.toolUsage.set('Edit', 1)
  b.totals = { ...b.totals, sessions: 1, userMessages: 3, assistantMessages: 4 }

  const gitData = {
    repos: [{ name: 'alpha', path: '/x/alpha', commits: 4, lastCommit: now }],
    daily: new Map([
      [dayKey(now), 4],
      [dayKey(now - 2 * DAY), 100], // bulk rebase day: many commits, zero prompts
    ]),
    totalCommits: 104,
    reposScanned: 2,
  }

  return {
    providers: [
      { id: 'agent-a', label: 'Agent A', detected: true, stats: a },
      { id: 'agent-b', label: 'Agent B', detected: true, stats: b },
      { id: 'agent-c', label: 'Agent C', detected: false, stats: null },
    ],
    gitData,
    rangeDays: 30,
    identity: ['dev@example.com'],
    sources: { git: true },
  }
}

test('multi-provider merge: totals, agents and daily byAgent splits', () => {
  const d = aggregate(fixture())
  assert.equal(d.totals.userMessages, 18)
  assert.equal(d.totals.commits, 104)
  assert.equal(d.totals.pairHours, 1.5)

  assert.equal(d.agents.length, 3)
  const byId = Object.fromEntries(d.agents.map((a) => [a.id, a]))
  assert.equal(byId['agent-a'].prompts, 15)
  assert.equal(byId['agent-a'].pairHours, 1)
  assert.equal(byId['agent-b'].sessions, 1)
  assert.equal(byId['agent-c'].found, false)

  const today = d.daily.find((x) => x.date === dayKey(now))
  assert.deepEqual(today.byAgent, { 'agent-a': 5, 'agent-b': 3 })

  const tools = Object.fromEntries(d.tools.map((t) => [t.name, t.count]))
  assert.deepEqual(tools, { Bash: 2, Edit: 1 })
})

test('busiest day ranks prompts above bulk-commit days', () => {
  const d = aggregate(fixture())
  // the 10-prompt day wins over today's 8 prompts — and the 100-commit
  // bulk-rebase day (zero prompts) never outranks either
  assert.equal(d.highlights.busiestDay.date, dayKey(now - 8 * DAY))
  assert.equal(d.highlights.busiestDay.prompts, 10)
  assert.notEqual(d.highlights.busiestDay.date, dayKey(now - 2 * DAY))
})

test('longest session uses active time, not wall-clock span', () => {
  const d = aggregate(fixture())
  assert.equal(d.highlights.longestSession.durMs, 3600000)
})

test('week-over-week compares the current and prior 7-day windows', () => {
  const daily = [
    { date: dayKey(now), prompts: 8, commits: 4, cost: 1 },
    { date: dayKey(now - 8 * DAY), prompts: 10, commits: 0, cost: 2 },
  ]
  const wow = weekOverWeek(daily, [], now)
  assert.equal(wow.prompts.cur, 8)
  assert.equal(wow.prompts.prev, 10)
  assert.equal(wow.prompts.pct, -20)
  assert.equal(wow.cost.pct, -50)
})

test('recap draft carries the trend line', () => {
  const d = aggregate(fixture())
  assert.ok(d.recap.week.includes('vs prior week'))
  assert.ok(d.recap.week.includes('alpha'))
})
