import { api } from "../lib/api.js";
import { createDependencyGraph } from "../legacy/d3-graph.js";

let graph = null;
let liveStream = null;

export async function mount(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Tasks · Dependency Graph</h1>
        <div class="page-subtitle">Click a node to open task details. Drag to reposition.</div>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" href="#/tasks">Board view</a>
      </div>
    </div>
    <div class="graph-canvas" id="graph-canvas"></div>
  `;

  const canvas = document.getElementById("graph-canvas");
  graph = createDependencyGraph(canvas, {
    onNodeClick: (id) => (location.hash = `#/tasks/${encodeURIComponent(id)}`),
  });

  const refresh = async () => {
    try {
      const { tasks } = await api.get("/api/tasks");
      graph.update(tasks);
    } catch (err) {
      /* ignore */
    }
  };

  await refresh();
  try {
    liveStream = new EventSource("/api/tasks/stream");
    liveStream.addEventListener("update", refresh);
    liveStream.onmessage = refresh;
  } catch (err) {
    /* ignore */
  }
}

export function unmount() {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
  if (graph) {
    graph.destroy();
    graph = null;
  }
}
