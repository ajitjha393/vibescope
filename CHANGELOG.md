# Changelog

## 0.3.0 — 2026-07-05

### Added
- **Team mode** — `vibescope team <snapshots…>` merges member exports
  (`--json --name <who>`) into a team dashboard: combined spend/prompts/
  pair-time tiles, per-member bars, agent adoption, team rhythm heatmap
  with per-member splits, and a member detail table
- `--name` stamps exports; `--redact` strips session titles before sharing
- Charts size to their real container and re-render on resize (no more
  letterboxed bars on wide screens or shrunken text on mobile); the two
  calendar heatmaps pair up side-by-side when they fit

### Fixed
- Default git identity reads the **global** config (running inside a repo
  with a local identity override no longer hijacks the author filter), and
  each repo's own identity joins the match set — work and personal repos
  with different emails are all yours
- Repos reachable from overlapping roots no longer double-count
- Card titles and hints no longer run together

## 0.2.0 — 2026-07-05

vibescope is now **agent-agnostic**: every coding agent is a provider behind
one contract, and the dashboard breaks activity down per agent.

### Added
- **Provider architecture** — `src/providers/` registry with a documented
  contract ([docs/providers.md](docs/providers.md)); add an agent by adding one file
- **Cursor provider** — composer sessions + per-workspace prompt/generation
  logs from Cursor's SQLite state (via the preinstalled `sqlite3` CLI)
- **Codex CLI, Gemini CLI and Aider providers** (experimental) — best-effort
  parsers that degrade gracefully and never guess
- **By-agent breakdown card**, agent column in sessions, per-agent splits in
  heatmap tooltips, parsed-agents strip in the header
- **"What the agents did"** — ranked tool-invocation breakdown
- **Pair-coding time** — active-stretch hours as a headline tile
- **Week-over-week deltas** — on the recap card and in the drafted standup
- **Wrapped share card** — one-click 1200×630 PNG export, rendered client-side
- **Tests + CI** — fixture-driven `node --test` suite, GitHub Actions matrix
- CLI: `--providers`, `--claude-dir`, `--cursor-dir`

### Fixed
- Busiest-day highlight no longer won by bulk-rebase days
- Banner only appears when an agent is installed but unreadable (with reason)

## 0.1.0 — 2026-07-05

Initial release: `npx vibescope` reads local Claude Code transcripts + git
history and serves a zero-dependency dashboard — estimated AI spend
(cache-aware), daily prompt/commit heatmaps, per-project effort, hourly
rhythm, highlights and an auto-drafted weekly recap. Local-first: nothing
ever leaves the machine.
