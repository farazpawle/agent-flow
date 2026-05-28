/**
 * Lightweight fetch wrapper. Throws ApiError with parsed body on non-2xx.
 */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, { body, signal } = {}) {
  const opts = { method, headers: { Accept: "application/json" }, signal };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const msg = (parsed && parsed.error) || parsed || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status, parsed);
  }
  return parsed;
}

export const api = {
  get: (url, opts) => request("GET", url, opts),
  post: (url, body, opts) => request("POST", url, { body, ...opts }),
  patch: (url, body, opts) => request("PATCH", url, { body, ...opts }),
  put: (url, body, opts) => request("PUT", url, { body, ...opts }),
  del: (url, opts) => request("DELETE", url, opts),
};

/**
 * Wave 4 §10.B — true when an LLM provider is active (not "none").
 * The plan-upload + skill-compile routes return 503 when the active
 * provider is "none", so the GUI gates those affordances on this.
 * Best-effort: resolves false on any error rather than throwing.
 */
export async function isLlmConfigured() {
  try {
    const settings = await request("GET", "/api/llm/settings");
    return Boolean(settings && settings.provider && settings.provider !== "none");
  } catch {
    return false;
  }
}

/**
 * Open a Server-Sent Events stream. Returns an object with `close()` and event handlers.
 */
export function sse(url, { onMessage, onEvent, onError, onOpen } = {}) {
  const es = new EventSource(url);
  if (onOpen) es.onopen = onOpen;
  if (onMessage) es.onmessage = (e) => onMessage(e.data, e);
  if (onError) es.onerror = onError;
  if (onEvent) {
    for (const [name, fn] of Object.entries(onEvent)) {
      es.addEventListener(name, fn);
    }
  }
  return es;
}
