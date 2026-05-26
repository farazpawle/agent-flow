/**
 * Tiny hash router for the AgentFlow SPA.
 * Routes are registered with patterns like "/projects/:id".
 * Each route handler is { mount, unmount } where mount(container, params) renders
 * and unmount() (optional) cleans up timers/subscriptions.
 */
export class Router {
  constructor(outlet) {
    this.outlet = outlet;
    this.routes = [];
    this.currentRoute = null;
    this.currentHandler = null;
    this.listeners = new Set();
    window.addEventListener("hashchange", () => this.handle());
  }

  on(pattern, handler) {
    const regex = patternToRegex(pattern);
    this.routes.push({ pattern, regex, paramNames: extractParamNames(pattern), handler });
    return this;
  }

  notFound(handler) {
    this.fallback = handler;
    return this;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  navigate(hash) {
    if (!hash.startsWith("#")) hash = "#" + hash;
    if (location.hash === hash) {
      this.handle();
    } else {
      location.hash = hash;
    }
  }

  start() {
    if (!location.hash) location.hash = "#/";
    this.handle();
  }

  async handle() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [pathname, queryStr] = raw.split("?");
    const query = parseQuery(queryStr);

    let matched = null;
    let params = {};
    for (const route of this.routes) {
      const m = pathname.match(route.regex);
      if (m) {
        matched = route;
        params = {};
        route.paramNames.forEach((name, i) => {
          params[name] = decodeURIComponent(m[i + 1]);
        });
        break;
      }
    }

    const handler = matched ? matched.handler : this.fallback;
    if (!handler) {
      this.outlet.innerHTML = `<div class="page-empty"><h2>Not found</h2><p>${escape(pathname)}</p></div>`;
      return;
    }

    // Tear down previous page
    if (this.currentHandler && typeof this.currentHandler.unmount === "function") {
      try {
        await this.currentHandler.unmount();
      } catch (err) {
        console.warn("unmount error", err);
      }
    }

    this.outlet.innerHTML = "";
    this.currentRoute = { pathname, params, query, pattern: matched?.pattern };
    this.currentHandler = handler;

    try {
      await handler.mount(this.outlet, { params, query, pathname });
    } catch (err) {
      console.error("Page mount error", err);
      this.outlet.innerHTML = `<div class="page-empty error"><h2>Page failed to load</h2><pre>${escape(err.message || String(err))}</pre></div>`;
    }

    this.listeners.forEach((fn) => {
      try {
        fn(this.currentRoute);
      } catch {}
    });
  }
}

function patternToRegex(pattern) {
  const escaped = pattern.replace(/[/\-\\^$*+?.()|[\]{}]/g, (m) => (m === "/" ? "/" : "\\" + m));
  const regex = escaped.replace(/:(\w+)/g, "([^/]+)");
  return new RegExp(`^${regex}/?$`);
}

function extractParamNames(pattern) {
  return [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
}

function parseQuery(qs) {
  const out = {};
  if (!qs) return out;
  for (const part of qs.split("&")) {
    const [k, v] = part.split("=");
    if (!k) continue;
    out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : "";
  }
  return out;
}

function escape(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
