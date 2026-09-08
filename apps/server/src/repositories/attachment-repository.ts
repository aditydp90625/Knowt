import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Attachment } from "@knowt/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DatabaseContext } from "../db/database.js";
import { attachments } from "../db/schema.js";
import { invalid, notFound } from "../domain/errors.js";
import { NodeRepository } from "./node-repository.js";

export class AttachmentRepository {
  readonly directory: string;

  constructor(private readonly context: DatabaseContext, directory?: string) {
    this.directory = directory ?? resolve(dirname(context.path), "attachments");
    mkdirSync(this.directory, { recursive: true });
  }

  list(nodeId: string): Attachment[] {
    new NodeRepository(this.context).get(nodeId, true);
    return this.context.orm.select().from(attachments)
      .where(and(eq(attachments.nodeId, nodeId), isNull(attachments.deletedAt)))
      .orderBy(asc(attachments.originalName)).all().map((row) => this.hydrate(row));
  }

  add(nodeId: string, originalName: string, mediaType: string, content: Buffer): Attachment {
    new NodeRepository(this.context).get(nodeId);
    if (content.length === 0) throw invalid("The attachment is empty");
    if (content.length > 50 * 1024 * 1024) throw invalid("Attachments are limited to 50 MB");
    const sha256 = createHash("sha256").update(content).digest("hex");
    const storedName = join(sha256.slice(0, 2), sha256);
    const path = resolve(this.directory, storedName);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) writeFileSync(path, content, { flag: "wx" });
    const row = {
      id: crypto.randomUUID(), nodeId, originalName, storedName, mediaType: mediaType || "application/octet-stream",
      sizeBytes: content.length, sha256, createdAt: new Date().toISOString(), deletedAt: null,
    };
    this.context.orm.insert(attachments).values(row).run();
    return this.hydrate(row);
  }

  get(id: string): { attachment: Attachment; path: string } {
    const row = this.context.orm.select().from(attachments).where(eq(attachments.id, id)).get();
    if (!row || row.deletedAt) throw notFound("Attachment not found");
    return { attachment: this.hydrate(row), path: this.safePath(row.storedName) };
  }

  softDelete(id: string): void {
    this.get(id);
    this.context.orm.update(attachments).set({ deletedAt: new Date().toISOString() }).where(eq(attachments.id, id)).run();
  }

  removeUnreferencedFiles(storedNames: string[]): void {
    for (const storedName of storedNames) {
      const count = this.context.sqlite.prepare("SELECT COUNT(*) AS count FROM attachments WHERE stored_name = ?")
        .get(storedName) as { count: number };
      if (count.count === 0) rmSync(this.safePath(storedName), { force: true });
    }
  }

  private hydrate(row: typeof attachments.$inferSelect): Attachment {
    return {
      id: row.id,
      nodeId: row.nodeId,
      originalName: row.originalName,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      url: `/api/attachments/${row.id}/content`,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    };
  }

  private safePath(storedName: string): string {
    const target = resolve(this.directory, storedName);
    if (!target.startsWith(`${resolve(this.directory)}\\`) && target !== resolve(this.directory)) {
      throw invalid("Invalid attachment path");
    }
    return target;
  }
}
