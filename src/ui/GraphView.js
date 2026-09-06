import { DependencyGraph } from '../core/DependencyGraph.js';
import { escapeHtml } from '../utils/helpers.js';

const MAX_RENDERED_NODES = 220; // más allá de esto, un grafo SVG deja de ser legible; se avisa y se trunca.
const NODE_W = 132;
const NODE_H = 40;
const COL_GAP = 70;
const ROW_GAP = 14;
const MARGIN = 24;

/**
 * Asigna a cada tarea un "nivel" (columna) para el layout. A diferencia del
 * `topologicalSort` de DependencyGraph (que lanza si hay ciclos), aquí se
 * necesita SIEMPRE un layout, incluso con ciclos presentes — por eso se
 * calcula una variante local que aísla los nodos cíclicos en su propia
 * columna en vez de fallar.
 */
function computeLevels(graph) {
  const { cycles } = graph.detectCycles();
  const cyclic = new Set(cycles.flat());

  const inDegree = new Map();
  for (const id of graph.taskIds) {
    if (cyclic.has(id)) continue;
    let count = 0;
    for (const dep of graph.getDependencies(id)) if (!cyclic.has(dep)) count += 1;
    inDegree.set(id, count);
  }

  const levels = new Map();
  let frontier = [...inDegree.keys()].filter((id) => inDegree.get(id) === 0);
  let level = 0;
  const seen = new Set();

  while (frontier.length > 0) {
    for (const id of frontier) {
      levels.set(id, level);
      seen.add(id);
    }
    const next = [];
    for (const id of frontier) {
      for (const dependent of graph.getDependents(id)) {
        if (cyclic.has(dependent) || seen.has(dependent)) continue;
        const remaining = inDegree.get(dependent) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = next;
    level += 1;
  }

  for (const id of graph.taskIds) {
    if (!cyclic.has(id) && !levels.has(id)) levels.set(id, level); // bloqueado indirectamente, se ubica al final
  }
  for (const id of cyclic) levels.set(id, level + 1); // columna dedicada, bien visible, para el/los ciclo(s)

  return { levels, cyclic };
}

function nodeState(id, { blockedTasks, conflicts }) {
  if (blockedTasks.has(id)) return 'blocked';
  const hasDirectConflict = conflicts.some((c) => c.metadata?.taskId === id);
  if (hasDirectConflict) return 'warn';
  return 'flow';
}

const STATE_COLOR = { flow: 'var(--flow)', warn: 'var(--warn)', blocked: 'var(--critical)', completed: 'var(--text-faint)' };

export function renderGraph(container, { tasks, result }) {
  const graph = DependencyGraph.build(tasks);
  const { levels, cyclic } = computeLevels(graph);
  const blockedTasks = new Set(result?.blockedTasks ?? []);
  const conflicts = result?.conflicts ?? [];

  const byLevel = new Map();
  for (const task of tasks) {
    const lvl = levels.get(task.id) ?? 0;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(task);
  }

  const orderedLevels = [...byLevel.keys()].sort((a, b) => a - b);
  const shown = new Set();
  let renderedCount = 0;
  const positions = new Map();

  for (const lvl of orderedLevels) {
    const columnTasks = byLevel.get(lvl);
    columnTasks.forEach((task, i) => {
      if (renderedCount >= MAX_RENDERED_NODES) return;
      positions.set(task.id, {
        x: MARGIN + lvl * (NODE_W + COL_GAP),
        y: MARGIN + i * (NODE_H + ROW_GAP),
        task,
      });
      shown.add(task.id);
      renderedCount += 1;
    });
  }

  const width = MARGIN * 2 + (orderedLevels.length || 1) * (NODE_W + COL_GAP);
  const maxRows = Math.max(1, ...[...byLevel.values()].map((c) => c.length));
  const height = MARGIN * 2 + maxRows * (NODE_H + ROW_GAP);

  const edgesSvg = [];
  for (const task of tasks) {
    if (!shown.has(task.id)) continue;
    for (const depId of task.dependencies) {
      if (!shown.has(depId)) continue;
      const from = positions.get(depId);
      const to = positions.get(task.id);
      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + NODE_H / 2;
      const midX = (x1 + x2) / 2;
      const isCyclicEdge = cyclic.has(depId) && cyclic.has(task.id);
      edgesSvg.push(
        `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="${
          isCyclicEdge ? 'var(--critical)' : 'var(--border)'
        }" stroke-width="1.5" marker-end="url(#arrow)" />`,
      );
    }
  }

  const nodesSvg = [];
  for (const { x, y, task } of positions.values()) {
    const state = task.status === 'completed' ? 'completed' : nodeState(task.id, { blockedTasks, conflicts });
    const color = STATE_COLOR[state];
    nodesSvg.push(`
      <g class="graph-node" data-task-id="${escapeHtml(task.id)}" transform="translate(${x}, ${y})" tabindex="0" role="img" aria-label="Tarea ${escapeHtml(task.name)}, estado ${state}">
        <rect width="${NODE_W}" height="${NODE_H}" rx="6" fill="var(--bg-panel-raised)" stroke="${color}" stroke-width="1.4"></rect>
        <circle cx="12" cy="${NODE_H / 2}" r="4" fill="${color}"></circle>
        <text x="22" y="${NODE_H / 2 + 4}" fill="var(--text)" font-size="11" font-family="Inter, sans-serif">${truncate(
          escapeHtml(task.name),
          15,
        )}</text>
      </g>`);
  }

  const truncatedNotice =
    tasks.length > MAX_RENDERED_NODES
      ? `<p class="view-desc">Mostrando ${MAX_RENDERED_NODES} de ${tasks.length} tareas (el grafo deja de ser legible por encima de ese tamaño). Usa la vista Optimizador para el ranking completo.</p>`
      : '';

  container.innerHTML = `
    ${truncatedNotice}
    <div style="overflow:auto; border:1px solid var(--border-soft); border-radius:8px; background:var(--bg);">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Grafo de dependencias">
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--border)"></path>
          </marker>
        </defs>
        ${edgesSvg.join('')}
        ${nodesSvg.join('')}
      </svg>
    </div>
    <div class="graph-legend">
      <span><span class="legend-dot" style="background:var(--flow)"></span> Disponible / planificada</span>
      <span><span class="legend-dot" style="background:var(--warn)"></span> Con conflicto (deadline o recurso)</span>
      <span><span class="legend-dot" style="background:var(--critical)"></span> Bloqueada / ciclo</span>
      <span><span class="legend-dot" style="background:var(--text-faint)"></span> Completada (simulación)</span>
    </div>
  `;
}

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max)}…` : str;
}
