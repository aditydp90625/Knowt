# Knowt beta-user guide

## Install and launch

Install Git for Windows and Node.js 24 LTS or newer first. Then open PowerShell and run:

```powershell
git clone https://github.com/aditydp90625/Knowt.git
cd Knowt
powershell -ExecutionPolicy Bypass -File .\tools\setup-beta.ps1
powershell -ExecutionPolicy Bypass -File .\tools\start-beta.ps1
```

The setup script checks the prerequisites, installs the project dependencies and builds Knowt. If `pnpm` is not already installed, the script automatically tries Corepack and then npm to run the pinned pnpm version. No source-code editing or administrator access is required.

Knowt listens only on `127.0.0.1` and is not published to the internet.

This Git-based beta workflow uses the Node.js installation on the user’s computer. The separate packaged-release workflow is still experimental and is not required for beta users.

## Persistence

Knowt stores data under `%LOCALAPPDATA%\\Knowt\\data`, separate from the cloned repository. The database is `knowt.sqlite`; attachments and inbox data are stored alongside it. Create a test node, close Knowt, run `start-beta.ps1` again and confirm that the node remains. The installation folder contains application files only.

If an older checkout contains `data\\knowt.sqlite`, Knowt performs a one-time migration into the per-user location when the per-user database is missing or empty. A non-empty per-user database is never overwritten.

## Launching Knowt

For the Git-based beta installation, launch with:

```powershell
powershell -ExecutionPolicy Bypass -File .\\tools\\start-beta.ps1
```

This starts the local server on `127.0.0.1:4318` and opens the browser. `Knowt.exe` is intended for a future self-contained ZIP release; it is not needed when using the repository setup instructions.

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
