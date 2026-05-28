/**
 * Abandonment narration helper (Wave 3 §10.F).
 *
 * Bridges the lifecycle handler / read-time recovery to the
 * `narrate_abandonment` workflow. Provider=`none` (or any provider
 * error / timeout) falls back to the Wave-2 templated tag so the audit
 * trail never blocks the state transition.
 *
 * Templated fallbacks (kept identical to Wave 2 wire shape):
 *   - explicit release:        `[released <iso> by <client>: <note?>]`
 *   - read-time expiry sweep:  `[abandoned <iso>, claim expired]`
 *
 * On success the helper returns the bare summary text. The caller is
 * responsible for the surrounding `[released …]` / `[abandoned …]`
 * envelope so the parser front-ends in §10.H still recognise the entry.
 */

import { childLogger } from "../utils/logger.js";
import { db } from "../models/db.js";
import { runAgentWorkflow, WORKFLOW_MODULES } from "./workflows/index.js";
import type { Task } from "../types/index.js";
import type { TaskFinding } from "../models/interfaces.js";

const log = childLogger({ component: "narration" });

const MAX_NOTES_TAIL = 500; // chars
const MAX_FINDINGS = 5;
const NARRATION_TIMEOUT_MS = 10_000;

export interface AbandonmentNarrationInput {
  task: Task;
  trigger: "released" | "expired" | "force-released";
  /** Who held the claim before the abandonment. */
  heldBy: string;
  /** Optional caller-supplied note (e.g. release reason). */
  releaseNote?: string;
}

/** True for both holder-initiated and admin-forced releases. */
function isReleaseTrigger(trigger: AbandonmentNarrationInput["trigger"]): boolean {
  return trigger === "released" || trigger === "force-released";
}

export interface AbandonmentNarrationResult {
  /** The body text the caller should embed inside their tag envelope. */
  summary: string;
  /** True when the LLM was used; false when the templated fallback ran. */
  fromLlm: boolean;
  /** Reason for the fallback (empty when fromLlm=true). */
  fallbackReason?: string;
}

function templatedSummary(input: AbandonmentNarrationInput, nowIso: string): string {
  if (isReleaseTrigger(input.trigger)) {
    const verb = input.trigger === "force-released" ? "force-released" : "released";
    return input.releaseNote
      ? `${verb} ${nowIso} by ${input.heldBy}: ${input.releaseNote}`
      : `${verb} ${nowIso} by ${input.heldBy}`;
  }
  return `abandoned ${nowIso}, claim expired`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error(`narration timeout: ${signal}`), { code: "TIMEOUT" })),
      ms
    );
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

async function loadContext(
  taskId: string
): Promise<{ findings: TaskFinding[]; notesTail: string }> {
  const findings = await db.listFindings({ taskId, limit: MAX_FINDINGS });
  const task = await db.getTask(taskId);
  const notes = task?.notes ?? "";
  const notesTail = notes.length > MAX_NOTES_TAIL ? notes.slice(-MAX_NOTES_TAIL) : notes;
  return { findings, notesTail };
}

function renderFindings(findings: TaskFinding[]): string {
  if (findings.length === 0) return "(no recent findings)";
  return findings
    .map((f) => {
      const body = typeof f.content === "string" ? f.content : JSON.stringify(f.content);
      const trimmed = body.length > 240 ? `${body.slice(0, 240)}…` : body;
      return `- [${String(f.kind)}${f.type ? `/${f.type}` : ""}] ${trimmed}`;
    })
    .join("\n");
}

/**
 * Try the LLM workflow, falling back to a templated string for any
 * provider failure. Never throws — callers append the returned summary
 * straight to the notes envelope.
 */
export async function narrateAbandonment(
  input: AbandonmentNarrationInput
): Promise<AbandonmentNarrationResult> {
  const nowIso = new Date().toISOString();
  const fallback = templatedSummary(input, nowIso);

  // Skip the LLM entirely when explicitly opted out (tests / CI) or
  // when running under vitest — narration is a nice-to-have and we
  // don't want unit tests burning API tokens or depending on network.
  // Tests that specifically exercise the narration path opt in via
  // `AGENTFLOW_ENABLE_LLM_NARRATION_IN_TESTS=true`.
  const inTest =
    process.env.VITEST === "true" ||
    process.env.NODE_ENV === "test" ||
    process.env.npm_lifecycle_event === "test";
  if (
    process.env.AGENTFLOW_DISABLE_LLM_NARRATION === "true" ||
    (inTest && process.env.AGENTFLOW_ENABLE_LLM_NARRATION_IN_TESTS !== "true")
  ) {
    return { summary: fallback, fromLlm: false, fallbackReason: "disabled" };
  }

  try {
    const { findings, notesTail } = await loadContext(input.task.id);
    const result = await withTimeout(
      runAgentWorkflow({
        workflow: WORKFLOW_MODULES.narrate_abandonment,
        inputs: {
          taskName: input.task.name,
          trigger: input.trigger,
          heldBy: input.heldBy,
          lastFindings: renderFindings(findings),
          notesTail: notesTail || "(none)",
          ...(input.releaseNote ? { releaseNote: input.releaseNote } : {}),
        },
      }),
      NARRATION_TIMEOUT_MS,
      "narrate_abandonment"
    );
    const obj = result.object as { summary?: string } | null;
    const summary = (obj?.summary ?? "").trim();
    if (!summary) {
      return {
        summary: fallback,
        fromLlm: false,
        fallbackReason: "empty_response",
      };
    }
    // Always frame the LLM body inside the same envelope so audit
    // parsers (§10.H) can split on the timestamp marker.
    const verb = input.trigger === "force-released" ? "force-released" : "released";
    const framed = isReleaseTrigger(input.trigger)
      ? `${verb} ${nowIso} by ${input.heldBy}: ${summary}`
      : `abandoned ${nowIso}, claim expired — ${summary}`;
    return { summary: framed, fromLlm: true };
  } catch (err) {
    log.warn(
      { err: (err as Error)?.message, taskId: input.task.id, trigger: input.trigger },
      "narrate_abandonment fell back to templated string"
    );
    return {
      summary: fallback,
      fromLlm: false,
      fallbackReason: (err as Error)?.message ?? "unknown",
    };
  }
}
