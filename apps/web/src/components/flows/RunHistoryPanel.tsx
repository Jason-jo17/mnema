import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle, Loader, FileText, ArrowLeft, PlayCircle, AlertTriangle, Circle } from 'lucide-react';
import { MonoLabel } from '../ui/typography';
import { relativeTime } from '../../lib/relative-time';
import { openDocPreview } from '../../lib/preview';

interface RunRow {
  id: string;
  flowName: string;
  totalSteps: number;
  capturedCount: number;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}
export interface StepRow {
  id: string;
  stepIndex: number;
  nodeId: string;
  kind: string;
  title: string;
  status: string;
  capturedDocId: string | null;
  capturedTitle: string | null;
  input: FlowStepInput | null;
  output: FlowStepOutput | null;
  error: string | null;
  visitedAt: string | null;
}
interface FlowStepInput {
  instruction?: string;
  content?: string;
  content_type?: string;
  source?: Record<string, unknown> | null;
  branches?: { label: string; target_step_index: number }[];
}
interface FlowStepOutput {
  summary?: string;
  branch_taken?: string;
  doc_id?: string;
  doc_title?: string;
}

interface Props {
  flowId: string;
  onClose: () => void;
  /** Fires when a run is opened (steps) or closed (null) so the canvas can overlay it. */
  onRunActive?: (runId: string | null, steps: StepRow[]) => void;
  /** A canvas node was clicked while a run is active — expand + scroll to its step. */
  focusNodeId?: string | null;
  onFocusConsumed?: () => void;
}

const kindColor = (k: string): string =>
  k === 'capture' ? '#2dd4bf' : k === 'doc' || k === 'docs' ? '#60a5fa' : k === 'decision' ? '#a78bfa' : '#fbbf24';

/** status → dot color for the step-status pip. Exported so the canvas overlay matches. */
export const stepStatusColor = (s: string): string =>
  s === 'captured' ? '#2dd4bf' : s === 'visited' ? '#60a5fa' : s === 'error' ? '#f87171' : '#52525b';

export function RunHistoryPanel({ flowId, onClose, onRunActive, focusNodeId, onFocusConsumed }: Props) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RunRow | null>(null);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<'input' | 'output'>('output');
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setLoading(true);
    fetch(`/api/flows/${flowId}/runs`)
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [flowId]);

  const openRun = (run: RunRow) => {
    setSelected(run);
    setDetailLoading(true);
    setSteps([]);
    setExpanded(null);
    fetch(`/api/flow-runs/${run.id}`)
      .then((r) => r.json())
      .then((d) => {
        const s: StepRow[] = d.steps ?? [];
        setSteps(s);
        onRunActive?.(run.id, s);
      })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  };

  const backToList = () => {
    setSelected(null);
    setSteps([]);
    setExpanded(null);
    onRunActive?.(null, []);
  };

  // A canvas node was clicked while this run is open → expand + scroll to its step.
  useEffect(() => {
    if (!focusNodeId || !selected) return;
    const match = steps.find((s) => s.nodeId === focusNodeId);
    if (match) {
      setExpanded(match.id);
      rowRefs.current[match.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    onFocusConsumed?.();
  }, [focusNodeId, selected, steps, onFocusConsumed]);

  const toggle = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <aside className="w-[340px] h-full border-l border-[var(--border-subtle)] bg-[var(--surface-overlay)] flex flex-col">
      <div className="flex items-center justify-between px-5 h-14 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          {selected ? (
            <button onClick={backToList} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]" aria-label="Back to runs">
              <ArrowLeft size={14} strokeWidth={1.75} />
            </button>
          ) : (
            <PlayCircle size={14} strokeWidth={1.75} className="text-[var(--text-secondary)]" />
          )}
          <MonoLabel>{selected ? 'Execution' : 'Run history'}</MonoLabel>
        </div>
        <button onClick={onClose} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors" aria-label="Close runs">
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── Run list ── */}
        {!selected && (
          <>
            {loading && <div className="px-5 py-6 text-[12px] text-[var(--text-quaternary)]">Loading…</div>}
            {!loading && runs.length === 0 && (
              <div className="px-5 py-6 text-[12px] text-[var(--text-quaternary)] italic">
                No runs yet. Ask Claude to run this flow and each execution shows up here.
              </div>
            )}
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={() => openRun(run)}
                className="w-full text-left px-5 py-3 border-b border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  {run.status === 'completed' ? (
                    <span className="flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--status-success)]">
                      <CheckCircle size={9} strokeWidth={2} /> completed
                    </span>
                  ) : run.status === 'running' ? (
                    <span className="flex items-center gap-0.5 text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                      <Loader size={9} strokeWidth={2} /> running
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono uppercase tracking-[0.06em] text-[var(--text-quaternary)]">{run.status}</span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-tertiary)]">{relativeTime(new Date(run.startedAt))}</div>
                <div className="text-[11px] text-[var(--text-quaternary)] mt-0.5">
                  {run.capturedCount} / {run.totalSteps} captured
                </div>
              </button>
            ))}
          </>
        )}

        {/* ── Run detail (steps) ── */}
        {selected && (
          <>
            <div className="px-5 py-3 border-b border-[var(--border-subtle)]">
              <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{selected.flowName}</div>
              <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                {relativeTime(new Date(selected.startedAt))} · {selected.capturedCount}/{selected.totalSteps} captured · {selected.status}
              </div>
              <div className="text-[10px] text-[var(--text-quaternary)] mt-1">Click a step — or a node on the canvas — to inspect it.</div>
            </div>
            {detailLoading && <div className="px-5 py-6 text-[12px] text-[var(--text-quaternary)]">Loading steps…</div>}
            {!detailLoading && steps.map((s) => {
              const isOpen = expanded === s.id;
              return (
                <div
                  key={s.id}
                  ref={(el) => { rowRefs.current[s.id] = el; }}
                  className="border-b border-[var(--border-subtle)]"
                >
                  <button
                    onClick={() => toggle(s.id)}
                    className="w-full text-left px-5 py-2.5 flex items-center gap-2 hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    <span
                      className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-mono"
                      style={{
                        background: s.status === 'pending' ? 'var(--surface-hover)' : `${stepStatusColor(s.status)}22`,
                        color: s.status === 'pending' ? 'var(--text-quaternary)' : stepStatusColor(s.status),
                      }}
                    >
                      {s.stepIndex}
                    </span>
                    <span
                      className="shrink-0 text-[9px] font-mono uppercase tracking-[0.05em] px-1.5 py-0.5 rounded"
                      style={{ color: kindColor(s.kind), background: 'var(--surface-hover)' }}
                    >
                      {s.kind}
                    </span>
                    <span className="flex-1 min-w-0 text-[12px] text-[var(--text-secondary)] truncate">{s.title}</span>
                    {s.status === 'error' ? (
                      <AlertTriangle size={11} strokeWidth={2} style={{ color: '#f87171' }} />
                    ) : s.status === 'pending' ? (
                      <Circle size={9} strokeWidth={2} className="text-[var(--text-quaternary)]" />
                    ) : null}
                  </button>

                  {isOpen && (
                    <div className="px-5 pb-3 pt-0.5">
                      {/* tabs */}
                      <div className="flex gap-1 mb-2">
                        {(['output', 'input'] as const).map((t) => (
                          <button
                            key={t}
                            onClick={() => setTab(t)}
                            className="text-[10px] font-mono uppercase tracking-[0.05em] px-2 py-0.5 rounded"
                            style={{
                              color: tab === t ? '#fafafa' : 'var(--text-quaternary)',
                              background: tab === t ? 'var(--surface-hover)' : 'transparent',
                              border: `0.5px solid ${tab === t ? 'rgba(255,255,255,0.14)' : 'transparent'}`,
                            }}
                          >
                            {t}
                          </button>
                        ))}
                      </div>

                      {tab === 'output' ? <StepOutput step={s} /> : <StepInput step={s} />}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[11px] text-[var(--text-quaternary)] italic">{text}</div>;
}

function Pre({ text }: { text: string }) {
  return (
    <pre className="text-[11px] leading-[1.5] text-[var(--text-secondary)] whitespace-pre-wrap break-words max-h-64 overflow-y-auto m-0 font-mono">
      {text}
    </pre>
  );
}

function StepOutput({ step }: { step: StepRow }) {
  if (step.status === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-[0.05em]" style={{ color: '#f87171' }}>error</span>
        <Pre text={step.error ?? 'Step failed.'} />
      </div>
    );
  }
  if (step.capturedDocId) {
    const title = step.capturedTitle ?? step.output?.doc_title ?? 'captured doc';
    const docId = step.capturedDocId;
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); openDocPreview(docId); }}
        title="Preview the captured doc"
        className="inline-flex items-center gap-1.5 self-start max-w-full text-[12px] px-2.5 py-1.5 rounded transition-colors hover:brightness-125"
        style={{ color: '#2dd4bf', background: 'rgba(45,212,191,0.10)', border: '0.5px solid rgba(45,212,191,0.35)' }}
      >
        <FileText size={12} strokeWidth={1.75} className="shrink-0" />
        <span className="truncate">{title}</span>
      </button>
    );
  }
  const out = step.output;
  if (out?.branch_taken) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-mono uppercase tracking-[0.05em] text-[var(--text-quaternary)]">branch taken</span>
        <span className="text-[12px] text-[var(--text-secondary)]">{out.branch_taken}</span>
        {out.summary && <Pre text={out.summary} />}
      </div>
    );
  }
  if (out?.summary) return <Pre text={out.summary} />;
  if (step.status === 'pending') return <Empty text="Not reached in this run." />;
  return <Empty text="Visited — no result recorded for this step." />;
}

function StepInput({ step }: { step: StepRow }) {
  const inp = step.input;
  if (!inp) return <Empty text="No input recorded (run predates step-input capture)." />;
  return (
    <div className="flex flex-col gap-2">
      {inp.instruction && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.05em] text-[var(--text-quaternary)] mb-0.5">instruction</div>
          <Pre text={inp.instruction} />
        </div>
      )}
      {inp.branches && inp.branches.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.05em] text-[var(--text-quaternary)] mb-0.5">branches</div>
          <div className="flex flex-col gap-0.5">
            {inp.branches.map((b, i) => (
              <span key={i} className="text-[11px] text-[var(--text-secondary)]">→ {b.label}</span>
            ))}
          </div>
        </div>
      )}
      {inp.content && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.05em] text-[var(--text-quaternary)] mb-0.5">served content</div>
          <Pre text={inp.content} />
        </div>
      )}
    </div>
  );
}
