import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { DEFAULT_DATABASE_PATH } from "./db/database.js";

describe("Knowt API", () => {
  let directory: string;
  let app: FastifyInstance;
  let mcpRequestId: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "knowt-test-"));
    app = await buildApp({ databasePath: join(directory, "knowt.sqlite"), watchInbox: false });
    mcpRequestId = 0;
  });

  afterEach(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function fixtures() {
    const topic = (await app.inject({ method: "GET", url: "/api/taxonomy/topic" })).json();
    const project = (await app.inject({ method: "GET", url: "/api/taxonomy/project" })).json();
    const types = (await app.inject({ method: "GET", url: "/api/knowledge-types" })).json();
    return {
      digital: topic.categories.find((item: { name: string }) => item.name === "Digital Design"),
      general: project.categories.find((item: { name: string }) => item.name === "General"),
      debug: types.find((item: { name: string }) => item.name === "Debug"),
    };
  }

  async function mcpRequest(method: string, params: Record<string, unknown>) {
    mcpRequestId += 1;
    return app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      payload: { jsonrpc: "2.0", id: mcpRequestId, method, params },
    });
  }

  it("creates, searches, revisions, deletes and restores a Knowledge Node", async () => {
    const { digital, general, debug } = await fixtures();
    const createdResponse = await app.inject({ method: "POST", url: "/api/nodes", payload: {
      title: "AXI DMA descriptor alignment",
      contentMarkdown: "Descriptors require aligned addresses.",
      knowledgeTypeId: debug.id,
      topicCategoryId: digital.id,
      projectCategoryId: general.id,
      tags: ["DMA", "dma", "AXI"],
      sourceType: "Personal experiment",
    } });
    expect(createdResponse.statusCode).toBe(201);
    const node = createdResponse.json();
    expect(node.tags).toEqual(["AXI", "DMA"]);

    const search = await app.inject({ method: "GET", url: "/api/search?q=descriptor" });
    expect(search.json()[0].id).toBe(node.id);

    const updated = await app.inject({ method: "PUT", url: `/api/nodes/${node.id}`, payload: {
      title: "AXI DMA descriptor rules",
      contentMarkdown: node.contentMarkdown,
      knowledgeTypeId: node.knowledgeTypeId,
      topicCategoryId: node.topicCategoryId,
      projectCategoryId: node.projectCategoryId,
      tags: ["AXI"],
      expectedVersion: node.version,
    } });
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/nodes/${node.id}/revisions` })).json()).toHaveLength(2);

    expect((await app.inject({ method: "DELETE", url: `/api/nodes/${node.id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/trash" })).json()).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: `/api/nodes/${node.id}/restore` })).statusCode).toBe(200);
  });

  it("prevents category cycles and previews redistribution", async () => {
    const topic = (await app.inject({ method: "GET", url: "/api/taxonomy/topic" })).json();
    const digital = topic.categories.find((item: { name: string }) => item.name === "Digital Design");
    const fpga = (await app.inject({ method: "POST", url: "/api/categories", payload: { workspace: "topic", parentId: digital.id, name: "FPGA" } })).json();
    const axi = (await app.inject({ method: "POST", url: "/api/categories", payload: { workspace: "topic", parentId: fpga.id, name: "AXI" } })).json();
    const cycle = await app.inject({ method: "POST", url: `/api/categories/${fpga.id}/move`, payload: { parentId: axi.id } });
    expect(cycle.statusCode).toBe(422);
    const preview = await app.inject({ method: "GET", url: `/api/categories/${axi.id}/deletion-preview` });
    expect(preview.json().destination.id).toBe(fpga.id);
  });

  it("searches category names as well as knowledge nodes", async () => {
    const topic = (await app.inject({ method: "GET", url: "/api/taxonomy/topic" })).json();
    const digital = topic.categories.find((item: { name: string }) => item.name === "Digital Design");
    const category = (await app.inject({ method: "POST", url: "/api/categories", payload: {
      workspace: "topic", parentId: digital.id, name: "FPGA Interfaces",
    } })).json();
    const results = (await app.inject({ method: "GET", url: "/api/search?q=interfaces" })).json();
    expect(results).toContainEqual(expect.objectContaining({
      kind: "category",
      id: category.id,
      name: "FPGA Interfaces",
      workspace: "topic",
      path: [expect.objectContaining({ name: "Digital Design" }), expect.objectContaining({ name: "FPGA Interfaces" })],
    }));
  });

  it("stages structured submissions until approval", async () => {
    const response = await app.inject({ method: "POST", url: "/api/inbox/submissions", payload: {
      schema_version: "1.0",
      submission_id: "submission-one",
      source: { system: "ChatGPT", created_at: "2026-09-07T12:00:00Z", conversation_title: "CDC discussion" },
      nodes: [{
        client_node_id: "node-1",
        title: "Clock domain crossing synchronizer",
        knowledge_type: "Reference",
        content_markdown: "Use a two-flop synchronizer for a single-bit level signal.",
        topic: { path_hint: ["Digital Design"], origin: "llm" },
        project: { path_hint: ["General"], origin: "user" },
        tags: ["CDC"],
      }],
    } });
    expect(response.statusCode).toBe(202);
    expect((await app.inject({ method: "GET", url: "/api/search?q=synchronizer" })).json()).toEqual([]);
    const proposal = (await app.inject({ method: "GET", url: "/api/proposals?status=pending" })).json()[0];
    expect((await app.inject({ method: "POST", url: `/api/proposals/${proposal.id}/approve`, payload: {} })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/search?q=synchronizer" })).json()).toHaveLength(1);
  });

  it("uses Review Queue edits when approving an entire submission", async () => {
    const { digital, general, debug } = await fixtures();
    await app.inject({ method: "POST", url: "/api/inbox/submissions", payload: {
      schema_version: "1.0",
      submission_id: "edited-batch",
      source: { system: "ChatGPT", created_at: "2026-09-07T12:00:00Z" },
      nodes: [{
        client_node_id: "edited-node",
        title: "Original proposal title",
        knowledge_type: "Reference",
        content_markdown: "Original content.",
        topic: { path_hint: ["Digital Design"], origin: "llm" },
        project: { path_hint: ["General"], origin: "llm" },
        tags: [],
      }, {
        client_node_id: "unchanged-node",
        title: "Unchanged proposal",
        knowledge_type: "Reference",
        content_markdown: "Unchanged content.",
        topic: { path_hint: ["Digital Design"], origin: "llm" },
        project: { path_hint: ["General"], origin: "llm" },
        tags: [],
      }],
    } });
    const pending = (await app.inject({ method: "GET", url: "/api/proposals?status=pending" })).json();
    const edited = pending.find((item: { clientNodeId: string }) => item.clientNodeId === "edited-node");
    const response = await app.inject({ method: "POST", url: `/api/submissions/${edited.submissionId}/approve-all`, payload: {
      nodes: {
        [edited.id]: {
          title: "Edited proposal title",
          contentMarkdown: "Edited content retained on approval.",
          knowledgeTypeId: debug.id,
          topicCategoryId: digital.id,
          projectCategoryId: general.id,
          tags: ["reviewed"],
          sourceType: "ChatGPT conversation",
          sourceDetails: "Edited during review",
        },
      },
    } });
    expect(response.statusCode, response.body).toBe(200);
    const approved = response.json().find((item: { clientNodeId: string }) => item.clientNodeId === "edited-node");
    const node = (await app.inject({ method: "GET", url: `/api/nodes/${approved.canonicalNodeId}` })).json();
    expect(node).toMatchObject({
      title: "Edited proposal title",
      contentMarkdown: "Edited content retained on approval.",
      knowledgeType: "Debug",
      tags: ["reviewed"],
      sourceDetails: "Edited during review",
    });
  });

  it("returns only the current topical header hierarchy to integrations", async () => {
    const response = await app.inject({ method: "GET", url: "/api/inbox/topical-headers" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.schema_version).toBe("1.0");
    expect(body.topics.find((topic: { name: string }) => topic.name === "Tools").children)
      .toEqual(expect.arrayContaining([{ name: "Altium", children: [] }, { name: "Vivado", children: [] }]));
    expect(JSON.stringify(body)).not.toContain("descendantNodeCount");
    expect(JSON.stringify(body)).not.toContain("id");
  });

  it("can require an integration API key without affecting local development defaults", async () => {
    const previousKey = process.env.KNOWT_INGEST_API_KEY;
    process.env.KNOWT_INGEST_API_KEY = "test-integration-secret";
    try {
      expect((await app.inject({ method: "GET", url: "/api/inbox/topical-headers" })).statusCode).toBe(401);
      expect((await app.inject({
        method: "GET",
        url: "/api/inbox/topical-headers",
        headers: { "x-knowt-api-key": "test-integration-secret" },
      })).statusCode).toBe(200);
    } finally {
      if (previousKey === undefined) delete process.env.KNOWT_INGEST_API_KEY;
      else process.env.KNOWT_INGEST_API_KEY = previousKey;
    }
  });

  it("exposes safe inbox ingestion through MCP", async () => {
    const initialized = await mcpRequest("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "knowt-test", version: "1.0.0" },
    });
    expect(initialized.statusCode).toBe(200);
    expect(initialized.json().result.serverInfo.name).toBe("knowt");
    expect(initialized.json().result.instructions).toContain("Review Queue");

    const tools = await mcpRequest("tools/list", {});
    expect(tools.statusCode).toBe(200);
    expect(tools.json().result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "get_topical_headers",
      "submit_knowledge_packets",
    ]);

    const topicalHeaders = await mcpRequest("tools/call", {
      name: "get_topical_headers",
      arguments: {},
    });
    expect(topicalHeaders.statusCode).toBe(200);
    expect(topicalHeaders.json().result.structuredContent.topics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "Tools" })]));
    expect(JSON.stringify(topicalHeaders.json())).not.toContain("descendantNodeCount");

    const submitted = await mcpRequest("tools/call", {
      name: "submit_knowledge_packets",
      arguments: {
        schema_version: "1.0",
        submission_id: "mcp-submission-one",
        source: { system: "ChatGPT", created_at: "2026-09-08T12:00:00Z", conversation_title: "MCP test" },
        nodes: [{
          client_node_id: "mcp-node-1",
          title: "MCP staged knowledge",
          knowledge_type: "Reference",
          content_markdown: "This packet should remain staged for review.",
          topic: { path_hint: ["Digital Design"], origin: "llm" },
          project: { path_hint: ["General"], origin: "llm" },
          tags: ["MCP"],
          images: [{
            file_name: "one-pixel.png",
            media_type: "image/png",
            content_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          }],
        }],
      },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().result.structuredContent).toMatchObject({
      status: "staged_for_review",
      submission_id: "mcp-submission-one",
      proposal_count: 1,
    });
    const pending = (await app.inject({ method: "GET", url: "/api/proposals?status=pending" })).json();
    expect(pending).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/api/search?q=MCP" })).json()).toEqual([]);
    const approved = (await app.inject({ method: "POST", url: `/api/proposals/${pending[0].id}/approve`, payload: {} })).json();
    const nodeAttachments = (await app.inject({ method: "GET", url: `/api/nodes/${approved.canonicalNodeId}/attachments` })).json();
    expect(nodeAttachments).toEqual([expect.objectContaining({ originalName: "one-pixel.png", mediaType: "image/png" })]);
  });

  it("exports a validated portable archive", async () => {
    const response = await app.inject({ method: "GET", url: "/api/export" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/zip");
    expect(response.rawPayload.byteLength).toBeGreaterThan(500);
  });

  it("provides and persists configurable keyboard shortcuts", async () => {
    const original = (await app.inject({ method: "GET", url: "/api/settings" })).json();
    expect(original.hotkeys).toMatchObject({ search: "Mod+K", deleteSelected: "Delete" });
    const updated = await app.inject({ method: "PUT", url: "/api/settings", payload: {
      ...original,
      hotkeys: { ...original.hotkeys, search: "Mod+F" },
    } });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().hotkeys.search).toBe("Mod+F");
    expect((await app.inject({ method: "GET", url: "/api/settings" })).json().hotkeys.search).toBe("Mod+F");
  });

  it("anchors the default database path to the repository instead of the launch directory", () => {
    expect(DEFAULT_DATABASE_PATH.toLowerCase()).toContain("knowt");
    expect(DEFAULT_DATABASE_PATH.toLowerCase()).toContain("knowt.sqlite");
  });

  it("migrates the legacy global node-visibility layout to categories-only mode", async () => {
    const { digital } = await fixtures();
    const response = await app.inject({
      method: "PUT",
      url: `/api/layout/topic/${digital.id}`,
      payload: {
        viewport: { x: 0, y: 0, zoom: 1 },
        expandedCategoryIds: [digital.id],
        showKnowledgeNodes: false,
        positions: {},
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ showAllCategories: true, expandedCategoryIds: [] });
    expect(response.json()).not.toHaveProperty("showKnowledgeNodes");
  });

  it("serves frontend assets created after the server starts", async () => {
    await app.close();
    const webDirectory = join(directory, "web");
    mkdirSync(join(webDirectory, "assets"), { recursive: true });
    writeFileSync(join(webDirectory, "index.html"), '<script type="module" src="/assets/current.js"></script>');
    app = await buildApp({
      databasePath: join(directory, "static.sqlite"),
      watchInbox: false,
      webDirectory,
    });

    writeFileSync(join(webDirectory, "assets", "current.js"), "window.knowtLoaded = true;");
    const asset = await app.inject({ method: "GET", url: "/assets/current.js" });

    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("javascript");
    expect(asset.body).toBe("window.knowtLoaded = true;");
  });
});
