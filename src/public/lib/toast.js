/**
 * Lightweight toast manager. Mount with mountToastHost(container) once on boot.
 * Then call toast.success/info/error/warn from anywhere.
 */
let host = null;

export function mountToastHost(container) {
  host = container;
  host.classList.add("toast-host");
}

function show(kind, message, opts = {}) {
  if (!host) {
    console[kind === "error" ? "error" : "log"](`[${kind}] ${message}`);
    return;
  }
  const node = document.createElement("div");
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  host.appendChild(node);
  const ttl = opts.ttl ?? (kind === "error" ? 6000 : 3500);
  const remove = () => {
    node.classList.add("toast-leave");
    setTimeout(() => node.remove(), 220);
  };
  setTimeout(remove, ttl);
  node.addEventListener("click", remove);
}

export const toast = {
  success: (m, o) => show("success", m, o),
  error: (m, o) => show("error", m, o),
  info: (m, o) => show("info", m, o),
  warn: (m, o) => show("warn", m, o),
};
