/**
 * MCP tool: `start_flow_run` — open a run-history record for a flow execution.
 *
 * The walk is stateless, so a run is explicit: this snapshots the flow's ordered
 * steps into flow_run_steps and returns a run_id. Thread that run_id into your
 * submit_flow_capture calls so the run records which docs each step produced (and
 * auto-completes when all captures land). Call it ONCE when you begin walking/
 * executing a flow.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flowEdges, flowNodes, flowVersions, flows } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import { topologicalWalk } from '../../lib/flows/walk.js';
import { startFlowRun } from '../../lib/flows/runs.js';
import type { McpAuthContext } from '../auth.js';

export const START_FLOW_RUN_TOOL = {
  name: 'start_flow_run',
  description: [
    'Open a run-history record before you walk/execute a published flow.',
    'Call this ONCE with the flow slug at the start of a run. It returns a run_id.',
    'This is what powers the flow run-history execution view. To make the run legible',
    'end-to-end (every step, n8n-style — not only captures), thread the run_id through',
    'the whole walk:',
    '  • get_flow_step(run_id, step_index) — records each step visited + what it was served',
    '  • submit_flow_capture(run_id, …)    — records capture-step output (the doc)',
    '  • submit_flow_step_result(run_id, …) — records a NON-capture step\'s output',
    '    (the answer/branch/action) so instruction & decision steps show a result too',
    'The run auto-completes when all capture steps have landed.',
    '',
    'Returns { run_id, total_steps, flow_slug }, or { error: "flow_not_found" }.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_slug: { type: 'string', description: 'The flow slug (the id from list_flows).' },
    },
    required: ['flow_slug'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, readOnlyHint: false, title: 'Start a flow run' },
};

const argsSchema = z.object({ flow_slug: z.string().min(1).max(64) }).strict();

export interface StartFlowRunResult {
  run_id?: string;
  total_steps?: number;
  flow_slug?: string;
  error?: string;
  message?: string;
}

export async function startFlowRunTool(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<StartFlowRunResult> {
  const args = argsSchema.parse(rawArgs);

  const resolved = await withTenant(ctx.tenant_id, async (tx) => {
    const flowRows = await tx
      .select({ id: flows.id, slug: flows.slug, name: flows.name, versionId: flowVersions.id })
      .from(flows)
      .innerJoin(flowVersions, eq(flowVersions.id, flows.publishedVersionId))
      .where(and(eq(flows.slug, args.flow_slug), isNull(flows.deletedAt), eq(flowVersions.isPublished, true)))
      .limit(1);
    const flow = flowRows[0];
    if (!flow) return null;
    const dbNodes = await tx
      .select({
        client_node_id: flowNodes.clientNodeId,
        kind: flowNodes.kind,
        title: flowNodes.title,
        position_x: flowNodes.positionX,
        position_y: flowNodes.positionY,
        data: flowNodes.data,
      })
      .from(flowNodes)
      .where(eq(flowNodes.flowVersionId, flow.versionId));
    const dbEdges = await tx
      .select({
        from_node_id: flowEdges.fromNodeId,
        to_node_id: flowEdges.toNodeId,
        from_socket: flowEdges.fromSocket,
      })
      .from(flowEdges)
      .where(eq(flowEdges.flowVersionId, flow.versionId));
    const ordered = topologicalWalk(dbNodes, dbEdges);
    return { flow, ordered };
  });

  if (!resolved) {
    return { error: 'flow_not_found', message: `No published flow with slug '${args.flow_slug}' in this workspace.` };
  }

  const steps = resolved.ordered.map((n, i) => ({
    step_index: i + 1,
    node_id: n.client_node_id,
    kind: n.kind,
    title: n.title,
  }));
  const runId = await startFlowRun(ctx, {
    flowId: resolved.flow.id,
    flowVersionId: resolved.flow.versionId,
    flowSlug: resolved.flow.slug,
    flowName: resolved.flow.name,
    steps,
  });
  return { run_id: runId, total_steps: steps.length, flow_slug: resolved.flow.slug };
}
