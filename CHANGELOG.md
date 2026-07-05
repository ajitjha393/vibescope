# Changelog

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
