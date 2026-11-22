<img src="https://raw.githubusercontent.com/areaform/areaform/main/brand/logo.svg" alt="Areaform" width="64" height="64" />

# @areaform/mcp

An [MCP](https://modelcontextprotocol.io) server that lets an agent such as Claude build an [Areaform](https://github.com/areaform/areaform) plan, a **Draft**, from a Figma frame or an image, and update a saved plan from your own records. The agent builds the plan through the core's Commands, so every step meets the same Invariants as an edit by hand; a person then reviews the Draft in the editor.

Tools: `create_draft`, `open_document`, `attach_source`, `calibrate`, `source_to_plan`, `apply_commands`, `match_zones`, `get_document`, `get_diagnostics`, `flag`, `render_preview`, `save_document`, `figma_extract`.

Requires Node 24. With Claude Code:

```sh
claude mcp add -s user areaform -- npx -y @areaform/mcp
```

`figma_extract` needs a Figma personal access token in the server's environment as `FIGMA_TOKEN` (add `-e FIGMA_TOKEN=…`).

See the [MCP guide](https://github.com/areaform/areaform/blob/main/docs/guides/mcp.md) for Claude Desktop, the Figma convention, reviewing a Draft and measured quality.

## License

MIT
