import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "./migrations.js";

function defaultDataDirectory(): string {
  if (process.env.LOCALAPPDATA) return `${process.env.LOCALAPPDATA}/Knowt/data`;
  if (process.env.XDG_DATA_HOME) return `${process.env.XDG_DATA_HOME}/Knowt`;
  return `${process.env.HOME ?? process.cwd()}/.local/share/Knowt`;
}

export const DEFAULT_DATABASE_PATH = `${defaultDataDirectory()}/knowt.sqlite`;

const LEGACY_DATABASE_PATH = fileURLToPath(new URL("../../../../data/knowt.sqlite", import.meta.url));

function databaseHasNodes(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const database = new DatabaseSync(path);
    const result = database.prepare("SELECT COUNT(*) AS count FROM nodes").get() as { count: number };
    database.close();
    return result.count > 0;
  } catch {
    return false;
  }
}

function migrateLegacyDataIfNeeded(path: string): void {
  if (path !== DEFAULT_DATABASE_PATH || !existsSync(LEGACY_DATABASE_PATH)) return;
  if (databaseHasNodes(path) || !databaseHasNodes(LEGACY_DATABASE_PATH)) return;

  mkdirSync(dirname(path), { recursive: true });
  const legacy = new DatabaseSync(LEGACY_DATABASE_PATH);
  legacy.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  legacy.close();
  copyFileSync(LEGACY_DATABASE_PATH, path);

  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }

  const legacyAttachments = resolve(dirname(LEGACY_DATABASE_PATH), "attachments");
  const targetAttachments = resolve(dirname(path), "attachments");
  if (existsSync(legacyAttachments)) cpSync(legacyAttachments, targetAttachments, { recursive: true, force: true });
}

export class DatabaseContext {
  sqlite!: DatabaseSync;
  orm!: NodeSQLiteDatabase;

  constructor(public readonly path = process.env.KNOWT_DB_PATH ?? DEFAULT_DATABASE_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    migrateLegacyDataIfNeeded(path);
    this.open();
  }

  close(): void {
    if (this.sqlite.isOpen) this.sqlite.close();
  }

  transaction<T>(operation: () => T): T {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  replaceFrom(sourcePath: string): string {
    if (this.path === ":memory:") throw new Error("Cannot replace an in-memory database");
    const backupPath = `${this.path}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    this.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.close();
    copyFileSync(this.path, backupPath);
    try {
      rmSync(`${this.path}-wal`, { force: true });
      rmSync(`${this.path}-shm`, { force: true });
      copyFileSync(sourcePath, this.path);
      this.open();
      return backupPath;
    } catch (error) {
      copyFileSync(backupPath, this.path);
      this.open();
      throw error;
    }
  }

  private open(): void {
    this.sqlite = new DatabaseSync(this.path, { timeout: 5_000, enableForeignKeyConstraints: true });
    this.sqlite.exec("PRAGMA journal_mode = WAL");
    this.sqlite.exec("PRAGMA synchronous = NORMAL");
    migrate(this.sqlite);
    this.orm = drizzle({ client: this.sqlite });
  }
}

export function createDatabase(databasePath?: string): DatabaseContext {
  return new DatabaseContext(databasePath);
}
