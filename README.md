# Knowt

Knowt is a local-first engineering knowledge system. It stores Knowledge Nodes, topical and project trees, revisions, attachments and a Review Queue on the user’s own computer.

## Beta user quick start

Beta users do not need to edit the source code. Clone the repository, then run the setup script from PowerShell:

```powershell
git clone <repository-url>
cd Knowt
powershell -ExecutionPolicy Bypass -File .\tools\setup-beta.ps1
powershell -ExecutionPolicy Bypass -File .\tools\start-beta.ps1
```

The setup script checks Git, Node.js and pnpm, installs dependencies and builds Knowt. The start script launches the local server and opens the browser.

Knowt creates its private database under `%LOCALAPPDATA%\\Knowt\\data`; the repository does not contain the maintainer’s database or Knowledge Nodes.

See [docs/user-installation.md](docs/user-installation.md) for the complete beta-user guide.

## Codex integration

Beta users should use Codex for MCP integration. Knowt exposes a local MCP endpoint at `http://127.0.0.1:4318/mcp`. See [docs/chatgpt-personalisation.md](docs/chatgpt-personalisation.md). No tunnel-client or public endpoint is required.

## Developer setup

Prerequisites: Node.js 24 or newer and pnpm 11.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

For a production-style run:

```powershell
pnpm build
pnpm --filter @knowt/server start
```

Run verification with `pnpm check`. See [docs/developer-setup.md](docs/developer-setup.md).

## Release packaging

```powershell
pnpm package:windows
```

This writes `tmp/Knowt-windows-x64.zip`, bundles the pinned Node.js Windows x64 runtime, and checks that private databases, attachments, environment files and Codex configuration are excluded.

## Data and privacy

Runtime data is stored outside the repository under `%LOCALAPPDATA%\\Knowt\\data`: the SQLite database, attachments, inbox, processed submissions and quarantine. Do not commit or distribute these files. See [docs/privacy-and-data.md](docs/privacy-and-data.md).
