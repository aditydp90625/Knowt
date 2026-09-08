import type { AppSettings } from "@knowt/contracts";
import { eq } from "drizzle-orm";
import type { DatabaseContext } from "../db/database.js";
import { settings } from "../db/schema.js";

export class SettingsRepository {
  constructor(private readonly context: DatabaseContext) {}

  get(): AppSettings {
    const row = this.context.orm.select().from(settings).where(eq(settings.key, "app")).get();
    if (!row) return { theme: "system", inboxPath: "data/inbox", rejectedRetentionDays: 30 };
    return JSON.parse(row.valueJson) as AppSettings;
  }

  update(value: AppSettings): AppSettings {
    this.context.orm.insert(settings).values({
      key: "app", valueJson: JSON.stringify(value), updatedAt: new Date().toISOString(),
    }).onConflictDoUpdate({ target: settings.key, set: { valueJson: JSON.stringify(value), updatedAt: new Date().toISOString() } }).run();
    return this.get();
  }
}
