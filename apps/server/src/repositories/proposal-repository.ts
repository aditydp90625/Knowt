import type { InboxSubmission, NodeWrite, Proposal } from "@knowt/contracts";
import { and, asc, eq } from "drizzle-orm";
import type { DatabaseContext } from "../db/database.js";
import { knowledgeTypes, proposals, submissions } from "../db/schema.js";
import { conflict, notFound } from "../domain/errors.js";
import { CategoryRepository } from "./category-repository.js";
import { NodeRepository } from "./node-repository.js";

export class ProposalRepository {
  private readonly categories: CategoryRepository;
  private readonly nodes: NodeRepository;

  constructor(private readonly context: DatabaseContext) {
    this.categories = new CategoryRepository(context);
    this.nodes = new NodeRepository(context);
  }

  submit(input: InboxSubmission): Proposal[] {
    const existing = this.context.orm.select().from(submissions)
      .where(eq(submissions.externalSubmissionId, input.submissionId)).get();
    if (existing) return this.listBySubmission(existing.id);

    const submissionId = crypto.randomUUID();
    const now = new Date().toISOString();
    this.context.transaction(() => {
      this.context.orm.insert(submissions).values({
        id: submissionId,
        schemaVersion: input.schemaVersion,
        externalSubmissionId: input.submissionId,
        sourceJson: JSON.stringify(input.source),
        receivedAt: now,
      }).run();
      for (const proposed of input.nodes) {
        const topic = this.resolvePath("topic", proposed.topic.pathHint);
        const project = this.resolvePath("project", proposed.project.pathHint);
        this.context.orm.insert(proposals).values({
          id: crypto.randomUUID(),
          submissionId,
          clientNodeId: proposed.clientNodeId,
          payloadJson: JSON.stringify(proposed),
          reconciledTopicId: topic,
          reconciledProjectId: project,
          status: "pending",
          createdAt: now,
        }).run();
      }
    });
    return this.listBySubmission(submissionId);
  }

  list(status?: "pending" | "approved" | "rejected"): Proposal[] {
    const rows = status
      ? this.context.orm.select().from(proposals).where(eq(proposals.status, status)).orderBy(asc(proposals.createdAt)).all()
      : this.context.orm.select().from(proposals).orderBy(asc(proposals.createdAt)).all();
    return rows.map((row) => this.hydrate(row));
  }

  approve(id: string, override?: Omit<NodeWrite, "expectedVersion">): Proposal {
    const proposal = this.getRow(id);
    if (proposal.status !== "pending") throw conflict("Only pending proposals can be approved");
    const hydrated = this.hydrate(proposal);
    const type = this.context.orm.select().from(knowledgeTypes)
      .where(eq(knowledgeTypes.name, hydrated.payload.knowledgeType)).get();
    if (!type) throw new Error(`Missing knowledge type ${hydrated.payload.knowledgeType}`);
    const value: NodeWrite = override ?? {
      title: hydrated.payload.title,
      contentMarkdown: hydrated.payload.contentMarkdown,
      knowledgeTypeId: type.id,
      topicCategoryId: hydrated.topicCategoryId ?? this.categories.getFallback("topic").id,
      projectCategoryId: hydrated.projectCategoryId ?? this.categories.getFallback("project").id,
      tags: hydrated.payload.tags,
      sourceType: "ChatGPT conversation",
      sourceDetails: hydrated.source.conversationTitle ?? `${hydrated.source.system} submission`,
    };
    const node = this.nodes.create(value, "Approved from Review Queue");
    const reviewedAt = new Date().toISOString();
    this.context.orm.update(proposals).set({ status: "approved", canonicalNodeId: node.id, reviewedAt })
      .where(eq(proposals.id, id)).run();
    return this.hydrate(this.getRow(id));
  }

  approveAll(submissionId: string, overrides: Record<string, Omit<NodeWrite, "expectedVersion">> = {}): Proposal[] {
    const pending = this.context.orm.select().from(proposals).where(and(
      eq(proposals.submissionId, submissionId), eq(proposals.status, "pending"),
    )).all();
    return pending.map((item) => this.approve(item.id, overrides[item.id]));
  }

  reject(id: string): Proposal {
    const proposal = this.getRow(id);
    if (proposal.status !== "pending") throw conflict("Only pending proposals can be rejected");
    this.context.orm.update(proposals).set({ status: "rejected", reviewedAt: new Date().toISOString() })
      .where(eq(proposals.id, id)).run();
    return this.hydrate(this.getRow(id));
  }

  expireRejected(retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    return Number(this.context.sqlite.prepare("DELETE FROM proposals WHERE status = 'rejected' AND reviewed_at < ?").run(cutoff).changes);
  }

  private listBySubmission(submissionId: string): Proposal[] {
    return this.context.orm.select().from(proposals).where(eq(proposals.submissionId, submissionId)).all()
      .map((row) => this.hydrate(row));
  }

  private getRow(id: string): typeof proposals.$inferSelect {
    const row = this.context.orm.select().from(proposals).where(eq(proposals.id, id)).get();
    if (!row) throw notFound("Proposal not found");
    return row;
  }

  private hydrate(row: typeof proposals.$inferSelect): Proposal {
    const submission = this.context.orm.select().from(submissions).where(eq(submissions.id, row.submissionId)).get();
    if (!submission) throw new Error(`Submission ${row.submissionId} is missing`);
    return {
      id: row.id,
      submissionId: row.submissionId,
      clientNodeId: row.clientNodeId,
      status: row.status,
      payload: JSON.parse(row.payloadJson),
      source: JSON.parse(submission.sourceJson),
      topicCategoryId: row.reconciledTopicId,
      projectCategoryId: row.reconciledProjectId,
      topicPath: row.reconciledTopicId ? this.categories.path(row.reconciledTopicId) : [],
      projectPath: row.reconciledProjectId ? this.categories.path(row.reconciledProjectId) : [],
      canonicalNodeId: row.canonicalNodeId,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    };
  }

  private resolvePath(workspace: "topic" | "project", hint: string[]): string {
    for (let length = hint.length; length > 0; length -= 1) {
      const found = this.categories.findPath(workspace, hint.slice(0, length));
      if (found) return found.id;
    }
    return this.categories.getFallback(workspace).id;
  }
}
