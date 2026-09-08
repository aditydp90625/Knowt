import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import JSZip from "jszip";
import type { DatabaseContext } from "../db/database.js";
import { invalid } from "../domain/errors.js";
import type { AttachmentRepository } from "../repositories/attachment-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";

interface Manifest {
  format: "knowt-export";
  schemaVersion: 1;
  exportedAt: string;
  counts: { nodes: number; categories: number; attachments: number };
}

export class PortabilityService {
  constructor(
    private readonly context: DatabaseContext,
    private readonly attachmentRepository: AttachmentRepository,
    private readonly settingsRepository: SettingsRepository,
  ) {}

  async exportArchive(): Promise<Buffer> {
    if (this.context.path === ":memory:") throw invalid("Export is unavailable for an in-memory database");
    const temporaryDirectory = resolve(dirname(this.context.path), ".tmp");
    mkdirSync(temporaryDirectory, { recursive: true });
    const databaseCopy = join(temporaryDirectory, `export-${crypto.randomUUID()}.sqlite`);
    await backup(this.context.sqlite, databaseCopy);
    try {
      const zip = new JSZip();
      zip.file("knowledge.sqlite", readFileSync(databaseCopy));
      zip.file("configuration.json", JSON.stringify(this.settingsRepository.get(), null, 2));
      const attachmentRows = this.context.sqlite.prepare(
        "SELECT stored_name FROM attachments WHERE deleted_at IS NULL GROUP BY stored_name",
      ).all() as Array<{ stored_name: string }>;
      for (const row of attachmentRows) {
        const path = resolve(this.attachmentRepository.directory, row.stored_name);
        try { zip.file(`attachments/${row.stored_name.replace(/\\/g, "/")}`, readFileSync(path)); } catch { /* surfaced by missing file checks elsewhere */ }
      }
      const manifest: Manifest = {
        format: "knowt-export",
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        counts: {
          nodes: this.count("nodes"),
          categories: this.count("categories"),
          attachments: attachmentRows.length,
        },
      };
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      return await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    } finally {
      rmSync(databaseCopy, { force: true });
    }
  }

  async importArchive(content: Buffer): Promise<{ backupPath: string }> {
    if (this.context.path === ":memory:") throw invalid("Import is unavailable for an in-memory database");
    const zip = await JSZip.loadAsync(content, { checkCRC32: true });
    const manifestEntry = zip.file("manifest.json");
    const databaseEntry = zip.file("knowledge.sqlite");
    if (!manifestEntry || !databaseEntry) throw invalid("Archive must contain manifest.json and knowledge.sqlite");
    const manifest = JSON.parse(await manifestEntry.async("string")) as Partial<Manifest>;
    if (manifest.format !== "knowt-export" || manifest.schemaVersion !== 1) throw invalid("Unsupported Knowt archive version");

    const working = resolve(dirname(this.context.path), ".tmp", `import-${crypto.randomUUID()}`);
    const stagedAttachments = join(working, "attachments");
    const candidatePath = join(working, "knowledge.sqlite");
    mkdirSync(stagedAttachments, { recursive: true });
    writeFileSync(candidatePath, await databaseEntry.async("nodebuffer"));
    this.validateDatabase(candidatePath);

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.startsWith("attachments/")) continue;
      const relative = name.slice("attachments/".length);
      if (!relative || relative.includes("..") || relative.startsWith("/") || relative.startsWith("\\")) {
        throw invalid("Archive contains an unsafe attachment path");
      }
      const target = resolve(stagedAttachments, relative);
      if (!target.startsWith(`${resolve(stagedAttachments)}\\`)) throw invalid("Archive contains an unsafe attachment path");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, await entry.async("nodebuffer"));
    }

    const oldAttachmentDirectory = this.attachmentRepository.directory;
    const attachmentBackup = `${oldAttachmentDirectory}.backup-${Date.now()}`;
    let movedAttachments = false;
    try {
      try {
        renameSync(oldAttachmentDirectory, attachmentBackup);
        movedAttachments = true;
      } catch {
        mkdirSync(attachmentBackup, { recursive: true });
      }
      renameSync(stagedAttachments, oldAttachmentDirectory);
      const backupPath = this.context.replaceFrom(candidatePath);
      rmSync(working, { recursive: true, force: true });
      return { backupPath };
    } catch (error) {
      rmSync(oldAttachmentDirectory, { recursive: true, force: true });
      if (movedAttachments) renameSync(attachmentBackup, oldAttachmentDirectory);
      rmSync(working, { recursive: true, force: true });
      throw error;
    }
  }

  private validateDatabase(path: string): void {
    const candidate = new DatabaseSync(path, { readOnly: true });
    try {
      const integrity = (candidate.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
      if (integrity !== "ok") throw invalid("Imported database failed its integrity check");
      const version = (candidate.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (version !== 1) throw invalid("Imported database schema is not supported");
      const required = ["categories", "knowledge_types", "nodes", "revisions", "tags", "node_tags"];
      const rows = candidate.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
      const names = new Set(rows.map((row) => row.name));
      if (required.some((name) => !names.has(name))) throw invalid("Imported database is incomplete");
      const fallbacks = candidate.prepare("SELECT COUNT(*) AS count FROM categories WHERE protected = 1").get() as { count: number };
      if (fallbacks.count < 2) throw invalid("Imported database is missing protected fallback categories");
    } finally {
      candidate.close();
    }
  }

  private count(table: "nodes" | "categories"): number {
    return (this.context.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  }
}
