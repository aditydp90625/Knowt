# Privacy and data boundaries

Knowt is local-first. The application database and attachments belong to the person running the application.

Private runtime data is stored under `%LOCALAPPDATA%\\Knowt\\data`, not in the Git checkout or release package.

Never commit or distribute:

- SQLite database, WAL or SHM files
- `attachments`, `inbox`, `processed` or `quarantine` contents
- exported Knowt archives containing user data
- `.env` files or credentials
- private Codex configuration

The MCP interface is local and stages approved submissions in the Review Queue.
