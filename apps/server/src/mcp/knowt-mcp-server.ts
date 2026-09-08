import { inboxSubmissionInputSchema } from "@knowt/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IngestionService } from "../services/ingestion-service.js";

const serverInstructions = `Use get_topical_headers once at the start of each conversation before classifying knowledge. It returns headings only, not knowledge-base contents. Never call submit_knowledge_packets without the user's explicit approval. Submissions are staged in Knowt's Review Queue and are not canonical until approved there. Use a unique submission_id and unique client_node_id values; reuse a submission_id only to retry the identical submission.`;

export function createKnowtMcpServer(ingestion: IngestionService): McpServer {
  const server = new McpServer(
    { name: "knowt", version: "0.1.0" },
    { instructions: serverInstructions },
  );

  server.registerTool("get_topical_headers", {
    title: "Get Knowt topical headers",
    description: "Returns only the current topical category names and hierarchy. It does not expose knowledge nodes, content, IDs, counts, projects, or timestamps. Call once at the start of a conversation before proposing classifications.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const result = ingestion.topicalHeaders();
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: { schema_version: result.schema_version, topics: result.topics },
    };
  });

  server.registerTool("submit_knowledge_packets", {
    title: "Stage knowledge packets in Knowt",
    description: "Validates and stages one approved batch of structured knowledge packets in Knowt's Review Queue. This never writes directly to the canonical knowledge base. Call only after the user explicitly approves the proposed packets.",
    inputSchema: inboxSubmissionInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (input) => {
    const proposals = ingestion.stageSubmission(input);
    const result = {
      status: "staged_for_review",
      submission_id: input.submission_id,
      proposal_count: proposals.length,
      proposals: proposals.map((proposal) => ({
        proposal_id: proposal.id,
        client_node_id: proposal.clientNodeId,
        status: proposal.status,
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
    };
  });

  return server;
}
