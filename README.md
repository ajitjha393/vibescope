# ◉ vibescope

[![ci](https://github.com/ajitjha393/vibescope/actions/workflows/ci.yml/badge.svg)](https://github.com/ajitjha393/vibescope/actions/workflows/ci.yml)

**Local-first observability for the vibe-coding era — for every coding agent.**

You code with AI now. How much? Through which agents? On what repos? At what cost?
What did you even do last week? Nobody can see their own AI-assisted development —
vibescope makes it visible in one command:

```sh
npx vibescope
```

No signup, no API keys, no tracking, no cloud. It reads what's **already on your
machine** — your coding agents' local session histories and your git repos — and
opens a dashboard:

- 💸 **Estimated AI spend** — per model, per project, per day (standard API rates, cache-aware)
- 🤖 **Per-agent breakdown** — Claude Code, Cursor, Codex, Gemini, Aider… who did what
- 🔨 **What the agents did** — ranked tool invocations (Bash vs Edit vs Read vs MCP)
- 🗓 **Daily rhythm** — calendar heatmaps of prompts and commits, side by side
- ⏱ **Pair-coding time** — actual active hours with agents, idle gaps excluded
- 📁 **Where the effort went** — sessions, prompts, commits and cost per project
- 📝 **Your week, drafted** — an auto-generated standup with week-over-week trends
- 🖼 **Wrapped** — a shareable stats card, rendered and downloaded entirely client-side

## Agent-agnostic by construction

Every agent is a [provider](docs/providers.md) behind one contract — `detect()`
plus `scan()` returning normalized stats. The dashboard, per-agent breakdown and
recap work off that shape, so supporting a new agent is one file:

| Agent | Reads | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | ✅ full (tokens, cost, tools, pair time) |
| Cursor | SQLite state via bundled `sqlite3` CLI | ✅ sessions + prompts (no token data persisted) |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | 🧪 experimental |
| Gemini CLI | `~/.gemini/tmp/*/logs.json` | 🧪 experimental |
| Aider | `<repo>/.aider.chat.history.md` | 🧪 experimental |
| Your agent | [docs/providers.md](docs/providers.md) | PRs welcome |

Fields a format doesn't expose stay at zero — vibescope **never guesses**.

## Privacy

**Everything stays on your machine.** vibescope reads local files, aggregates
in-process, and serves the dashboard on `localhost`. It makes zero network
requests. The dashboard shows aggregates (counts, tokens, costs, titles) —
never your prompt or code content. The Wrapped card is rendered in your
browser and saved to your Downloads; sharing it is your call.

## Usage

```sh
npx vibescope                          # scan cwd + ~/work, serve dashboard on :4177
npx vibescope --roots ~/code,~/oss     # where your git repos live
npx vibescope --months 3               # look-back window (default 6)
npx vibescope --authors jane@co.com    # git identity match (default: your git config)
npx vibescope --providers claude-code,cursor   # scope to specific agents
npx vibescope --json > stats.json      # raw aggregated data, no server
```

> **Tip:** Claude Code prunes old sessions (default ~30 days). To build a longer
> history, raise `cleanupPeriodDays` in `~/.claude/settings.json` — vibescope can
> only see what still exists.

Cost estimation notes: token usage is deduped per API request (streamed chunks
share a `requestId`), cache reads bill at 0.1× input rate, cache writes at
1.25×/2× (5m/1h TTL), priced from each message's own model id. Subscription
users: read cost as "API-equivalent value", not a bill.

## Roadmap

- **v0.3** — Team mode: merge exported `--json` snapshots into a team dashboard (opt-in, still self-hosted)
- **v0.4** — `--compare` period dashboards · more providers (Windsurf, opencode)
- **Ideas welcome** — open an issue

## Development

```sh
git clone https://github.com/ajitjha393/vibescope && cd vibescope
node bin/vibescope.js        # no dependencies, no build step — Node ≥ 18
npm test                     # fixture-driven node:test suite
```

Zero runtime dependencies by design: the scanners are plain Node, the dashboard
is one self-contained HTML file with hand-rolled SVG charts (colorblind-validated
in light and dark). Want to add an agent? Start at [docs/providers.md](docs/providers.md).

## License

MIT
