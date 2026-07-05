import { basename } from 'node:path'
import { dayKey } from './claude.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function projectName(cwd) {
  if (!cwd) return '(no project)'
  return basename(cwd)
}

export function aggregate({ claude, gitData, rangeDays, identity, sources }) {
  // Merge commit counts into the daily map claude started.
  for (const [key, commits] of gitData.daily) {
    let b = claude.daily.get(key)
    if (!b) {
      b = { prompts: 0, aiMsgs: 0, outputTokens: 0, cost: 0, commits: 0 }
      claude.daily.set(key, b)
    }
    b.commits = commits
  }

  const daily = [...claude.daily.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => (a.date < b.date ? -1 : 1))

  // Per-project rollup from sessions.
  const projMap = new Map()
  for (const s of claude.sessions) {
    const key = projectName(s.project)
    const p = projMap.get(key) || { name: key, sessions: 0, prompts: 0, outputTokens: 0, cost: 0, lastActive: 0 }
    p.sessions += 1
    p.prompts += s.userMsgs
    p.outputTokens += s.outputTokens
    p.cost += s.cost
    if (s.end && s.end > p.lastActive) p.lastActive = s.end
    projMap.set(key, p)
  }
  const gitByName = new Map(gitData.repos.map((r) => [r.name, r.commits]))
  const projects = [...projMap.values()]
    .map((p) => ({ ...p, commits: gitByName.get(p.name) || 0 }))
    .sort((a, b) => b.prompts - a.prompts)
  // Repos with commits but no Claude sessions still count.
  for (const r of gitData.repos) {
    if (!projMap.has(r.name)) {
      projects.push({ name: r.name, sessions: 0, prompts: 0, outputTokens: 0, cost: 0, lastActive: r.lastCommit, commits: r.commits })
    }
  }

  const models = [...claude.models.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.cost - a.cost)

  // Highlights. Busiest day ranks prompts first — a bulk-commit day (rebases,
  // imports) shouldn't outrank a real working day; commits break ties, and a
  // git-only history still gets a commits-based answer.
  let busiest = null
  for (const d of daily) {
    const score = d.prompts * 1e6 + d.commits
    if (!busiest || score > busiest.score) busiest = { date: d.date, score, prompts: d.prompts, commits: d.commits }
  }
  if (busiest) delete busiest.score
  let longest = null
  for (const s of claude.sessions) {
    const dur = s.activeMs || 0 // active stretches only — resumed session files span days
    if (dur > 0 && (!longest || dur > longest.durMs)) {
      longest = { title: s.title, project: projectName(s.project), durMs: dur, date: dayKey(s.start) }
    }
  }
  const nightPrompts = claude.hourly.slice(22).concat(claude.hourly.slice(0, 5)).reduce((a, b) => a + b, 0)
  const nightOwlPct = claude.totals.userMessages ? Math.round((100 * nightPrompts) / claude.totals.userMessages) : 0

  let streak = 0
  let bestStreak = 0
  let prev = null
  for (const d of daily) {
    if (d.prompts + d.commits === 0) continue
    if (prev !== null) {
      const gap = (Date.parse(d.date) - Date.parse(prev)) / 86400000
      streak = gap <= 1.5 ? streak + 1 : 1
    } else streak = 1
    bestStreak = Math.max(bestStreak, streak)
    prev = d.date
  }

  const activeDays = daily.filter((d) => d.prompts + d.commits > 0).length

  const totals = {
    ...claude.totals,
    commits: gitData.totalCommits,
    reposTouched: projects.filter((p) => p.commits > 0 || p.sessions > 0).length,
    activeDays,
  }

  const highlights = {
    busiestDay: busiest,
    longestSession: longest,
    topProject: projects[0]?.name || null,
    nightOwlPct,
    bestStreak,
  }

  const recap = buildRecap({ daily, sessions: claude.sessions, projects, totals })

  const recent = [...claude.sessions]
    .filter((s) => s.end)
    .sort((a, b) => b.end - a.end)
    .slice(0, 12)
    .map((s) => ({
      title: s.title || '(untitled session)',
      project: projectName(s.project),
      date: dayKey(s.end),
      prompts: s.userMsgs,
      toolCalls: s.toolCalls,
      cost: s.cost,
    }))

  return {
    generatedAt: new Date().toISOString(),
    rangeDays,
    identity,
    sources,
    totals,
    daily,
    projects,
    models,
    hourly: claude.hourly,
    weekday: claude.weekday,
    highlights,
    recap,
    recentSessions: recent,
  }
}

function buildRecap({ daily, sessions, projects, totals }) {
  const now = Date.now()
  const weekAgo = now - 7 * 86400000
  const week = daily.filter((d) => Date.parse(d.date) >= weekAgo)
  const wPrompts = week.reduce((a, d) => a + d.prompts, 0)
  const wCommits = week.reduce((a, d) => a + d.commits, 0)
  const wCost = week.reduce((a, d) => a + d.cost, 0)
  const wSessions = sessions.filter((s) => s.end && s.end >= weekAgo)
  const wProjects = new Map()
  for (const s of wSessions) {
    const name = projectName(s.project)
    wProjects.set(name, (wProjects.get(name) || 0) + s.userMsgs)
  }
  const top = [...wProjects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const start = fmtDate(weekAgo)
  const end = fmtDate(now)

  const lines = [
    `Week of ${start} – ${end}`,
    '',
    `- Worked across ${wProjects.size || 0} project${wProjects.size === 1 ? '' : 's'}${top.length ? ': ' + top.map(([n]) => n).join(', ') : ''}`,
    `- ${wSessions.length} AI pair session${wSessions.length === 1 ? '' : 's'} (${wPrompts} prompts) · ${wCommits} commit${wCommits === 1 ? '' : 's'} authored`,
    top.length ? `- Main focus: ${top[0][0]}` : null,
    `- Est. AI spend: $${wCost.toFixed(2)}`,
    '',
    `(drafted by vibescope from local git + agent history — edit before posting)`,
  ].filter(Boolean)

  return { week: lines.join('\n') }
}
