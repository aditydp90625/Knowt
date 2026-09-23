# Knowt beta-user guide

## Install and launch

Install Git for Windows and Node.js 24 LTS or newer first. Then open PowerShell and run:

```powershell
git clone <repository-url>
cd Knowt
powershell -ExecutionPolicy Bypass -File .\tools\setup-beta.ps1
powershell -ExecutionPolicy Bypass -File .\tools\start-beta.ps1
```

The setup script checks the prerequisites, installs the project dependencies and builds Knowt. No source-code editing is required.

Knowt listens only on `127.0.0.1` and is not published to the internet.

The release includes its own Node.js runtime. Beta users do not need to install Node.js, pnpm or any developer tools.

## Persistence

Knowt stores data under `%LOCALAPPDATA%\\Knowt\\data`. Create a test node, close Knowt, launch it again and confirm that the node remains. The installation folder contains application files only.

## Codex MCP setup

1. Start Knowt.
2. Configure Codex to use `http://127.0.0.1:4318/mcp` as the Knowt MCP server.
3. Add the instructions from `docs/chatgpt-personalisation.md`.
4. Start a new Codex conversation.
5. Confirm that Codex calls `get_topical_headers` before its first substantive response.
6. Approve a harmless test packet and confirm it appears in Knowt’s Review Queue.

No tunnel-client or public network service is part of the beta setup.

## Troubleshooting

- If the browser does not open, visit `http://127.0.0.1:4318` manually.
- If startup fails, check that port 4318 is available.
- If Codex cannot connect, confirm Knowt is running and the MCP URL is exact.
- If setup reports a missing dependency, install the named tool and run the setup script again.
- To reset a beta installation, close Knowt and rename `%LOCALAPPDATA%\\Knowt` before launching again.
