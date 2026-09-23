import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "./migrations.js";

function defaultDataDirectory(): string {
  if (process.env.LOCALAPPDATA) return `${process.env.LOCALAPPDATA}/Knowt/data`;
  if (process.env.XDG_DATA_HOME) return `${process.env.XDG_DATA_HOME}/Knowt`;
  return `${process.env.HOME ?? process.cwd()}/.local/share/Knowt`;
}

export const DEFAULT_DATABASE_PATH = `${defaultDataDirectory()}/knowt.sqlite`;

export class DatabaseContext {
  sqlite!: DatabaseSync;
  orm!: NodeSQLiteDatabase;

  constructor(public readonly path = process.env.KNOWT_DB_PATH ?? DEFAULT_DATABASE_PATH) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
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
