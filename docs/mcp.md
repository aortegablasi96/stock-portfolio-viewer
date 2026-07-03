# MCP Servers

Stock Portfolio Viewer configures its Model Context Protocol (MCP) servers in
[`.mcp.json`](../.mcp.json). Which of them are enabled for a given machine is controlled by
`enabledMcpjsonServers` in `.claude/settings.local.json` (that file is machine-specific and
git-ignored).

## Configured servers

| Server | Command | Purpose |
| --- | --- | --- |
| `context7` | `npx -y @upstash/context7-mcp` | Up-to-date framework/library documentation (preferred over model memory). |
| `playwright` | `npx -y @playwright/mcp@latest` | Browser automation / inspection during development. |
| `filesystem` | `npx -y @modelcontextprotocol/server-filesystem .` | Scoped file access, limited to the project directory. |
| `interactive-brokers` | _pending — see below_ | Local Interactive Brokers data access. |

The legacy `postgres` server has been **retired**: the project uses embedded SQLite (see
[ADR-0003](decisions/0003-sqlite-drizzle-persistence.md)), so it is removed from both
`.mcp.json` and `enabledMcpjsonServers`.

## Interactive Brokers — runtime pending

The `interactive-brokers` entry in `.mcp.json` is intentionally a **placeholder**
(`REPLACE_WITH_RUNTIME` / `REPLACE_WITH_IBKR_MCP_SERVER`). A local IBKR MCP runtime has not
yet been finalized, so this server is **not functional** until those values are replaced. It
is kept in the configuration to reserve the integration point and document intent.

In the meantime, a separately connected, hosted `Interactive_Brokers_IBKR` MCP provides
**read-only** account and market tools (positions, balances, price history, etc.). No
order-placing tools are allowlisted, consistent with the analytics-first, no-trading stance
(see `CLAUDE.md`). Feature work that needs live brokerage data (M1+) relies on that hosted
MCP until the local runtime is finalized.

When the local runtime is chosen, replace the placeholder `command`/`args`, confirm the
`IBKR_GATEWAY_URL` / `IBKR_ACCOUNT_ID` environment values, and record the decision as an ADR.
