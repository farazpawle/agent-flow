/**
 * Project Skill compiler (Wave 3 §10.E).
 *
 * Orchestrates the end-to-end compile flow:
 *   1. Gather source items — `tasks.lessonsLearned` (COMPLETED tasks) +
 *      `task_findings` of kind `finding` & type ∈ {success, lessons,
 *      decision}.
 *   2. Lexical pre-clustering (no LLM) — keep only clusters with ≥2
 *      supporting items. Single-item clusters are dropped (plan §10.E:
 *      "every cluster ≥2 items").
 *   3. Token-cap the inputs (3000 in / 3000 out). Oldest items get
 *      dropped first if the cluster pile is too big.
 *   4. LLM call (`compile_skill` workflow). Provider=`none` → throw a
 *      typed error so the GUI shows the "no provider" state.
 *   5. Split oversized topics — if a topic's rendered block exceeds
 *      ~150 lines, the body is written to `project_skill_references`
 *      and the markdown body gets a one-line pointer.
 *   6. Upsert into `project_skills` + `replaceSkillReferences`.
 *
 * The function NEVER mutates anything outside `project_skills` /
 * `project_skill_references`. Source rows are read-only inputs.
 */

import { childLogger } from "../utils/logger.js";
import { db } from "../models/db.js";
import { upsertSkill, replaceSkillReferences } from "../models/skillModel.js";
import { runAgentWorkflow, WORKFLOW_MODULES } from "./workflows/index.js";
import { resolveLlmConfig } from "./factory.js";
import { ExternalServiceError, NotFoundError } from "../utils/errors.js";
import { estimateTokens } from "../utils/tokenBudget.js";
import type { ProjectSkill, ProjectSkillReferenceInput } from "../models/interfaces.js";
import { TaskStatus } from "../types/index.js";

const log = childLogger({ component: "skill_compiler" });

const MAX_INPUT_TOKENS = 3_000;
const OVERFLOW_LINE_THRESHOLD = 150;

// Findings that count as compile inputs (plan §10.E "kind ∈
// lessons|decision|success"). Mirrored against the artifact_record
// type enum.
const ELIGIBLE_FINDING_TYPES = new Set(["lessons", "decision", "success"]);

// ────────────────────────────────────────────────────────────────────────
// Source gathering
// ────────────────────────────────────────────────────────────────────────

export interface SkillSourceItem {
  source: "task_lessons" | "finding";
  /** Stable id — taskId for task-lessons, findingId for findings. */
  id: string;
  taskId: string;
  /** Sub-classification: 'lessons' | 'decision' | 'success' | 'notes'. */
  kind: string;
  content: string;
  createdAt: Date;
}

async function gatherSourceItems(projectId: string): Promise<SkillSourceItem[]> {
  const items: SkillSourceItem[] = [];

  const tasks = await db.getAllTasks(projectId);
  for (const task of tasks) {
    if (task.status !== TaskStatus.COMPLETED) continue;
    if (!task.lessonsLearned) continue;
    items.push({
      source: "task_lessons",
      id: task.id,
      taskId: task.id,
      kind: "lessons",
      content: task.lessonsLearned.trim(),
      createdAt: task.updatedAt instanceof Date ? task.updatedAt : new Date(task.updatedAt),
    });
  }

  const findings = await db.listFindings({ projectId, kind: "finding", limit: 500 });
  for (const f of findings) {
    const type = String(f.type ?? "");
    if (!ELIGIBLE_FINDING_TYPES.has(type)) continue;
    const content = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
    items.push({
      source: "finding",
      id: f.id,
      taskId: f.taskId,
      kind: type,
      content: content.trim(),
      createdAt: f.createdAt,
    });
  }

  // Sort newest first so the token-cap trim below drops oldest items.
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items;
}

// ────────────────────────────────────────────────────────────────────────
// Pre-clustering (lexical, no LLM)
// ────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "by",
  "from",
  "is",
  "was",
  "be",
  "are",
  "as",
  "that",
  "this",
  "it",
  "we",
  "you",
  "i",
  "he",
  "she",
  "they",
  "at",
  "if",
  "then",
  "so",
  "not",
  "no",
  "yes",
  "do",
  "did",
  "done",
  "have",
  "has",
  "had",
  "can",
  "will",
  "would",
  "should",
  "could",
  "after",
  "before",
  "when",
  "while",
  "now",
  "task",
  "tasks",
]);

function topKeywords(content: string, limit = 6): string[] {
  const counts = new Map<string, number>();
  for (const raw of content.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    if (STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([w]) => w);
}

interface Cluster {
  topicKey: string;
  keywords: string[];
  items: SkillSourceItem[];
}

/**
 * Greedy O(n²) keyword overlap. The total source size is bounded by the
 * token cap so n stays well under a few hundred; the simplicity is
 * worth more than the asymptotic win.
 */
export function clusterItems(items: SkillSourceItem[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const item of items) {
    const itemWords = new Set(topKeywords(item.content));
    if (itemWords.size === 0) continue;
    let best: Cluster | null = null;
    let bestOverlap = 0;
    for (const cluster of clusters) {
      const overlap = cluster.keywords.filter((k) => itemWords.has(k)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = cluster;
      }
    }
    if (best && bestOverlap >= 2) {
      best.items.push(item);
      // Merge keyword set so later items get a richer match surface.
      best.keywords = Array.from(new Set([...best.keywords, ...itemWords])).slice(0, 12);
    } else {
      clusters.push({
        topicKey: [...itemWords].slice(0, 3).join("-") || `cluster-${clusters.length}`,
        keywords: [...itemWords].slice(0, 8),
        items: [item],
      });
    }
  }
  return clusters.filter((c) => c.items.length >= 2);
}

// ────────────────────────────────────────────────────────────────────────
// Input rendering + token cap
// ────────────────────────────────────────────────────────────────────────

function renderCluster(cluster: Cluster): string {
  const ids = cluster.items.map((i) => i.id).join(", ");
  const lines = [
    `## Cluster: ${cluster.topicKey}`,
    `Keywords: ${cluster.keywords.join(", ")}`,
    `sourceFindingIds: ${ids}`,
    "",
    ...cluster.items.map((i) => {
      const body = i.content.length > 600 ? `${i.content.slice(0, 600)}…` : i.content;
      return `- [${i.source}/${i.kind}] (${i.id}) ${body.replace(/\n+/g, " ")}`;
    }),
  ];
  return lines.join("\n");
}

export function trimToBudget(
  clusters: Cluster[],
  maxTokens: number = MAX_INPUT_TOKENS
): { rendered: string; dropped: number; survivors: Cluster[] } {
  // Drop clusters whose oldest item is the oldest overall until we fit.
  // Cheaper than ranking each cluster.
  const remaining = clusters.slice();
  let dropped = 0;
  let rendered = remaining.map(renderCluster).join("\n\n");
  while (estimateTokens(rendered) > maxTokens && remaining.length > 1) {
    // Find cluster with the oldest median item.
    let weakestIdx = 0;
    let weakestAge = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const age = Math.max(...remaining[i].items.map((it) => Date.now() - it.createdAt.getTime()));
      if (age > weakestAge) {
        weakestAge = age;
        weakestIdx = i;
      }
    }
    remaining.splice(weakestIdx, 1);
    dropped += 1;
    rendered = remaining.map(renderCluster).join("\n\n");
  }
  return { rendered, dropped, survivors: remaining };
}

// ────────────────────────────────────────────────────────────────────────
// Body / reference split
// ────────────────────────────────────────────────────────────────────────

interface RenderedTopic {
  topic: string;
  body: string;
  lines: number;
  sourceFindingIds: string[];
}

function renderTopicMarkdown(topic: {
  topic: string;
  rules: string[];
  sourceFindingIds?: string[];
}): RenderedTopic {
  const lines = [`### ${topic.topic}`, ""];
  for (const rule of topic.rules) lines.push(`- ${rule}`);
  if (topic.sourceFindingIds && topic.sourceFindingIds.length > 0) {
    lines.push("", `_Sources: ${topic.sourceFindingIds.join(", ")}_`);
  }
  const body = lines.join("\n");
  return {
    topic: topic.topic,
    body,
    lines: body.split("\n").length,
    sourceFindingIds: topic.sourceFindingIds ?? [],
  };
}

// ────────────────────────────────────────────────────────────────────────
// LLM-availability guard
// ────────────────────────────────────────────────────────────────────────

async function assertLlmConfigured(): Promise<void> {
  const config = await resolveLlmConfig({ db });
  if (config.provider === "none") {
    throw new ExternalServiceError(
      "compile_skill requires an LLM provider; LLM_PROVIDER is set to 'none'.",
      {
        details: { code: "LLM_NOT_CONFIGURED", provider: "none" },
        hint: "Set LLM_PROVIDER (openai | anthropic | openrouter | deepseek) and the matching API key, then retry.",
      }
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public entry point
// ────────────────────────────────────────────────────────────────────────

export interface CompileSkillOptions {
  projectId: string;
  /** Optional override for the input token cap (tests). */
  maxInputTokens?: number;
  correlationId?: string;
}

export interface CompileSkillResult {
  skill: ProjectSkill;
  topicsWritten: number;
  referencesWritten: number;
  inputItems: number;
  clustersIn: number;
  clustersUsed: number;
  droppedClusters: number;
}

export async function compileSkill(opts: CompileSkillOptions): Promise<CompileSkillResult> {
  const project = await db.getProject(opts.projectId);
  if (!project) {
    throw new NotFoundError(`Project not found: ${opts.projectId}`);
  }

  await assertLlmConfigured();

  // 1. Gather + 2. cluster.
  const items = await gatherSourceItems(opts.projectId);
  const clusters = clusterItems(items);
  if (clusters.length === 0) {
    throw new ExternalServiceError(
      `Not enough source material to compile a Skill for project ${project.name}.`,
      {
        details: { code: "SKILL_INSUFFICIENT_SOURCES", projectId: opts.projectId },
        hint: "Each topic needs ≥2 supporting lessons/decisions/findings. Complete more tasks first.",
      }
    );
  }

  // 3. Token cap.
  const budget = opts.maxInputTokens ?? MAX_INPUT_TOKENS;
  const { rendered: clusterText, survivors, dropped } = trimToBudget(clusters, budget);

  // 4. LLM compile.
  const agentResult = await runAgentWorkflow({
    workflow: WORKFLOW_MODULES.compile_skill,
    inputs: {
      projectName: project.name,
      clusters: clusterText,
    },
    projectId: opts.projectId,
    correlationId: opts.correlationId,
  });

  const obj = agentResult.object as {
    frontmatter: Record<string, unknown>;
    topics: Array<{ topic: string; rules: string[]; sourceFindingIds?: string[] }>;
  };

  // 5. Body / reference split.
  const rendered = obj.topics.map(renderTopicMarkdown);
  const bodyParts: string[] = [];
  const overflowRefs: ProjectSkillReferenceInput[] = [];

  const headerLines = [
    `# ${(obj.frontmatter.name as string) ?? `${project.name} Skill`}`,
    "",
    obj.frontmatter.description
      ? String(obj.frontmatter.description)
      : `Forward-looking lessons for project ${project.name}.`,
    "",
    `_Compiled: ${(obj.frontmatter.compiledAt as string) ?? new Date().toISOString().slice(0, 10)}_`,
    "",
  ];

  for (const t of rendered) {
    if (t.lines > OVERFLOW_LINE_THRESHOLD) {
      overflowRefs.push({
        skillId: "PENDING_SKILL_ID", // Filled in below once we have the skill row.
        topic: t.topic,
        content: t.body,
        sourceFindingIds: t.sourceFindingIds,
      });
      bodyParts.push(`### ${t.topic}`);
      bodyParts.push("");
      bodyParts.push(`_See reference: \`${t.topic}\` (lines: ${t.lines})_`);
      bodyParts.push("");
    } else {
      bodyParts.push(t.body);
      bodyParts.push("");
    }
  }

  const body = [...headerLines, ...bodyParts].join("\n").trimEnd() + "\n";
  const tokenCount = estimateTokens(body);

  // 6. Upsert + replace references.
  const skill = await upsertSkill({
    projectId: opts.projectId,
    frontmatter: {
      name: (obj.frontmatter.name as string) ?? `${project.name} Skill`,
      description: obj.frontmatter.description ?? null,
      compiledAt: (obj.frontmatter.compiledAt as string) ?? new Date().toISOString(),
    },
    body,
    compiledAt: new Date(),
    tokenCount,
  });

  if (overflowRefs.length > 0) {
    for (const r of overflowRefs) r.skillId = skill.id;
  }
  const refsWritten = await replaceSkillReferences(skill.id, overflowRefs);

  log.info(
    {
      projectId: opts.projectId,
      skillId: skill.id,
      topicsWritten: rendered.length,
      referencesWritten: refsWritten.length,
      droppedClusters: dropped,
      correlationId: opts.correlationId,
    },
    "compile_skill completed"
  );

  return {
    skill,
    topicsWritten: rendered.length,
    referencesWritten: refsWritten.length,
    inputItems: items.length,
    clustersIn: clusters.length,
    clustersUsed: survivors.length,
    droppedClusters: dropped,
  };
}

// Re-export for tests that want to drive the clustering directly.
export { gatherSourceItems };
export type { Cluster };
