import { Handle, Position, type NodeProps } from '@xyflow/react';
import { NodeShell, TypeBadge } from './NodeShell';
import { FLOW_TOKENS as T, handleStyle } from '../tokens';

interface CaptureData extends Record<string, unknown> {
  title: string;
  kind: 'capture';
  title_hint?: string;
  instruction?: string;
  target_folder_id?: string;
  autonomous?: boolean;
  isEntry?: boolean;
  hasOutgoingEdge?: boolean;
}

export function CaptureNode({ data, selected, isConnectable }: NodeProps) {
  const d = data as CaptureData;
  const preview = d.instruction
    ? (d.instruction.length > 80 ? d.instruction.slice(0, 78) + '…' : d.instruction)
    : null;

  return (
    <NodeShell kind="capture" selected={!!selected} isEntry={d.isEntry} isExit={!d.hasOutgoingEdge}>
      <TypeBadge label="Capture" icon="✎" colour={T.capture.accent} />

      {d.title_hint && (
        <p style={{ fontSize: 12, color: T.capture.label, lineHeight: 1.4, margin: '0 0 4px' }}>
          → {d.title_hint}
        </p>
      )}

      {preview
        ? <p style={{ fontSize: 13, color: '#fafafa', lineHeight: 1.5, margin: 0 }}>{preview}</p>
        : <p style={{ fontSize: 13, color: '#52525b', lineHeight: 1.5, margin: 0, fontStyle: 'italic' }}>No capture instruction written</p>
      }

      {d.autonomous && (
        <div style={{
          marginTop: 8, display: 'flex', alignItems: 'center', gap: 5,
          fontFamily: T.fontMono, fontSize: 9.5, color: '#f87171',
          background: 'rgba(248,113,113,0.08)', border: '0.5px solid rgba(248,113,113,0.25)',
          borderRadius: 4, padding: '3px 7px',
        }}>
          ⚠ Autonomous — writes without approval
        </div>
      )}

      <Handle type="target" position={Position.Top}    isConnectable={isConnectable} style={handleStyle()} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} style={handleStyle()} />
    </NodeShell>
  );
}
