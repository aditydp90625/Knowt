import { inboxSubmissionSchema, type Proposal } from "@knowt/contracts";
import { CategoryRepository } from "../repositories/category-repository.js";
import { ProposalRepository } from "../repositories/proposal-repository.js";

export interface TopicHeader {
  name: string;
  children: TopicHeader[];
}

export interface TopicalHeaders {
  schema_version: "1.0";
  topics: TopicHeader[];
}

export class IngestionService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly proposals: ProposalRepository,
  ) {}

  topicalHeaders(): TopicalHeaders {
    const topicalCategories = this.categories.list("topic");
    const childrenByParent = new Map<string | null, typeof topicalCategories>();
    for (const category of topicalCategories) {
      const children = childrenByParent.get(category.parentId) ?? [];
      children.push(category);
      childrenByParent.set(category.parentId, children);
    }

    const buildHeaders = (parentId: string | null): TopicHeader[] =>
      (childrenByParent.get(parentId) ?? [])
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((category) => ({ name: category.name, children: buildHeaders(category.id) }));

    return { schema_version: "1.0", topics: buildHeaders(null) };
  }

  stageSubmission(input: unknown): Proposal[] {
    return this.proposals.submit(inboxSubmissionSchema.parse(input));
  }
}
