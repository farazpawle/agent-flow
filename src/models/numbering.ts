/**
 * Display numbering (feature-hierarchy Workstream B4).
 *
 * Single source of truth for the per-feature hierarchical numbers shown in the
 * GUI and returned by the MCP views. Numbers are **derived on read** from each
 * group's `executionOrder` — never persisted — so they re-derive cleanly after
 * a reorder and can never drift out of sync.
 *
 * Rules:
 *   - A **Feature** is a group with no `parentGroupId`. It is shown by NAME, not
 *     numbered.
 *   - A **section group** is numbered `1..G` within its feature, ordered by
 *     `executionOrder` (ties broken by `createdAt`, then `id`). Its
 *     `displayNumber` is `"<g>"`.
 *   - A task is numbered `1..T` within its section group, ordered the same way.
 *     Its `displayNumber` is `"<g>.<t>"`.
 *   - Numbering restarts per feature, so feature A and feature B both start at
 *     `1` / `1.1` — the feature name disambiguates them.
 *
 * Manual (non-ingest) groups created via `project_edit(create_group)` have no
 * parent and no children. They are treated as standalone top-level sections
 * (scope `__root__`) so their tasks still get `"<g>.<t>"` numbers.
 */

export interface NumberingGroup {
  id: string;
  parentGroupId?: string;
  executionOrder?: number;
  createdAt?: Date | string | number;
}

export interface NumberingTask {
  id: string;
  groupId?: string;
  executionOrder?: number;
  createdAt?: Date | string | number;
}

export interface DisplayNumbers {
  /** groupId → section ordinal as a string, e.g. `"2"`. Features are absent. */
  groupNumbers: Map<string, string>;
  /** taskId → `"<group>.<task>"`, e.g. `"2.1"`. Ungrouped tasks are absent. */
  taskNumbers: Map<string, string>;
}

const ROOT_SCOPE = "__root__";

function toMillis(value: Date | string | number | undefined): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Deterministic order: executionOrder, then createdAt, then id. */
function compareOrdinal(
  a: { executionOrder?: number; createdAt?: Date | string | number; id: string },
  b: { executionOrder?: number; createdAt?: Date | string | number; id: string }
): number {
  const ao = a.executionOrder ?? 0;
  const bo = b.executionOrder ?? 0;
  if (ao !== bo) return ao - bo;
  const ac = toMillis(a.createdAt);
  const bc = toMillis(b.createdAt);
  if (ac !== bc) return ac - bc;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Compute display numbers for an entire project (any number of features).
 *
 * @param groups every group in the project (features + sections)
 * @param tasks  every task in the project
 */
export function computeDisplayNumbers(
  groups: NumberingGroup[],
  tasks: NumberingTask[]
): DisplayNumbers {
  const groupNumbers = new Map<string, string>();
  const taskNumbers = new Map<string, string>();

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const hasChildren = new Set<string>();
  for (const g of groups) {
    if (g.parentGroupId && groupById.has(g.parentGroupId)) hasChildren.add(g.parentGroupId);
  }

  // A "section" is what we number: a child group, or a childless top-level
  // group (manual). A top-level group WITH children is a feature (container).
  const sectionsByScope = new Map<string, NumberingGroup[]>();
  for (const g of groups) {
    const isFeatureContainer = !g.parentGroupId && hasChildren.has(g.id);
    if (isFeatureContainer) continue;
    const scope = g.parentGroupId && groupById.has(g.parentGroupId) ? g.parentGroupId : ROOT_SCOPE;
    const bucket = sectionsByScope.get(scope);
    if (bucket) bucket.push(g);
    else sectionsByScope.set(scope, [g]);
  }

  // Assign each section its ordinal within its scope.
  for (const sections of sectionsByScope.values()) {
    sections.sort(compareOrdinal);
    sections.forEach((section, i) => groupNumbers.set(section.id, String(i + 1)));
  }

  // Number tasks within their section group.
  const tasksByGroup = new Map<string, NumberingTask[]>();
  for (const t of tasks) {
    if (!t.groupId) continue;
    const bucket = tasksByGroup.get(t.groupId);
    if (bucket) bucket.push(t);
    else tasksByGroup.set(t.groupId, [t]);
  }
  for (const [groupId, groupTasks] of tasksByGroup) {
    const groupNumber = groupNumbers.get(groupId);
    if (groupNumber === undefined) continue; // task sits directly in a feature → unnumbered
    groupTasks.sort(compareOrdinal);
    groupTasks.forEach((t, i) => taskNumbers.set(t.id, `${groupNumber}.${i + 1}`));
  }

  return { groupNumbers, taskNumbers };
}
