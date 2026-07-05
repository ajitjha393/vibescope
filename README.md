# ◉ vibescope

**Local-first observability for the vibe-coding era.**

You code with AI now. How much? On what? At what cost? What did you even do last week?
Nobody can see their own AI-assisted development — vibescope makes it visible in one command:

```sh
npx vibescope
```

That's it. No signup, no API keys, no tracking, no cloud. It reads what's **already on your machine** — your Claude Code session history and your git repos — and opens a dashboard:

- 💸 **Estimated AI spend** — per model, per project, per day (standard API rates, cache-aware)
- 🗓 **Daily rhythm** — calendar heatmaps of prompts and commits, side by side
- 📁 **Where the effort went** — sessions, prompts, commits and cost per project
- ⏰ **When you vibe** — hourly and weekday rhythm, night-owl index
- 📝 **Your week, drafted** — an auto-generated standup/recap you can copy-paste
- 🏅 **Highlights** — busiest day, longest session, best streak, cache leverage

## Why

Every developer's actual workday is now split between typing code and directing agents — but all the observability tools were built for the *before* times. Editor time-trackers can't see agents. Cost dashboards can't see git. Your standup update still gets written by hand from memory.

Your machine already has the full story: `~/.claude/projects` holds every session transcript (with token usage per message), and your repos hold every commit. vibescope just connects them.

## Privacy

**Everything stays on your machine.** vibescope reads local files, aggregates them in-process, and serves the dashboard on `localhost`. It makes zero network requests. The dashboard shows aggregates (counts, tokens, costs, titles) — never your prompt or code content.

## Usage

```sh
npx vibescope                        # scan cwd + ~/work, serve dashboard on :4177
npx vibescope --roots ~/code,~/oss   # where your git repos live
npx vibescope --months 3             # look-back window (default 6)
npx vibescope --authors jane@co.com  # git identity match (default: your git config)
npx vibescope --json > stats.json    # raw aggregated data, no server
```

> **Tip:** Claude Code prunes old sessions (default ~30 days). To build a longer history, raise
> `cleanupPeriodDays` in `~/.claude/settings.json` — vibescope can only see what still exists.

## What it reads

| Source | Path | Status |
|---|---|---|
| Claude Code sessions | `~/.claude/projects/**/*.jsonl` | ✅ v0.1 |
| Git history (yours) | `<roots>/*/.git` | ✅ v0.1 |
| Cursor sessions | app support dir | 🔜 v0.2 |
| Codex / other agents | — | 🔜 |

Cost estimation notes: token usage is deduped per API request (streamed chunks share a `requestId`), cache reads bill at 0.1× input rate, cache writes at 1.25×/2× (5m/1h TTL), priced from each message's own model id. Subscription users: treat cost as "API-equivalent value", not a bill.

## Roadmap

- **v0.2** — Cursor session parsing · `--compare` period-over-period deltas
- **v0.3** — Team mode: merge exported `--json` snapshots into a team dashboard (opt-in, still self-hosted)
- **v0.4** — Wrapped: monthly shareable summary cards
- **Ideas welcome** — open an issue

## Development

```sh
git clone <this repo> && cd vibescope
node bin/vibescope.js        # no dependencies, no build step — Node ≥ 18
```

Zero runtime dependencies by design: the scanner is ~300 lines of Node, the dashboard is one self-contained HTML file with hand-rolled SVG charts.

## License

MIT
