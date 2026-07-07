/**
 * MCP tool: `submit_flow_step_result` — the walk-protocol counterpart to
 * submit_flow_capture, for NON-capture steps.
 *
 * A capture step persists a doc (submit_flow_capture records that as its output).
 * Instruction / doc / decision steps don't produce a doc, so the model reports what
 * it did here — the answer it gave, the branch it took, a one-line action summary.
 * That becomes the step's `output` in the run-history execution view (the "Output"
 * tab), so a recorded run shows every step's result the way n8n does, not just captures.
 *
 * Optional in the walk: get_flow_step(run_id) already marks steps visited and stores
 * their input, so a run is legible without this. Call it to enrich the output side.
 */
import { z } from 'zod';
import type { FlowRunStepOutput } from '../../db/schema.js';
import { recordStepResult } from '../../lib/flows/runs.js';
import type { McpAuthContext } from '../auth.js';
import { requireScope } from '../scope.js';

export const SUBMIT_FLOW_STEP_RESULT_TOOL_NAME = 'submit_flow_step_result';

export const SUBMIT_FLOW_STEP_RESULT_TOOL_SPEC = {
  name: SUBMIT_FLOW_STEP_RESULT_TOOL_NAME,
  description: [
    'Record what you did at a NON-capture flow step, into the run-history execution view.',
    'Capture steps use submit_flow_capture; use THIS for instruction / doc / decision steps.',
    '',
    'Call it after executing a step during a run (one you started with start_flow_run), passing:',
    '  run_id       the run from start_flow_run',
    '  node_id      the step\'s node id (from the get_flow_step response)',
    '  summary      one or two lines on what you did — the answer you gave, the action taken',
    '  branch_taken (decision steps only) the branch label you followed',
    '  error        set only if the step could not be completed',
    '',
    'Optional: get_flow_step(run_id) already logs each step as visited with its input, so a run',
    'is legible without this — it fills in the Output side. Returns { ok } or { error }.',
  ].join('\n'),
  inputSchema: {
    type: 'object' as const,
    properties: {
      run_id: { type: 'string', description: 'The run id from start_flow_run.' },
      node_id: { type: 'string', description: 'The step\'s node id (from the get_flow_step response).' },
      summary: { type: 'string', description: 'One or two lines on what you did at this step.' },
      branch_taken: { type: 'string', description: 'For decision steps: the branch label you followed.' },
      error: { type: 'string', description: 'Set only if the step failed; marks the step errored.' },
    },
    required: ['run_id', 'node_id'],
    additionalProperties: false,
  },
  annotations: { destructiveHint: false, title: 'Record a flow step result' },
};

const argsSchema = z
  .object({
    run_id: z.string().uuid(),
    node_id: z.string().min(1).max(64),
    summary: z.string().max(4_000).optional(),
    branch_taken: z.string().max(200).optional(),
    error: z.string().max(4_000).optional(),
  })
  .strict();

export interface SubmitFlowStepResultResult {
  content: string;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

export async function submitFlowStepResult(
  ctx: McpAuthContext,
  rawArgs: Record<string, unknown>,
): Promise<SubmitFlowStepResultResult> {
  // Writes run telemetry, not a doc — same low bar as get_flow_step's inline recording.
  requireScope(ctx, 'docs:read');
  const args = argsSchema.parse(rawArgs);

  const output: FlowRunStepOutput = {};
  if (args.summary) output.summary = args.summary;
  if (args.branch_taken) output.branch_taken = args.branch_taken;

  const ok = await recordStepResult(ctx, {
    runId: args.run_id,
    nodeId: args.node_id,
    output,
    error: args.error ?? null,
  });

  if (!ok) {
    const message = `No step for node '${args.node_id}' in run '${args.run_id}'. Pass the run_id from start_flow_run and the node_id from get_flow_step.`;
    return { content: `Error: ${message}`, structuredContent: { error: 'step_not_found', message }, isError: true };
  }
  return {
    content: `Recorded result for step '${args.node_id}'${args.error ? ' (error)' : ''}.`,
    structuredContent: { ok: true, node_id: args.node_id, error: args.error ?? null },
  };
}
