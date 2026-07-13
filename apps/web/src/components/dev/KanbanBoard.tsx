// DESIGN APPLIED: 2026-05-27

import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { T } from '../../lib/dev-tokens';

interface Project {
  id: string;
  name: string;
  slug: string;
  color: string;
}
import { AddTaskModal } from './AddTaskModal';
import { DevSetupBanner } from './DevSetupBanner';
import { KanbanColumn } from './KanbanColumn';
import { TaskDetailModal } from './TaskDetailModal';
import type { Task } from './TaskCard';

interface KanbanBoardProps {
  workspaceId: string;
}

interface DevConfig {
  mode: string;
  hookTokenSet: boolean;
  hookReceiverUrl: string;
  mcpConfigSnippet: string;
  installCommand: string;
}

// Map column id → transition endpoint segment (POST /api/tasks/:id/<segment>)
const STATUS_TRANSITION: Record<string, string | null> = {
  backlog:     'reopen',   // reopen is for done/audit_fix → backlog
  in_progress: 'start',
  review:      'review',
  audit_fix:   'block',
  done:        'complete',
};

// For tasks moving from in_progress to backlog (no standard transition — just reopen if needed)
// We track source status to determine the right endpoint
function resolveTransitionEndpoint(
  fromStatus: string,
  toStatus: string,
): string | null {
  if (fromStatus === toStatus) return null;
  if (toStatus === 'in_progress') return 'start';
  if (toStatus === 'review')      return 'review';
  if (toStatus === 'done')        return 'complete';
  if (toStatus === 'audit_fix')   return 'block';
  if (toStatus === 'backlog')     return 'reopen';
  return null;
}

const COLUMNS: { id: string; label: string; color: string }[] = [
  { id: 'backlog',     label: 'Backlog',     color: T.textMuted },
  { id: 'in_progress', label: 'In Progress', color: T.amber },
  { id: 'review',      label: 'Review',      color: T.violet },
  { id: 'audit_fix',   label: 'Audit / Fix', color: T.red },
  { id: 'done',        label: 'Done',        color: T.green },
];

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function KanbanBoard({ workspaceId }: KanbanBoardProps): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [devConfig, setDevConfig] = useState<DevConfig | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState<string>('all'); // slug or 'all'
  const [showProjectDropdown, setShowProjectDropdown] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // Ref to store the trigger element so we can return focus when the task modal closes.
  const taskTriggerRef = useRef<HTMLElement | null>(null);

  // Capture the currently focused element when the modal opens.
  useEffect(() => {
    if (selectedTask) {
      taskTriggerRef.current = document.activeElement as HTMLElement;
    }
  }, [selectedTask]);

  // Horizontal board scroll: the columns live in a horizontally-scrollable grid
  // while each column scrolls vertically on its own. A plain vertical mouse wheel
  // therefore can't reach the right-most columns (e.g. "Done"), and macOS overlay
  // scrollbars give no draggable affordance. Translate a vertical wheel into
  // horizontal board scroll — but only once the column under the pointer can no
  // longer scroll in that direction, so per-column vertical scrolling is intact.
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      const board = boardScrollRef.current;
      if (!board) return;
      if (board.scrollWidth <= board.clientWidth) return; // nothing to scroll sideways
      if (e.deltaX !== 0) return;                          // trackpad already scrolling horizontally
      // Walk up from the wheel target: if a column can still scroll vertically
      // in this direction, let it — don't hijack.
      let node = e.target as HTMLElement | null;
      while (node && node !== board) {
        const cs = getComputedStyle(node);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
          const atTop = node.scrollTop <= 0;
          const atBottom = Math.ceil(node.scrollTop + node.clientHeight) >= node.scrollHeight;
          if (e.deltaY < 0 ? !atTop : !atBottom) return;
        }
        node = node.parentElement;
      }
      board.scrollLeft += e.deltaY;
      e.preventDefault();
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); };
  }, [loading, error]);

  // Keyboard shortcut: press "n" to open the Add task modal. Ignored while the
  // user is typing in a field or when a modal already owns the keyboard, and it
  // leaves modifier combos (⌘/Ctrl/Alt) alone so browser + command-palette
  // (⌘/Ctrl+K) shortcuts keep working.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (showAddModal || selectedTask) return;
      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) return;
      e.preventDefault();
      setShowAddModal(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); };
  }, [showAddModal, selectedTask]);

  // Check if banner was previously dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem(`mnema_setup_banner_${workspaceId}`);
    if (dismissed === 'dismissed') setBannerDismissed(true);
  }, [workspaceId]);

  // Load projects for filter pill + read ?project= from URL
  useEffect(() => {
    void apiFetch<{ projects: Project[] }>('/api/projects?status=active')
      .then((d) => setProjects(d.projects))
      .catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const p = params.get('project');
    if (p) setProjectFilter(p);
  }, []);

  // Fetch ALL tasks — loop cursor pagination so no tasks are hidden
  const fetchTasks = useCallback(async () => {
    try {
      const all: Task[] = [];
      let cursor: string | null = null;
      do {
        const url = cursor
          ? `/api/tasks?limit=500&cursor=${encodeURIComponent(cursor)}`
          : '/api/tasks?limit=500';
        const data = await apiFetch<{ tasks: Task[]; next_cursor: string | null }>(url);
        all.push(...data.tasks);
        cursor = data.next_cursor ?? null;
      } while (cursor);
      setTasks(all);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch dev config (for setup banner)
  useEffect(() => {
    void apiFetch<DevConfig>(`/api/workspaces/${workspaceId}/dev-config`)
      .then(setDevConfig)
      .catch(() => { /* ignore */ });
  }, [workspaceId]);

  // Load tasks on mount
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // SSE: subscribe to task_updated + task_deleted events
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream', {
      withCredentials: true,
    });

    es.addEventListener('task_updated', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string) as { task: Task };
        setTasks((prev) => {
          const idx = prev.findIndex((t) => t.id === payload.task.id);
          if (idx === -1) return [...prev, payload.task];
          const next = [...prev];
          next[idx] = payload.task;
          return next;
        });
        // Also update selectedTask if this is the open modal's task
        setSelectedTask((prev) => prev?.id === payload.task.id ? payload.task : prev);
      } catch {
        /* malformed event */
      }
    });

    es.addEventListener('task_deleted', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data as string) as { taskId: string };
        setTasks((prev) => prev.filter((t) => t.id !== payload.taskId));
        setSelectedTask((prev) => (prev?.id === payload.taskId ? null : prev));
      } catch {
        /* malformed event */
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; just log silently
    };

    sseRef.current = es;
    return () => {
      es.close();
      sseRef.current = null;
    };
  }, [workspaceId]);

  // Active project for filter
  const activeProject = useMemo(
    () => projects.find((p) => p.slug === projectFilter) ?? null,
    [projects, projectFilter],
  );

  // Filtered tasks (by project if set)
  const filteredTasks = useMemo(
    () => projectFilter === 'all'
      ? tasks
      : tasks.filter((t) => t.projectId === activeProject?.id),
    [tasks, projectFilter, activeProject],
  );

  // Project id → project map for badge lookup
  const projectById = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p])),
    [projects],
  );

  // Group tasks by status, sorted by boardOrder
  const tasksByStatus = COLUMNS.reduce<Record<string, Task[]>>((acc, col) => {
    acc[col.id] = filteredTasks
      .filter((t) => t.status === col.id)
      .sort((a, b) => a.boardOrder - b.boardOrder);
    return acc;
  }, {});

  // Handle drop between / within columns
  const handleTaskDrop = useCallback(
    async (taskId: string, targetStatus: string, targetIndex: number) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const fromStatus = task.status;

      if (fromStatus === targetStatus) {
        // Reorder within the same column
        const colTasks = tasksByStatus[targetStatus] ?? [];
        const oldIdx = colTasks.findIndex((t) => t.id === taskId);
        if (oldIdx === targetIndex) return;

        // Optimistic update
        setTasks((prev) => {
          const withoutTask = prev.filter((t) => t.id !== taskId);
          const colWithout = withoutTask.filter((t) => t.status === targetStatus).sort((a, b) => a.boardOrder - b.boardOrder);
          colWithout.splice(targetIndex, 0, task);
          const reordered = colWithout.map((t, i) => ({ ...t, boardOrder: i }));
          return [
            ...withoutTask.filter((t) => t.status !== targetStatus),
            ...reordered,
          ];
        });

        try {
          const colTasks2 = [...(tasksByStatus[targetStatus] ?? [])].filter((t) => t.id !== taskId);
          colTasks2.splice(targetIndex, 0, task);
          await apiFetch('/api/tasks/reorder', {
            method: 'PATCH',
            body: JSON.stringify({
              taskIds: colTasks2.map((t) => t.id),
              status: targetStatus,
            }),
          });
        } catch {
          void fetchTasks(); // revert on error
        }
        return;
      }

      // Transition to different column
      const endpoint = resolveTransitionEndpoint(fromStatus, targetStatus);
      if (!endpoint) return;

      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: targetStatus } : t)),
      );

      try {
        // For 'block', we need a blockerDescription — use a default if none
        const body =
          endpoint === 'block'
            ? JSON.stringify({ blockerDescription: 'Needs attention' })
            : undefined;

        await apiFetch(`/api/tasks/${taskId}/${endpoint}`, {
          method: 'POST',
          body,
        });
      } catch {
        void fetchTasks(); // revert on error
      }
    },
    [tasks, tasksByStatus, fetchTasks],
  );

  // Add task to backlog (auto-assign project if filter active)
  const handleAddTask = useCallback(
    async (title: string, description?: string, priority?: string, projectId?: string | null) => {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title, description, priority: priority ?? 'medium',
          ...(projectId ? { projectId } : activeProject ? { projectId: activeProject.id } : {}),
        }),
      });
      await fetchTasks();
    },
    [fetchTasks, activeProject],
  );

  // Save task edits (PATCH) — board live-updates via SSE
  const handleSaveTask = useCallback(
    async (taskId: string, updates: Partial<Task>) => {
      await apiFetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      // SSE will update state; also optimistically update selectedTask immediately
      setSelectedTask((prev) => prev?.id === taskId ? { ...prev, ...updates } : prev);
    },
    [],
  );

  // Delete task (hard delete) — board live-updates via SSE
  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      await apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
      // SSE will remove from tasks; modal closes itself after onDelete resolves
    },
    [],
  );

  const showBanner =
    devConfig !== null &&
    !devConfig.hookTokenSet &&
    !bannerDismissed &&
    devConfig.installCommand !== undefined;

  if (loading) {
    return (
      <div style={{
        padding:    40,
        color:      T.textMuted,
        fontSize:   13,
        fontFamily: T.fontUI,
        background: T.bg,
        height:     '100%',
        boxSizing:  'border-box',
      }}>
        Loading tasks…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding:    40,
        background: T.bg,
        height:     '100%',
        boxSizing:  'border-box',
        fontFamily: T.fontUI,
      }}>
        <p style={{ color: T.red, fontSize: 13, marginBottom: 12 }}>{error}</p>
        <button
          onClick={() => { void fetchTasks(); }}
          style={{
            padding:      '7px 16px',
            borderRadius: 8,
            border:       `0.5px solid ${T.glassBorder}`,
            background:   T.glass,
            color:        T.textSecondary,
            fontSize:     12,
            cursor:       'pointer',
            fontFamily:   T.fontUI,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding:    '24px 28px',
      height:     '100%',
      boxSizing:  'border-box',
      display:    'flex',
      flexDirection: 'column',
      background: T.bg,
      fontFamily: T.fontUI,
    }}>
      {/* Header */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        marginBottom:   24,
      }}>
        <div>
          <h1 style={{
            margin:     0,
            fontSize:   20,
            fontWeight: 700,
            color:      T.textPrimary,
            fontFamily: T.fontUI,
            letterSpacing: '-0.02em',
          }}>
            Board
          </h1>
          <p style={{
            margin:   '3px 0 0',
            fontSize: 12,
            color:    T.textMuted,
          }}>
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </p>
        </div>
        {/* Project filter pill */}
        {projects.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowProjectDropdown((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8,
                border: `0.5px solid ${T.glassBorder}`, background: T.glass,
                color: T.textSecondary, fontSize: 12, cursor: 'pointer', fontFamily: T.fontUI,
              }}
            >
              {activeProject && <div style={{ width: 8, height: 8, borderRadius: '50%', background: activeProject.color }} />}
              {activeProject ? activeProject.name : 'All projects'}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 9 6 6 6-6"/></svg>
            </button>
            {showProjectDropdown && (
              <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50, background: T.surface2, border: `0.5px solid ${T.glassBorder}`, borderRadius: 10, minWidth: 180, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
                onMouseLeave={() => setShowProjectDropdown(false)}
              >
                <button onClick={() => { setProjectFilter('all'); setShowProjectDropdown(false); const u = new URL(window.location.href); u.searchParams.delete('project'); window.history.replaceState({}, '', u); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', background: projectFilter === 'all' ? T.surface3 : 'transparent', border: 'none', color: projectFilter === 'all' ? T.textPrimary : T.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: T.fontUI }}>
                  All projects
                </button>
                {projects.map((p) => (
                  <button key={p.id} onClick={() => { setProjectFilter(p.slug); setShowProjectDropdown(false); const u = new URL(window.location.href); u.searchParams.set('project', p.slug); window.history.replaceState({}, '', u); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '9px 14px', background: projectFilter === p.slug ? T.surface3 : 'transparent', border: 'none', color: projectFilter === p.slug ? T.textPrimary : T.textSecondary, fontSize: 13, cursor: 'pointer', fontFamily: T.fontUI }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    {p.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => { setShowAddModal(true); }}
          aria-keyshortcuts="n"
          title="Add task (press N)"
          style={{
            display:      'inline-flex',
            alignItems:   'center',
            gap:          7,
            padding:      '7px 16px',
            borderRadius: 8,
            border:       'none',
            background:   T.accent,
            color:        '#0A0B0D',
            fontSize:     13,
            fontWeight:   600,
            cursor:       'pointer',
            fontFamily:   T.fontUI,
            letterSpacing: '-0.01em',
          }}
        >
          + Add task
          <kbd style={{
            padding:      '1px 6px',
            borderRadius: 4,
            background:   'rgba(10,11,13,0.16)',
            border:       '0.5px solid rgba(10,11,13,0.24)',
            fontSize:     10.5,
            fontFamily:   T.fontMono,
            fontWeight:   600,
            lineHeight:   1.5,
          }}>N</kbd>
        </button>
      </div>

      {/* Dev Setup Banner — shown if hook token not yet set */}
      {showBanner && devConfig && (
        <DevSetupBanner
          workspaceId={workspaceId}
          hookToken={devConfig.installCommand}   // placeholder — banner only shows pre-token-set
          onDismiss={() => { setBannerDismissed(true); }}
        />
      )}

      {/* Columns — grid scroll container */}
      <style>{`
        .kanban-hscroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.18) transparent; }
        .kanban-hscroll::-webkit-scrollbar { height: 10px; }
        .kanban-hscroll::-webkit-scrollbar-track { background: transparent; }
        .kanban-hscroll::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.18);
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: content-box;
        }
        .kanban-hscroll:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.30); background-clip: content-box; }
      `}</style>
      {filteredTasks.length === 0 && (
        <div style={{
          flex:           1,
          minHeight:      0,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
        }}>
          <div style={{
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'center',
            textAlign:     'center',
            padding:       '48px 32px',
            maxWidth:      420,
            background:    T.surface1,
            border:        `0.5px solid ${T.glassBorder}`,
            borderRadius:  12,
          }}>
            <div style={{
              width:          48,
              height:         48,
              borderRadius:   10,
              background:     T.surface2,
              border:         `0.5px solid ${T.glassBorder}`,
              display:        'inline-flex',
              alignItems:     'center',
              justifyContent: 'center',
              color:          T.textSecondary,
              marginBottom:   18,
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3"  y="4" width="4" height="16" rx="1" />
                <rect x="10" y="4" width="4" height="10" rx="1" />
                <rect x="17" y="4" width="4" height="13" rx="1" />
              </svg>
            </div>
            <h3 style={{
              margin:        '0 0 8px',
              fontSize:      16,
              fontWeight:    600,
              color:         T.textPrimary,
              fontFamily:    T.fontUI,
              letterSpacing: '-0.01em',
            }}>
              No tasks yet
            </h3>
            <p style={{
              margin:     '0 0 18px',
              fontSize:   13,
              lineHeight: 1.55,
              color:      T.textSecondary,
              maxWidth:   300,
            }}>
              {activeProject
                ? `No tasks in ${activeProject.name} yet — add one to start tracking work on the board.`
                : 'Add your first task to start tracking work across the board.'}
            </p>
            <button
              onClick={() => { setShowAddModal(true); }}
              style={{
                padding:       '8px 16px',
                borderRadius:  8,
                border:        'none',
                background:    T.accent,
                color:         '#0A0B0D',
                fontSize:      13,
                fontWeight:    600,
                cursor:        'pointer',
                fontFamily:    T.fontUI,
                letterSpacing: '-0.01em',
              }}
            >
              + Add task
            </button>
          </div>
        </div>
      )}
      <div
        ref={boardScrollRef}
        className="kanban-hscroll"
        style={{
          display:          filteredTasks.length === 0 ? 'none' : 'grid',
          gridAutoFlow:     'column',
          gridAutoColumns:  '280px',
          gap:              16,
          flex:             1,
          minHeight:        0,
          overflowX:        'auto',
          overflowY:        'hidden',
          paddingBottom:    8,
          alignItems:       'stretch',
        }}
      >
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.id}
            id={col.id}
            label={col.label}
            color={col.color}
            tasks={tasksByStatus[col.id] ?? []}
            onTaskDrop={handleTaskDrop}
            onAddTask={col.id === 'backlog' ? () => { setShowAddModal(true); } : undefined}
            onTaskClick={setSelectedTask}
            projectById={projectById}
            showProjectBadges={projects.length > 1 && projectFilter === 'all'}
          />
        ))}
      </div>

      {/* Add Task Modal */}
      {showAddModal && (
        <AddTaskModal
          onAdd={handleAddTask}
          onClose={() => { setShowAddModal(false); }}
          projects={projects}
          defaultProjectId={activeProject?.id ?? null}
        />
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          onClose={() => {
            setSelectedTask(null);
            // Restore focus to the element that triggered the modal
            requestAnimationFrame(() => {
              taskTriggerRef.current?.focus();
              taskTriggerRef.current = null;
            });
          }}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
        />
      )}
    </div>
  );
}

// Keep STATUS_TRANSITION in scope to silence unused-var lint (it documents the mapping)
void STATUS_TRANSITION;
