import { readFile, readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'

// Team mode merges snapshots exported by `vibescope --json --name <who>`.
// Nothing changes about the privacy model: each member exports locally and
// shares a file; the team dashboard is served from whoever runs `team`.

export async function loadSnapshots(paths) {
  const files = []
  for (const p of paths) {
    let s
    try {
      s = await stat(p)
    } catch {
      continue
    }
    if (s.isDirectory()) {
      const names = (await readdir(p)).filter((f) => f.endsWith('.json')).sort()
      files.push(...names.map((f) => join(p, f)))
    } else {
      files.push(p)
    }
  }
  const snaps = []
  for (const file of files) {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'))
      if (data && data.totals && data.daily) snaps.push({ file, data })
    } catch {
      // not a vibescope snapshot — skip
    }
  }
  return snaps
}

export function memberName(snap) {
  return (
    snap.data.member ||
    (Array.isArray(snap.data.identity) && snap.data.identity[0]) ||
    basename(snap.file, '.json')
  )
}

export function mergeTeam(snaps) {
  const members = []
  const daily = new Map() // date -> {prompts, commits, cost, byMember}
  const adoption = new Map() // agent label -> {label, users, prompts, cost}
  const tools = new Map() // tool -> count
  const totals = { prompts: 0, sessions: 0, commits: 0, cost: 0, pairHours: 0, outputTokens: 0 }

  for (const snap of snaps) {
    const d = snap.data
    const name = memberName(snap)
    const t = d.totals || {}

    const usedAgents = (d.agents || []).filter((a) => a.found && a.prompts > 0)
    members.push({
      name,
      prompts: t.userMessages || 0,
      sessions: t.sessions || 0,
      commits: t.commits || 0,
      cost: t.estCostUSD || 0,
      pairHours: t.pairHours || 0,
      outputTokens: t.outputTokens || 0,
      activeDays: t.activeDays || 0,
      agents: usedAgents.map((a) => a.label),
      topProject: (d.highlights && d.highlights.topProject) || null,
      generatedAt: d.generatedAt || null,
    })

    totals.prompts += t.userMessages || 0
    totals.sessions += t.sessions || 0
    totals.commits += t.commits || 0
    totals.cost += t.estCostUSD || 0
    totals.pairHours += t.pairHours || 0
    totals.outputTokens += t.outputTokens || 0

    for (const day of d.daily || []) {
      let b = daily.get(day.date)
      if (!b) {
        b = { prompts: 0, commits: 0, cost: 0, byMember: {} }
        daily.set(day.date, b)
      }
      b.prompts += day.prompts || 0
      b.commits += day.commits || 0
      b.cost += day.cost || 0
      if ((day.prompts || 0) > 0) b.byMember[name] = (b.byMember[name] || 0) + day.prompts
    }

    for (const a of usedAgents) {
      const row = adoption.get(a.label) || { label: a.label, users: 0, prompts: 0, cost: 0 }
      row.users += 1
      row.prompts += a.prompts
      row.cost += a.cost || 0
      adoption.set(a.label, row)
    }

    for (const tool of d.tools || []) tools.set(tool.name, (tools.get(tool.name) || 0) + tool.count)
  }

  members.sort((a, b) => b.prompts - a.prompts)
  totals.pairHours = Math.round(totals.pairHours * 10) / 10
  const dailyArr = [...daily.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => (a.date < b.date ? -1 : 1))

  return {
    kind: 'team',
    generatedAt: new Date().toISOString(),
    members,
    totals,
    daily: dailyArr,
    agents: [...adoption.values()].sort((a, b) => b.prompts - a.prompts),
    tools: [...tools.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  }
}
