import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { promisify } from 'node:util'
import { dayKey } from './claude.js'

const run = promisify(execFile)

const GIT_OPTS = { timeout: 20000, maxBuffer: 64 * 1024 * 1024 }

async function git(args, cwd) {
  try {
    const { stdout } = await run('git', ['-C', cwd, ...args], GIT_OPTS)
    return stdout
  } catch {
    return ''
  }
}

async function isRepo(path) {
  try {
    const s = await stat(join(path, '.git'))
    return s.isDirectory() || s.isFile() // .git file = worktree/submodule
  } catch {
    return false
  }
}

export async function defaultIdentity() {
  const email = (await git(['config', '--get', 'user.email'], process.cwd())).trim().toLowerCase()
  const name = (await git(['config', '--get', 'user.name'], process.cwd())).trim().toLowerCase()
  return [email, name].filter(Boolean)
}

// Discovers git repos one level under each root (plus the roots themselves)
// and counts the user's commits per day and per repo.
export async function scanGit({ roots, authors, sinceMs }) {
  const repoPaths = []
  for (const root of roots) {
    if (await isRepo(root)) repoPaths.push(root)
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const p = join(root, e.name)
      if (await isRepo(p)) repoPaths.push(p)
    }
  }

  const needles = authors.map((a) => a.toLowerCase()).filter(Boolean)
  const matches = (email, name) =>
    needles.length === 0 || needles.some((n) => email.includes(n) || name.includes(n))

  const daily = new Map() // YYYY-MM-DD -> commits
  const repos = []
  let totalCommits = 0
  const since = new Date(sinceMs).toISOString()

  for (const path of repoPaths) {
    const out = await git(
      ['log', '--all', '--no-merges', `--since=${since}`, '--pretty=%ae%x09%an%x09%aI'],
      path,
    )
    if (!out) continue
    let commits = 0
    let lastCommit = null
    for (const line of out.split('\n')) {
      if (!line) continue
      const [email = '', name = '', iso = ''] = line.split('\t')
      if (!matches(email.toLowerCase(), name.toLowerCase())) continue
      const ts = Date.parse(iso)
      if (!Number.isFinite(ts) || ts < sinceMs) continue
      commits += 1
      totalCommits += 1
      if (lastCommit === null || ts > lastCommit) lastCommit = ts
      const key = dayKey(ts)
      daily.set(key, (daily.get(key) || 0) + 1)
    }
    if (commits > 0) repos.push({ name: basename(path), path, commits, lastCommit })
  }

  repos.sort((a, b) => b.commits - a.commits)
  return { repos, daily, totalCommits, reposScanned: repoPaths.length }
}
