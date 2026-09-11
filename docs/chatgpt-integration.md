# ChatGPT to Knowt integration

Knowt exposes a private Streamable HTTP MCP server at `http://127.0.0.1:4318/mcp`. It deliberately provides only two tools:

- `get_topical_headers` returns the current topical category names and hierarchy. It never returns Knowledge Nodes, content, IDs, counts, projects or timestamps.
- `submit_knowledge_packets` validates a versioned structured submission and stages it in the Review Queue. It never writes directly to the canonical knowledge base.

Hosted ChatGPT cannot call a loopback URL directly. The primary integration therefore uses [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels):

```text
ChatGPT developer-mode app
        |
OpenAI-hosted tunnel endpoint
        |
tunnel-client on this computer
        |
http://127.0.0.1:4318/mcp
        |
Knowt Review Queue
```

The tunnel is outbound-only. Keep Knowt bound to `127.0.0.1`; do not expose port 4318 to the internet.

## Prerequisites

You need:

- a tunnel created in [OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels);
- the resulting `tunnel_...` identifier;
- a runtime API key with Tunnels Read + Use permission;
- ChatGPT developer-mode access;
- `tunnel-client` installed from Platform tunnel settings and available on `PATH`, or its full path in `KNOWT_TUNNEL_CLIENT_PATH`.

Associate the tunnel with the ChatGPT workspace that will use Knowt. A tunnel associated only with a Platform organisation does not automatically appear in a separate ChatGPT workspace.

## Configure the local runtime

The repository wrapper passes the local MCP binding directly to `tunnel-client`, so no tunnel profile or secret file is required.

Set the non-secret tunnel identifier:

```powershell
$env:KNOWT_TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef"
```

Enter the runtime key without placing it directly in PowerShell history:

```powershell
$secureKey = Read-Host "Tunnel runtime API key" -AsSecureString
$temporaryCredential = [System.Management.Automation.PSCredential]::new("tunnel", $secureKey)
$env:CONTROL_PLANE_API_KEY = $temporaryCredential.GetNetworkCredential().Password
```

These values exist only in the current PowerShell process. Do not save the runtime key in Git, ChatGPT instructions or `.codex/config.toml`.

If `tunnel-client.exe` is not on `PATH`, set its location:

```powershell
$env:KNOWT_TUNNEL_CLIENT_PATH = "C:\path\to\tunnel-client.exe"
```

The optional `KNOWT_MCP_SERVER_URL` defaults to `http://127.0.0.1:4318/mcp` and normally should not be changed.

## Run and diagnose

Start Knowt first:

```powershell
pnpm build
pnpm --filter @knowt/server start
```

In the PowerShell process containing the tunnel environment variables, inspect the installed client's current quickstart guidance:

```powershell
pnpm tunnel:help
```

Check local server reachability and tunnel configuration:

```powershell
pnpm tunnel:doctor
```

Run the tunnel in the foreground:

```powershell
pnpm tunnel:run
```

For development, start Knowt and the tunnel together:

```powershell
pnpm dev:tunnel
```

Keep the tunnel process running while ChatGPT discovers or calls the tools. The wrapper never prints or passes `CONTROL_PLANE_API_KEY` on the command line.

The Windows `Knowt.exe` launcher can also start the tunnel when `KNOWT_TUNNEL_AUTOSTART` is `1` or `true`. This is opt-in because the launcher must inherit `CONTROL_PLANE_API_KEY` from a credential-aware parent process. When autostart is disabled or the variable is absent, the launcher starts only Knowt and direct local Codex access continues to work.

## Connect ChatGPT

1. In ChatGPT, enable developer mode under **Settings > Security and login**. An Enterprise or Edu administrator may need to grant access.
2. Open ChatGPT **Plugins** or **Apps** settings and create a developer-mode app.
3. Name the app `Knowt`.
4. Choose **Tunnel** for the connection type.
5. Select the associated tunnel, or paste its `tunnel_...` identifier.
6. Confirm that discovery finds exactly `get_topical_headers` and `submit_knowledge_packets`.

Do not enter the runtime API key, the localhost URL or `KNOWT_INGEST_API_KEY` in ChatGPT. ChatGPT selects the OpenAI-hosted tunnel; the local `tunnel-client` process owns the private server URL and runtime key.

## ChatGPT project instructions

Paste the following into the ChatGPT project's or custom agent's Instructions field:

```text
You are my engineering knowledge capture assistant, connected to my local-first Knowt knowledge base through the Knowt app. It provides two tools: get_topical_headers and submit_knowledge_packets.

At the beginning of every new conversation, before your first substantive response, call get_topical_headers exactly once. Use the returned topic names and hierarchy as the current classification vocabulary for the entire conversation. Do not claim that you know the current categories if the tool is unavailable or the call fails. The response contains headings only and must never be treated as evidence about the contents of the knowledge base. Do not attempt to call Knowt through direct HTTP requests.

Help me identify durable, reusable engineering knowledge during the conversation. Prefer small, self-contained packets over transcripts or broad summaries. A packet should preserve enough context to be useful later, state conclusions precisely, and separate unrelated ideas. Use Markdown for equations, code, lists and tables where appropriate.

For each packet choose exactly one knowledge_type:
- Reference: factual or explanatory information.
- Practice: a useful engineering technique, convention or pattern.
- Debug: a symptom, cause, diagnostic path or resolution learned while troubleshooting.
- Result: a measured, observed or experimentally obtained result with its relevant setup.

Choose the best topical path from the headers returned by get_topical_headers. Reuse an existing path when it fits. Suggest a new child heading only when no current path is suitable. Set topic.origin to "user" only when I explicitly chose that path; otherwise use "llm".

Choose a project path from information I explicitly provide. If no project is established, use ["General"]. Set project.origin to "user" when I named or selected the project; otherwise use "llm".

Do not submit automatically. When useful packets are ready, show me a concise list containing each proposed title, knowledge type, topic path and project path, and ask whether I want them sent to Knowt. Only after I explicitly approve, call submit_knowledge_packets once with all approved packets.

For submit_knowledge_packets:
- schema_version must be "1.0".
- submission_id must be unique for the logical submission; create a new UUID-prefixed value and reuse it only when retrying the identical request.
- source.system must be "ChatGPT".
- source.created_at must be the current ISO 8601 UTC timestamp.
- source.conversation_title should be a short description of this conversation when available.
- Every node needs a unique client_node_id, a concise title, one allowed knowledge_type, non-empty content_markdown, one topic path, one project path and a short deduplicated tag list.
- When I explicitly ask to retain an image with a packet, include it in that node's images array with file_name, a supported raster media_type and content_base64. Do not attach unrelated conversation images.
- Do not include private conversation material, credentials or personal data unless I explicitly ask for that exact material to be captured.

A successful submission means only that the packets were staged in Knowt's Review Queue. Tell me that review is still required; never say the packets are part of the canonical knowledge base until I approve them in Knowt. If submission fails, report the error and retain the exact payload and submission_id for a safe identical retry unless the payload itself must be corrected.
```

Test in a new conversation: confirm that ChatGPT first calls `get_topical_headers`, then approve a harmless test packet and confirm that it appears in Knowt's Review Queue.

## Keys and trust boundaries

`CONTROL_PLANE_API_KEY` authenticates `tunnel-client` to OpenAI. It is required and stays in the local process environment.

`KNOWT_INGEST_API_KEY` is a separate optional key enforced by the Knowt server on its local integration routes. Leave it unset for the standard loopback-only tunnel setup. If it is enabled later, `tunnel-client` must also be configured to send it as the `X-Knowt-Api-Key` header.

The legacy REST Action schema remains at [../contracts/chatgpt-action.openapi.json](../contracts/chatgpt-action.openapi.json) for deployments that intentionally expose a secured public HTTPS endpoint. It is not needed for Secure MCP Tunnel.

## Direct local Codex fallback

The repository-level [../.codex/config.toml](../.codex/config.toml) connects local Codex directly to Knowt at `http://127.0.0.1:4318/mcp`. This does not provide hosted ChatGPT access, but it remains useful when the tunnel is offline.
