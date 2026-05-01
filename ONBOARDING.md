# Welcome to Claude Proxy Team

## How We Use Claude

Based on Leo's usage over the last 30 days:

Work Type Breakdown:
  Build Feature   ███████░░░░░░░░░░░░░░  33%
  Debug & Fix     ███░░░░░░░░░░░░░░░░░░  17%
  Plan & Design   ███░░░░░░░░░░░░░░░░░░  17%
  Prototype       ███░░░░░░░░░░░░░░░░░░  17%
  Improve Quality ██░░░░░░░░░░░░░░░░░░░   8%
  Write Docs      ██░░░░░░░░░░░░░░░░░░░   8%

Top Skills & Commands:
  /model           ██████████░░░░░░░░░░  10x/month
  /init            ████████░░░░░░░░░░░░   8x/month
  /clear           ████████░░░░░░░░░░░░   8x/month
  /plugin          █████░░░░░░░░░░░░░░░   5x/month
  /reload-plugins  █████░░░░░░░░░░░░░░░   5x/month

Top MCP Servers:
  grok-search          ███████████████░░░░░░  15 calls
  mcp-server-firecrawl ███░░░░░░░░░░░░░░░░░░   3 calls
  exa                  █░░░░░░░░░░░░░░░░░░░░   1 call

## Your Setup Checklist

### Codebases
- [ ] claude-proxy — https://github.com/leokun1231/claude-proxy

### MCP Servers to Activate
- [ ] grok-search — xAI Grok web + X/Twitter search. Get API key from https://console.x.ai, configure in `~/.claude/.mcp-tools.json` or project `.claude/mcp.json`
- [ ] firecrawl — Web scraping and content extraction. Get API key from https://firecrawl.dev, configure in MCP settings
- [ ] exa — Semantic code and doc search. Get API key from https://exa.ai, configure in MCP settings

### Skills to Know About
- /model — switch Claude model mid-session (Opus for hard problems, Sonnet for speed)
- /init — initialize a new project with CLAUDE.md, .gitignore, and repo scaffolding
- /clear — reset conversation context, keep memory and settings
- /plugin — manage Claude Code plugins (install, list, enable, disable)
- /reload-plugins — hot-reload plugin changes without restarting Claude Code
- /mcp — list, enable, or disable MCP servers in-session
- /agents — open agent management dialog for sub-agent orchestration
- /review — trigger code review of current changes
- /config — open Claude Code settings UI

## Team Tips

_TODO_

## Get Started

_TODO_

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
