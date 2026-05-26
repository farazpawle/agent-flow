/**
 * Dependency-graph renderer — extracted from the original script.js.
 * Self-contained: accepts a container and callbacks; exposes update/highlight/destroy.
 *
 * Usage:
 *   const graph = createDependencyGraph(container, { onNodeClick: (id) => ... });
 *   graph.update(tasks);
 *   graph.highlight(taskId);
 *   graph.destroy();
 */
export function createDependencyGraph(container, { onNodeClick } = {}) {
  if (!window.d3) {
    container.innerHTML = `<p class="placeholder">D3 not available — graph cannot render.</p>`;
    return { update() {}, highlight() {}, destroy() {} };
  }
  const d3 = window.d3;

  let svg = null;
  let g = null;
  let simulation = null;
  let currentTasks = [];

  function ensureCanvas() {
    if (svg) {
      const width = container.clientWidth;
      const height = container.clientHeight || 400;
      svg.attr("viewBox", [0, 0, width, height]);
      simulation.force("center", d3.forceCenter(width / 2, height / 2));
      return;
    }
    container.innerHTML = "";
    const width = container.clientWidth;
    const height = container.clientHeight || 400;
    svg = d3
      .select(container)
      .append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%")
      .style("height", "100%");
    g = svg.append("g");
    svg.call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));

    g.append("defs")
      .append("marker")
      .attr("id", "agentflow-arrowhead")
      .attr("viewBox", "-0 -5 10 10")
      .attr("refX", 25)
      .attr("refY", 0)
      .attr("orient", "auto")
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "currentColor");

    simulation = d3
      .forceSimulation()
      .force(
        "link",
        d3
          .forceLink()
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-360))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(34))
      .on("tick", ticked);

    g.append("g").attr("class", "links");
    g.append("g").attr("class", "nodes");
  }

  function ticked() {
    if (!g) return;
    g.select(".links")
      .selectAll("line.link")
      .attr("x1", (d) => d.source.x)
      .attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x)
      .attr("y2", (d) => d.target.y);
    g.select(".nodes")
      .selectAll("g.node-item")
      .attr("transform", (d) => `translate(${d.x || 0}, ${d.y || 0})`);
  }

  function statusToClass(s) {
    return s ? String(s).toLowerCase().replace(/\s+/g, "-").replace(/_/g, "-") : "unknown";
  }

  function drag() {
    function start(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragging(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function end(event) {
      if (!event.active) simulation.alphaTarget(0);
    }
    return d3.drag().on("start", start).on("drag", dragging).on("end", end);
  }

  function update(tasks) {
    currentTasks = tasks || [];
    if (!currentTasks.length) {
      if (svg) {
        svg.remove();
        svg = null;
        g = null;
        simulation = null;
      }
      container.innerHTML = `<p class="placeholder">No tasks to graph. Create or import tasks first.</p>`;
      return;
    }
    ensureCanvas();

    const existing = simulation.nodes();
    const nodes = currentTasks.map((t) => {
      const prev = existing.find((n) => n.id === t.id);
      return {
        id: t.id,
        name: t.name,
        status: t.status,
        executionOrder: t.executionOrder,
        x: prev?.x,
        y: prev?.y,
        fx: prev?.fx,
        fy: prev?.fy,
      };
    });
    const idSet = new Set(nodes.map((n) => n.id));
    const links = [];
    for (const t of currentTasks) {
      if (!t.dependencies) continue;
      for (const dep of t.dependencies) {
        const sourceId = typeof dep === "object" ? dep.taskId : dep;
        if (idSet.has(sourceId) && idSet.has(t.id)) {
          links.push({ source: sourceId, target: t.id });
        }
      }
    }

    // Links
    const linkSel = g
      .select(".links")
      .selectAll("line.link")
      .data(links, (d) => `${d.source.id || d.source}-${d.target.id || d.target}`);
    linkSel.exit().transition().duration(200).attr("stroke-opacity", 0).remove();
    const linkEnter = linkSel
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke", "currentColor")
      .attr("marker-end", "url(#agentflow-arrowhead)")
      .attr("stroke-opacity", 0);
    linkSel
      .merge(linkEnter)
      .transition()
      .duration(400)
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", 1.5);

    // Nodes
    const nodeSel = g
      .select(".nodes")
      .selectAll("g.node-item")
      .data(nodes, (d) => d.id);
    nodeSel.exit().transition().duration(200).attr("opacity", 0).remove();

    const enter = nodeSel
      .enter()
      .append("g")
      .attr("class", (d) => `node-item status-${statusToClass(d.status)}`)
      .attr("data-id", (d) => d.id)
      .attr(
        "transform",
        (d) =>
          `translate(${d.x || Math.random() * container.clientWidth}, ${d.y || Math.random() * container.clientHeight}) scale(0)`
      )
      .attr("opacity", 0)
      .call(drag())
      .on("click", (event, d) => {
        if (onNodeClick) onNodeClick(d.id);
        event.stopPropagation();
      });

    enter.append("circle").attr("r", 16).attr("stroke", "#fff").attr("stroke-width", 2);
    enter
      .append("text")
      .attr("class", "node-order")
      .attr("y", 4)
      .attr("text-anchor", "middle")
      .attr("font-size", "11px")
      .attr("font-weight", "700")
      .attr("fill", "#fff")
      .text((d) => (typeof d.executionOrder === "number" ? d.executionOrder : "?"));
    enter
      .append("text")
      .attr("class", "node-name")
      .attr("x", 22)
      .attr("y", 4)
      .attr("font-size", "11px")
      .text((d) => (d.name?.length > 28 ? d.name.slice(0, 28) + "…" : d.name));
    enter.append("title").text((d) => `${d.name} — ${d.status}`);

    const merged = nodeSel.merge(enter);
    merged.attr("class", (d) => `node-item status-${statusToClass(d.status)}`);
    merged
      .transition()
      .duration(400)
      .attr("transform", (d) => `translate(${d.x || 0}, ${d.y || 0}) scale(1)`)
      .attr("opacity", 1);

    simulation.nodes(nodes);
    simulation.force("link").links(links);
    simulation.alpha(0.4).restart();
  }

  function highlight(taskId) {
    if (!g) return;
    g.select(".nodes").selectAll("g.node-item").classed("highlighted", false);
    if (taskId)
      g.select(".nodes").select(`g.node-item[data-id="${taskId}"]`).classed("highlighted", true);
  }

  function destroy() {
    if (simulation) simulation.stop();
    container.innerHTML = "";
    svg = null;
    g = null;
    simulation = null;
  }

  // Resize handling
  const onResize = () => {
    if (!svg) return;
    const width = container.clientWidth;
    const height = container.clientHeight || 400;
    svg.attr("viewBox", [0, 0, width, height]);
    simulation.force("center", d3.forceCenter(width / 2, height / 2));
    simulation.alpha(0.2).restart();
  };
  window.addEventListener("resize", onResize);
  const origDestroy = destroy;
  return {
    update,
    highlight,
    destroy() {
      window.removeEventListener("resize", onResize);
      origDestroy();
    },
  };
}
