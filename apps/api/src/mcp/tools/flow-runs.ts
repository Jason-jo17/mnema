/**
 * MCP read tools for flow run history: list_flow_runs + get_flow_run.
 * Backs the run-history view — see what each flow run produced (per-step results
 * and the docs each capture step created).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { flows } from '../../db/schema.js';
import { withTenant } from '../../db/with-tenant.js';
import { getFlowRunDetail, listFlowRuns, listFlowRunOutputs } from '../../lib/flows/runs.js';
import type { McpAuthContext } from '../auth.js';

export const LIST_FLOW_RUNS_TOOL = {
  name: 'list_flow_runs',
  description: 'List recent run-history records for a flow (most recent first). Pass the flow slug.',
  inputSchema: {
    type: 'object' as const,
    properties: { flow_slug: { type: 'string', description: 'The flow slug (id from list_flows).' } },
    required: ['flow_slug'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'List flow runs' },
};

export const GET_FLOW_RUN_TOOL = {
  name: 'get_flow_run',
  description:
    'Get one flow run with its per-step results and the docs each capture step produced. Pass the run_id from list_flow_runs.',
  inputSchema: {
    type: 'object' as const,
    properties: { run_id: { type: 'string', description: 'The run id.' } },
    required: ['run_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'Get a flow run' },
};

export const LIST_FLOW_RUN_OUTPUTS_TOOL = {
  name: 'list_flow_run_outputs',
  description: [
    'List completed flow runs across the workspace, each paired with the EXACT docs its',
    'capture steps produced — so you can discover what past flow executions actually wrote',
    '(the findings, reports, specs, etc.) without walking each flow yourself.',
    '',
    'Returns runs newest-first. For each: run_id, flow_slug, flow_name, status, timestamps,',
    'and docs[] = { doc_id, title, exists, step_index, node_id, step_title }. `exists` is false',
    'if the doc was later deleted or you lack access. Call get_doc(doc_id) for full content.',
    '',
    'Args: flow_slug? (limit to one flow), status? (default "completed"; "all" for every run),',
    'limit? (default 20, max 100).',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      flow_slug: { type: 'string', description: 'Optional — limit to one flow (id from list_flows).' },
      status: {
        type: 'string',
        enum: ['completed', 'running', 'abandoned', 'all'],
        description: 'Run status filter. Default "completed" (successful runs).',
      },
      limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max runs to return (default 20).' },
    },
    required: [],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, title: 'List flow run outputs (docs produced)' },
};

const listArgs = z.object({ flow_slug: z.string().min(1).max(64) }).strict();
const getArgs = z.object({ run_id: z.string().uuid() }).strict();
const outputsArgs = z
  .object({
    flow_slug: z.string().min(1).max(64).optional(),
    status: z.enum(['completed', 'running', 'abandoned', 'all']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export async function listFlowRunsTool(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const args = listArgs.parse(rawArgs);
  const flowId = await withTenant(ctx.tenant_id, async (tx) => {
    const rows = await tx
      .select({ id: flows.id })
      .from(flows)
      .where(and(eq(flows.slug, args.flow_slug), isNull(flows.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  });
  if (!flowId) return { error: 'flow_not_found', runs: [] };
  const runs = await listFlowRuns(ctx, flowId);
  return { runs };
}

export async function getFlowRunTool(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const args = getArgs.parse(rawArgs);
  const detail = await getFlowRunDetail(ctx, args.run_id);
  if (!detail) return { error: 'run_not_found' };
  return detail;
}

export async function listFlowRunOutputsTool(ctx: McpAuthContext, rawArgs: Record<string, unknown>) {
  const args = outputsArgs.parse(rawArgs);
  // Resolve an optional slug → flow id (a missing slug just means "all flows").
  let flowId: string | null = null;
  if (args.flow_slug) {
    flowId = await withTenant(ctx.tenant_id, async (tx) => {
      const rows = await tx
        .select({ id: flows.id })
        .from(flows)
        .where(and(eq(flows.slug, args.flow_slug!), isNull(flows.deletedAt)))
        .limit(1);
      return rows[0]?.id ?? null;
    });
    if (!flowId) return { error: 'flow_not_found', runs: [] };
  }
  const runs = await listFlowRunOutputs(ctx, { flowId, status: args.status, limit: args.limit });
  return { runs };
}
