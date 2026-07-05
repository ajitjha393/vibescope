import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join, basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { dayKey } from './util.js'

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

// The BASE identity is the global git config — reading the effective config
// from cwd would pick up whatever repo the CLI happens to run inside.
export async function defaultIdentity() {
  const email = (await git(['config', '--global', '--get', 'user.email'], process.cwd())).trim().toLowerCase()
  const name = (await git(['config', '--global', '--get', 'user.name'], process.cwd())).trim().toLowerCase()
  return [email, name].filter(Boolean)
}

// Discovers git repos one level under each root (plus the roots themselves)
// and counts the user's commits per day and per repo.
export async function scanGit({ roots, authors, explicitAuthors = false, sinceMs }) {
  const seen = new Set()
  const repoPaths = []
  const consider = async (p) => {
    const key = resolve(p)
    if (seen.has(key)) return // overlapping roots (e.g. cwd inside another root) must not double-count
    if (await isRepo(p)) {
      seen.add(key)
      repoPaths.push(p)
    }
  }
  for (const root of roots) {
    await consider(root)
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      await consider(join(root, e.name))
    }
  }

  const needles = authors.map((a) => a.toLowerCase()).filter(Boolean)

  const daily = new Map() // YYYY-MM-DD -> commits
  const repos = []
  let totalCommits = 0
  const since = new Date(sinceMs).toISOString()

  for (const path of repoPaths) {
    // A repo's own user config counts as "you" too — work and personal repos
    // routinely carry different identities. Explicit --authors stays strict.
    let repoNeedles = needles
    if (!explicitAuthors) {
      const localEmail = (await git(['config', '--get', 'user.email'], path)).trim().toLowerCase()
      const localName = (await git(['config', '--get', 'user.name'], path)).trim().toLowerCase()
      repoNeedles = [...new Set([...needles, localEmail, localName].filter(Boolean))]
    }
    const matches = (email, name) =>
      repoNeedles.length === 0 || repoNeedles.some((n) => email.includes(n) || name.includes(n))
    const out = await git(
      ['log', '--all', '--no-merges', `--since=${since}`, '--pretty=%ae%x09%an%x09%aI%x09%s'],
      path,
    )
    if (!out) continue
    let commits = 0
    let lastCommit = null
    const seen = new Set() // author-date + subject: stable across rebases/cherry-picks on --all branches
    for (const line of out.split('\n')) {
      if (!line) continue
      const [email = '', name = '', iso = '', subject = ''] = line.split('\t')
      if (!matches(email.toLowerCase(), name.toLowerCase())) continue
      const dedupeKey = `${iso}\t${subject}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
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
