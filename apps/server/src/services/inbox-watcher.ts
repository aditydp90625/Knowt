import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { inboxSubmissionSchema } from "@knowt/contracts";
import chokidar, { type FSWatcher } from "chokidar";
import type { ProposalRepository } from "../repositories/proposal-repository.js";

export class InboxWatcher {
  private watcher: FSWatcher | undefined;

  constructor(private readonly proposals: ProposalRepository) {}

  async start(path: string): Promise<void> {
    await this.stop();
    const inboxPath = resolve(path);
    mkdirSync(inboxPath, { recursive: true });
    this.watcher = chokidar.watch(inboxPath, {
      depth: 0,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 1_000, pollInterval: 100 },
    });
    this.watcher.on("add", (filePath) => {
      if (extname(filePath).toLocaleLowerCase() === ".json") this.process(filePath);
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) await this.watcher.close();
    this.watcher = undefined;
  }

  private process(filePath: string): void {
    try {
      const parsed = inboxSubmissionSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
      this.proposals.submit(parsed);
      this.move(filePath, "processed");
    } catch (error) {
      const destination = this.move(filePath, "quarantine");
      const message = error instanceof Error ? error.message : String(error);
      writeFileSync(`${destination}.error.txt`, message, "utf8");
    }
  }

  private move(filePath: string, folder: string): string {
    const targetDirectory = join(dirname(filePath), folder);
    mkdirSync(targetDirectory, { recursive: true });
    const target = join(targetDirectory, `${Date.now()}-${basename(filePath)}`);
    renameSync(filePath, target);
    return target;
  }
}
