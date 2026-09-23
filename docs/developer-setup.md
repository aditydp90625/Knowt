# Developer setup and releases

Knowt is a pnpm monorepo with a React/Vite frontend, Fastify server, SQLite persistence and shared contracts.

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

Runtime data defaults to `%LOCALAPPDATA%\\Knowt\\data` on Windows. `KNOWT_DB_PATH` can override this for tests or development.

Build a Windows beta release with:

```powershell
pnpm package:windows
```

The output is `tmp/Knowt-windows-x64.zip`. Test it from a clean directory or separate Windows user account before sharing it.

The release contains a pinned Node.js Windows x64 runtime under `runtime/`, so beta users do not need Node.js or pnpm installed. The packaging script verifies the official archive checksum before including `node.exe`.

For the simpler beta workflow, use `tools/setup-beta.ps1` followed by `tools/start-beta.ps1`. This is the recommended fallback while the self-contained ZIP packaging remains under development.
