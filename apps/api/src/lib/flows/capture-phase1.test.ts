import { describe, expect, it } from 'vitest';
import { validateFlow, type FlowNode } from './validate.js';
import { renderNodeContent } from './walk.js';

function cap(data: Record<string, unknown>): FlowNode {
  return { client_node_id: 'cap', kind: 'capture', title: 'Capture', position_x: 0, position_y: 0, data };
}

describe('capture node — Phase 1 (schema + walk read path)', () => {
  it('validates a well-formed capture node', () => {
    const r = validateFlow([cap({ title_hint: 'Findings', instruction: 'Research X', autonomous: false })], []);
    expect(r.valid).toBe(true);
  });

  it('rejects a capture node missing instruction', () => {
    const r = validateFlow([cap({ title_hint: 'Findings' })], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("'instruction'"))).toBe(true);
  });

  it('rejects a capture node missing title_hint', () => {
    const r = validateFlow([cap({ instruction: 'Research X' })], []);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes("'title_hint'"))).toBe(true);
  });

  it('rejects a non-boolean autonomous', () => {
    const r = validateFlow([cap({ title_hint: 'F', instruction: 'X', autonomous: 'yes' })], []);
    expect(r.valid).toBe(false);
  });

  it('renderNodeContent returns the submit_flow_capture directive', async () => {
    const rendered = await renderNodeContent(
      cap({ title_hint: 'Findings', instruction: 'Research X', autonomous: false }) as never,
      null,
    );
    expect(rendered.content_type).toBe('capture');
    expect(rendered.content).toContain('submit_flow_capture');
    expect(rendered.instruction).toContain('Research X');
  });

  it('autonomous:true surfaces in the walk directive', async () => {
    const rendered = await renderNodeContent(
      cap({ title_hint: 'F', instruction: 'X', autonomous: true }) as never,
      null,
    );
    expect(rendered.content).toContain('AUTONOMOUS');
  });
});
