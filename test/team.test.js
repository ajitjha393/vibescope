import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeTeam, memberName } from '../src/team.js'

function snapshot(member, prompts, agentLabel, date) {
  return {
    file: `/tmp/${member}.json`,
    data: {
      member,
      identity: [`${member}@example.com`],
      generatedAt: '2026-07-05T00:00:00.000Z',
      totals: {
        userMessages: prompts, sessions: 4, estCostUSD: prompts * 0.5,
        commits: 10, pairHours: 2.5, outputTokens: 1000, activeDays: 3,
      },
      daily: [{ date, prompts, aiMsgs: prompts * 2, outputTokens: 500, cost: 1, commits: 2 }],
      agents: [
        { id: 'x', label: agentLabel, found: true, prompts, cost: prompts * 0.5 },
        { id: 'quiet', label: 'Quiet Agent', found: true, prompts: 0, cost: 0 },
        { id: 'absent', label: 'Absent', found: false, prompts: 0, cost: 0 },
      ],
      tools: [{ name: 'Bash', count: prompts }],
      highlights: { topProject: 'alpha' },
    },
  }
}

test('merges members, sorted by prompts, with summed totals', () => {
  const team = mergeTeam([
    snapshot('alice', 10, 'Claude Code', '2026-07-01'),
    snapshot('bob', 25, 'Cursor', '2026-07-01'),
  ])
  assert.equal(team.kind, 'team')
  assert.deepEqual(team.members.map((m) => m.name), ['bob', 'alice'])
  assert.equal(team.totals.prompts, 35)
  assert.equal(team.totals.cost, 17.5)
  assert.equal(team.totals.pairHours, 5)
})

test('daily buckets sum across members and keep a byMember split', () => {
  const team = mergeTeam([
    snapshot('alice', 10, 'Claude Code', '2026-07-01'),
    snapshot('bob', 25, 'Cursor', '2026-07-01'),
  ])
  assert.equal(team.daily.length, 1)
  assert.equal(team.daily[0].prompts, 35)
  assert.deepEqual(team.daily[0].byMember, { alice: 10, bob: 25 })
})

test('agent adoption counts users per agent, ignoring quiet/absent agents', () => {
  const team = mergeTeam([
    snapshot('alice', 10, 'Claude Code', '2026-07-01'),
    snapshot('bob', 25, 'Cursor', '2026-07-01'),
    snapshot('carol', 5, 'Claude Code', '2026-07-02'),
  ])
  const byLabel = Object.fromEntries(team.agents.map((a) => [a.label, a]))
  assert.equal(byLabel['Claude Code'].users, 2)
  assert.equal(byLabel['Claude Code'].prompts, 15)
  assert.equal(byLabel['Cursor'].users, 1)
  assert.equal(byLabel['Quiet Agent'], undefined)
  assert.equal(byLabel['Absent'], undefined)
})

test('tool usage merges across members', () => {
  const team = mergeTeam([
    snapshot('alice', 10, 'Claude Code', '2026-07-01'),
    snapshot('bob', 25, 'Cursor', '2026-07-01'),
  ])
  assert.deepEqual(team.tools, [{ name: 'Bash', count: 35 }])
})

test('member name falls back: member field, identity, then filename', () => {
  const s = snapshot('alice', 1, 'Claude Code', '2026-07-01')
  assert.equal(memberName(s), 'alice')
  delete s.data.member
  assert.equal(memberName(s), 'alice@example.com')
  s.data.identity = []
  assert.equal(memberName(s), 'alice')
})
