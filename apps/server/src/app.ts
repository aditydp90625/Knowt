import { createReadStream, existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  categoryCreateSchema,
  categoryMoveSchema,
  categoryRenameSchema,
  defaultHotkeys,
  layoutStateSchema,
  nodeMoveSchema,
  nodeWriteSchema,
  proposalBatchDecisionSchema,
  proposalDecisionSchema,
  workspaceSchema,
} from "@knowt/contracts";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z, ZodError } from "zod";
import { createDatabase, type DatabaseContext } from "./db/database.js";
import { seedDatabase } from "./db/seed.js";
import { attachments, knowledgeTypes, layoutStates } from "./db/schema.js";
import { DomainError, notFound, unauthorized } from "./domain/errors.js";
import { AttachmentRepository } from "./repositories/attachment-repository.js";
import { CategoryRepository } from "./repositories/category-repository.js";
import { NodeRepository } from "./repositories/node-repository.js";
import { ProposalRepository } from "./repositories/proposal-repository.js";
import { SettingsRepository } from "./repositories/settings-repository.js";
import { createKnowtMcpServer } from "./mcp/knowt-mcp-server.js";
import { IngestionService } from "./services/ingestion-service.js";
import { InboxWatcher } from "./services/inbox-watcher.js";
import { PortabilityService } from "./services/portability-service.js";

const idParams = z.object({ id: z.string().uuid() });
const revisionParams = z.object({ id: z.string().uuid(), revisionId: z.string().uuid() });
const taxonomyParams = z.object({ workspace: workspaceSchema });
const layoutParams = z.object({ workspace: workspaceSchema, rootId: z.string().uuid() });
const proposalListQuery = z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() });
const searchQuery = z.object({ q: z.string().trim().min(1).max(240) });
const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  inboxPath: z.string().trim().min(1).max(1_000),
  rejectedRetentionDays: z.number().int().min(1).max(365),
  hotkeys: z.object({
    search: z.string().min(1).max(80),
    newKnowledge: z.string().min(1).max(80),
    openSelected: z.string().min(1).max(80),
    deleteSelected: z.string().min(1).max(80),
    expandAll: z.string().min(1).max(80),
    collapseAll: z.string().min(1).max(80),
    topicalWorkspace: z.string().min(1).max(80),
    projectWorkspace: z.string().min(1).max(80),
    reviewQueue: z.string().min(1).max(80),
    settings: z.string().min(1).max(80),
  }).default(defaultHotkeys),
});
const createParentSchema = z.object({
  workspace: workspaceSchema,
  categoryIds: z.array(z.string().uuid()).default([]),
  nodeIds: z.array(z.string().uuid()).default([]),
  name: z.string().trim().min(1).max(120),
});

function requireIntegrationKey(request: FastifyRequest): void {
  const expected = process.env.KNOWT_INGEST_API_KEY;
  if (!expected) return;
  const supplied = request.headers["x-knowt-api-key"];
  if (supplied !== expected) throw unauthorized("A valid Knowt integration API key is required");
}

export interface AppOptions {
  databasePath?: string;
  watchInbox?: boolean;
  logger?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 60 * 1024 * 1024 });
  const context = createDatabase(options.databasePath);
  seedDatabase(context);
  const categoryRepository = new CategoryRepository(context);
  const nodeRepository = new NodeRepository(context);
  const attachmentRepository = new AttachmentRepository(context);
  const proposalRepository = new ProposalRepository(context);
  const settingsRepository = new SettingsRepository(context);
  const ingestion = new IngestionService(categoryRepository, proposalRepository);
  const portability = new PortabilityService(context, attachmentRepository, settingsRepository);
  const inboxWatcher = new InboxWatcher(proposalRepository);

  await app.register(cors, { origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ });
  await app.register(multipart, { limits: { fileSize: 55 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message, details: error.details });
    }
    if (error instanceof ZodError) {
      return reply.status(422).send({ error: "validation_error", message: "The request is invalid", details: error.issues });
    }
    if ((error as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT")) {
      return reply.status(409).send({ error: "constraint_error", message: "That change conflicts with existing knowledge" });
    }
    app.log.error(error);
    return reply.status(500).send({ error: "internal_error", message: "Knowt could not complete the request" });
  });

  app.get("/api/health", async () => ({ status: "ok", schemaVersion: (context.sqlite.prepare("PRAGMA user_version").get() as { user_version: number }).user_version }));

  app.get("/api/knowledge-types", async () => context.orm.select().from(knowledgeTypes)
    .orderBy(asc(knowledgeTypes.sortOrder)).all().map((item) => ({
      id: item.id, name: item.name, description: item.description, enabled: item.enabled,
      sortOrder: item.sortOrder, templateMarkdown: item.templateMarkdown,
    })));

  app.get("/api/taxonomy/:workspace", async (request) => {
    const { workspace } = taxonomyParams.parse(request.params);
    return { categories: categoryRepository.list(workspace), nodes: nodeRepository.list() };
  });

  app.post("/api/categories", async (request, reply) => {
    const input = categoryCreateSchema.parse(request.body);
    return reply.status(201).send(categoryRepository.create(input.workspace, input.parentId, input.name));
  });

  app.patch("/api/categories/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = categoryRenameSchema.parse(request.body);
    return categoryRepository.rename(id, input.name);
  });

  app.post("/api/categories/:id/move", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = categoryMoveSchema.parse(request.body);
    return categoryRepository.move(id, input.parentId);
  });

  app.post("/api/categories/create-parent", async (request, reply) => {
    const input = createParentSchema.parse(request.body);
    return reply.status(201).send(categoryRepository.createParent(input.workspace, input.categoryIds, input.nodeIds, input.name));
  });

  app.get("/api/categories/:id/deletion-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    return categoryRepository.previewDeletion(id);
  });

  app.delete("/api/categories/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    categoryRepository.delete(id);
    return reply.status(204).send();
  });

  app.get("/api/nodes/:id", async (request) => nodeRepository.get(idParams.parse(request.params).id));
  app.post("/api/nodes", async (request, reply) => reply.status(201).send(nodeRepository.create(nodeWriteSchema.parse(request.body))));
  app.put("/api/nodes/:id", async (request) => nodeRepository.update(idParams.parse(request.params).id, nodeWriteSchema.parse(request.body)));
  app.post("/api/nodes/:id/move", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = nodeMoveSchema.parse(request.body);
    return nodeRepository.move(id, input.workspace, input.categoryId, input.expectedVersion);
  });
  app.delete("/api/nodes/:id", async (request, reply) => {
    nodeRepository.softDelete(idParams.parse(request.params).id);
    return reply.status(204).send();
  });
  app.get("/api/trash", async () => nodeRepository.list(true).filter((node) => node.deletedAt));
  app.post("/api/nodes/:id/restore", async (request) => nodeRepository.restoreFromTrash(idParams.parse(request.params).id));
  app.delete("/api/nodes/:id/permanent", async (request, reply) => {
    const storedNames = nodeRepository.permanentlyDelete(idParams.parse(request.params).id);
    attachmentRepository.removeUnreferencedFiles(storedNames);
    return reply.status(204).send();
  });
  app.get("/api/nodes/:id/revisions", async (request) => nodeRepository.revisions(idParams.parse(request.params).id));
  app.post("/api/nodes/:id/revisions/:revisionId/restore", async (request) => {
    const { id, revisionId } = revisionParams.parse(request.params);
    return nodeRepository.restoreRevision(id, revisionId);
  });

  app.get("/api/search", async (request) => {
    const { q } = searchQuery.parse(request.query);
    return [...categoryRepository.search(q), ...nodeRepository.search(q)].slice(0, 100);
  });

  app.get("/api/layout/:workspace/:rootId", async (request) => {
    const { workspace, rootId } = layoutParams.parse(request.params);
    const row = context.orm.select().from(layoutStates).where(and(
      eq(layoutStates.workspace, workspace), eq(layoutStates.rootId, rootId),
    )).get();
    return row ? layoutStateSchema.parse(JSON.parse(row.stateJson)) : null;
  });
  app.put("/api/layout/:workspace/:rootId", async (request) => {
    const { workspace, rootId } = layoutParams.parse(request.params);
    const state = layoutStateSchema.parse(request.body);
    context.orm.insert(layoutStates).values({
      workspace, rootId, stateJson: JSON.stringify(state), updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({
      target: [layoutStates.workspace, layoutStates.rootId],
      set: { stateJson: JSON.stringify(state), updatedAt: new Date().toISOString() },
    }).run();
    return state;
  });

  app.get("/api/nodes/:id/attachments", async (request) => attachmentRepository.list(idParams.parse(request.params).id));
  app.post("/api/nodes/:id/attachments", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const file = await request.file();
    if (!file) throw notFound("No attachment was supplied");
    const attachment = attachmentRepository.add(id, basename(file.filename), file.mimetype, await file.toBuffer());
    return reply.status(201).send(attachment);
  });
  app.get("/api/attachments/:id/content", async (request, reply) => {
    const { attachment, path } = attachmentRepository.get(idParams.parse(request.params).id);
    reply.type(attachment.mediaType);
    reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`);
    return reply.send(createReadStream(path));
  });
  app.delete("/api/attachments/:id", async (request, reply) => {
    attachmentRepository.softDelete(idParams.parse(request.params).id);
    return reply.status(204).send();
  });

  app.get("/api/inbox/schema", async (_request, reply) => {
    const path = fileURLToPath(new URL("../../../contracts/inbox-v1.schema.json", import.meta.url));
    reply.type("application/schema+json");
    return reply.send(JSON.parse(readFileSync(path, "utf8")));
  });
  app.get("/api/inbox/topical-headers", async (request) => {
    requireIntegrationKey(request);
    return ingestion.topicalHeaders();
  });
  app.post("/api/inbox/submissions", async (request, reply) => {
    requireIntegrationKey(request);
    return reply.status(202).send(ingestion.stageSubmission(request.body));
  });

  app.post("/mcp", async (request, reply) => {
    requireIntegrationKey(request);
    const server = createKnowtMcpServer(ingestion);
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const close = async () => {
      await transport.close();
      await server.close();
    };

    reply.hijack();
    reply.raw.once("close", () => void close());
    try {
      // The SDK's Node transport callback accessors conflict with exactOptionalPropertyTypes,
      // although it implements the Transport contract at runtime.
      await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      request.log.error(error);
      await close();
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
        reply.raw.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal MCP server error" },
          id: null,
        }));
      }
    }
  });
  app.route({
    method: ["GET", "DELETE"],
    url: "/mcp",
    handler: async (_request, reply) => reply
      .header("Allow", "POST")
      .status(405)
      .send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }),
  });
  app.get("/api/proposals", async (request) => proposalRepository.list(proposalListQuery.parse(request.query).status));
  app.post("/api/proposals/:id/approve", async (request) => {
    const { id } = idParams.parse(request.params);
    return proposalRepository.approve(id, proposalDecisionSchema.parse(request.body ?? {}).node);
  });
  app.post("/api/proposals/:id/reject", async (request) => proposalRepository.reject(idParams.parse(request.params).id));
  app.post("/api/submissions/:id/approve-all", async (request) => {
    const { id } = idParams.parse(request.params);
    return proposalRepository.approveAll(id, proposalBatchDecisionSchema.parse(request.body ?? {}).nodes);
  });

  app.get("/api/settings", async () => settingsRepository.get());
  app.put("/api/settings", async (request) => {
    const value = settingsRepository.update(settingsSchema.parse(request.body));
    if (options.watchInbox !== false) await inboxWatcher.start(value.inboxPath);
    return value;
  });

  app.get("/api/export", async (_request, reply) => {
    const archive = await portability.exportArchive();
    reply.type("application/zip");
    reply.header("Content-Disposition", `attachment; filename=Knowt-${new Date().toISOString().slice(0, 10)}.zip`);
    return reply.send(archive);
  });
  app.post("/api/import", async (request) => {
    const file = await request.file();
    if (!file) throw notFound("No Knowt archive was supplied");
    const result = await portability.importArchive(await file.toBuffer());
    nodeRepository.rebuildSearchIndex();
    if (options.watchInbox !== false) await inboxWatcher.start(settingsRepository.get().inboxPath);
    return result;
  });

  const webDirectory = fileURLToPath(new URL("../../web/dist", import.meta.url));
  if (existsSync(webDirectory)) {
    await app.register(fastifyStatic, { root: webDirectory, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.status(404).send({ error: "not_found", message: "API route not found" });
      return reply.sendFile("index.html");
    });
  }

  if (options.watchInbox !== false) await inboxWatcher.start(settingsRepository.get().inboxPath);
  proposalRepository.expireRejected(settingsRepository.get().rejectedRetentionDays);
  app.addHook("onClose", async () => {
    await inboxWatcher.stop();
    context.close();
  });
  return app;
}
