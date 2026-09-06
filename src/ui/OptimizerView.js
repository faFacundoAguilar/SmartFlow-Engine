import { DEFAULT_WEIGHTS } from '../core/ScoringEngine.js';
import { escapeHtml, debounce } from '../utils/helpers.js';

const WEIGHT_LABELS = {
  priority: 'Prioridad',
  urgency: 'Urgencia',
  importance: 'Importancia',
  deadline: 'Cercanía de deadline',
  delay: 'Retraso (overdue)',
  dependencyImpact: 'Impacto en otras tareas',
  durationPenalty: 'Penalización por duración',
  difficultyPenalty: 'Penalización por dificultad',
};

export function renderOptimizer(container, { weights, result, tasksById }, actions) {
  const currentWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const ordered = [...(result?.orderedTasks ?? [])].sort((a, b) => a.startTime - b.startTime);
  const maxScore = Math.max(1, ...ordered.map((t) => t.score));

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <strong style="font-family:var(--font-display); font-size:14px;">Pesos del scoring</strong>
      <p class="view-desc" style="margin-bottom:14px;">Arrastra un peso: el plan se recalcula automáticamente (con un pequeño retraso para no recalcular en cada píxel).</p>
      <div class="weights-grid">
        ${Object.entries(currentWeights)
          .map(
            ([key, value]) => `
          <div class="weight-row">
            <div class="weight-head"><span>${WEIGHT_LABELS[key] ?? key}</span><output id="out-${key}">${value}</output></div>
            <input type="range" min="0" max="50" step="1" value="${value}" data-weight="${key}" />
          </div>`,
          )
          .join('')}
      </div>
    </div>

    <div class="panel">
      <strong style="font-family:var(--font-display); font-size:14px;">Ranking de ejecución</strong>
      <div style="margin-top:10px;">
        ${
          ordered.length === 0
            ? `<p style="color:var(--text-faint); font-size:12.5px;">No hay tareas planificadas todavía.</p>`
            : ordered.map((entry, i) => renderRankRow(entry, i, maxScore, tasksById)).join('')
        }
      </div>
    </div>
  `;

  const recalc = debounce((key, value) => actions.onWeightChange(key, value), 200);

  container.querySelectorAll('input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const key = input.dataset.weight;
      container.querySelector(`#out-${key}`).textContent = input.value;
      recalc(key, Number(input.value));
    });
  });
}

function renderRankRow(entry, index, maxScore, tasksById) {
  const task = tasksById.get(entry.taskId);
  const widthPct = Math.max(4, (entry.score / maxScore) * 100);
  return `
    <div class="rank-row">
      <span class="rank-index">${String(index + 1).padStart(2, '0')}</span>
      <span>${escapeHtml(task?.name ?? entry.taskId)}</span>
      <span class="mono" title="score">${entry.score.toFixed(1)}</span>
      <span class="mono" style="color:var(--text-faint);">${entry.startTime}–${entry.endTime}m</span>
      <div class="rank-bar-track"><div class="rank-bar-fill" style="width:${widthPct}%"></div></div>
    </div>
  `;
}
