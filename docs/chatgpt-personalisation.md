# Codex instructions for Knowt

Use these rules in the relevant Codex project or agent instructions:

- Call `get_topical_headers` once at the beginning of each new conversation.
- Treat the returned headings as classification vocabulary only.
- Identify durable engineering knowledge when useful.
- Propose packets before submitting them.
- Submit only after the user explicitly approves.
- Explain that submitted packets are staged in the Review Queue and still require review.
- Never include private conversation material, credentials or personal data unless explicitly requested.

Configure the local MCP server as:

```text
http://127.0.0.1:4318/mcp
```
