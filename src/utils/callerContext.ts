/**
 * Lightweight caller-context tracking (Phase 1 Group 6.4).
 *
 * Destructive tools (`project_delete`, `task_delete`) must reject any
 * call initiated by `workflow_run`. The plan requires a guard: the LLM
 * should never auto-trigger a mass-delete inside a workflow even if the
 * generated tool sequence asks for one.
 *
 * Implementation: a tiny push/pop stack stored in module scope. When
 * `workflow_run` lands (Group 10) it will wrap its dispatch in
 * `withCallerContext({ tool: "workflow_run", ... }, fn)`. Destructive
 * handlers consult `getCurrentCaller()` and refuse when the stack's
 * top frame is `workflow_run`.
 *
 * The stack is intentionally synchronous + in-memory because every MCP
 * tool call runs to completion inside a single event-loop tick before the
 * next request is dispatched. If concurrent invocations ever become a
 * concern this should move to `AsyncLocalStorage`.
 */

export interface CallerFrame {
  /** Name of the tool that owns this frame. */
  tool: string;
  /** Anything the caller wants the destructive guard to see. */
  meta?: Record<string, unknown>;
}

const stack: CallerFrame[] = [];

/** Push a frame, run `fn`, pop unconditionally. */
export async function withCallerContext<T>(frame: CallerFrame, fn: () => Promise<T>): Promise<T> {
  stack.push(frame);
  try {
    return await fn();
  } finally {
    stack.pop();
  }
}

/** Top of the stack, or `null` when no frame is active. */
export function getCurrentCaller(): CallerFrame | null {
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

/** Walk the stack — useful for diagnostics. */
export function getCallerStack(): readonly CallerFrame[] {
  return stack;
}

/**
 * Convenience: true when any frame on the stack is `tool`.
 * Used by destructive handlers to refuse workflow-initiated calls.
 */
export function isInvokedFrom(tool: string): boolean {
  for (const frame of stack) {
    if (frame.tool === tool) return true;
  }
  return false;
}

/** Test-only escape hatch — clear the stack between specs. */
export function _resetCallerContextForTests(): void {
  stack.length = 0;
}
