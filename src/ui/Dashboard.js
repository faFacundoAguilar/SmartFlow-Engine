import { renderGraph } from './GraphView.js';
import { escapeHtml } from '../utils/helpers.js';

function metric(value, label, tone = '') {
  return `<div class="metric-block"><div class="metric-value ${tone}">${value}</div><div class="metric-label">${label}</div></div>`;
}

export function renderOverview(container, { tasks, result }) {
  if (!result) {
    container.innerHTML = `<div class="panel">Generando plan inicial…</div>`;
    return;
  }

  const { metrics, blockedTasks, conflicts, score } = result;
  const efficiency = metrics.totalTasks > 0 ? (metrics.scheduledTasks / metrics.totalTasks) * 100 : 0;

  container.innerHTML = `
    <div class="overview-strip">
      ${metric(metrics.totalTasks, 'Tareas totales')}
      ${metric(metrics.scheduledTasks, 'Planificadas', 'flow')}
      ${metric(blockedTasks.length, 'Bloqueadas', blockedTasks.length > 0 ? 'critical' : '')}
      ${metric(conflicts.length, 'Conflictos', conflicts.length > 0 ? 'warn' : '')}
      ${metric(score.toFixed(1), 'Score global')}
      ${metric(`${efficiency.toFixed(0)}%`, 'Eficiencia de plan')}
    </div>
    <div class="two-col">
      <div class="panel">
        <strong style="font-family:var(--font-display); font-size:14px;">Grafo de dependencias</strong>
        <div id="overview-graph" style="margin-top:10px;"></div>
      </div>
      <div class="panel">
        <strong style="font-family:var(--font-display); font-size:14px;">Conflictos y advertencias</strong>
        <div class="list-scroll" style="margin-top:10px;">
          ${renderConflictRows(conflicts, result.warnings)}
        </div>
      </div>
    </div>
  `;

  renderGraph(container.querySelector('#overview-graph'), { tasks, result });
}

function renderConflictRows(conflicts, warnings) {
  const all = [...conflicts, ...warnings];
  if (all.length === 0) {
    return `<p style="color:var(--text-faint); font-size:12.5px;">Sin conflictos detectados en el plan actual.</p>`;
  }
  return all
    .map((c) => `<div class="conflict-row"><span class="conflict-code">${c.code}</span><span>${escapeHtml(c.message)}</span></div>`)
    .join('');
}
