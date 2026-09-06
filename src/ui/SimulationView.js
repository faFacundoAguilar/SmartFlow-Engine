import { escapeHtml, throttle } from '../utils/helpers.js';

const MAX_LANES = 150;

export function renderSimulationShell(container, { tasks, running }, actions) {
  const shown = tasks.slice(0, MAX_LANES);
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <div>
        <strong style="font-family:var(--font-display); font-size:14px;">Simulación en tiempo real</strong>
        <p class="view-desc">Ejecuta el plan de verdad: concurrencia real con Promises, no una barra que finge.</p>
      </div>
      <button class="btn btn-primary" id="run-simulation" ${running ? 'disabled' : ''}>${running ? 'Ejecutando…' : 'Ejecutar simulación'}</button>
    </div>
    <div class="panel">
      <div class="sim-progress-track"><div class="sim-progress-fill" id="sim-progress-fill"></div></div>
      ${tasks.length > MAX_LANES ? `<p class="view-desc">Mostrando ${MAX_LANES} de ${tasks.length} tareas.</p>` : ''}
      <div class="sim-lane-grid" id="sim-lane-grid">
        ${shown.map((t) => renderLane(t.id, t.name, 'pending')).join('')}
      </div>
    </div>
  `;

  container.querySelector('#run-simulation').addEventListener('click', () => actions.onRun());
}

function renderLane(id, name, state) {
  return `
    <div class="sim-lane ${state === 'running' ? 'running' : ''}" data-lane-id="${escapeHtml(id)}">
      <div class="lane-id">${escapeHtml(name)}</div>
      <div class="lane-state">${labelFor(state)}</div>
    </div>
  `;
}

function labelFor(state) {
  return { pending: 'en espera', running: 'ejecutando…', done: 'completada', blocked: 'bloqueada' }[state] ?? state;
}

/** Actualiza SOLO el carril afectado, en vez de reconstruir toda la grilla en cada evento de simulación. */
export function setLaneState(container, taskId, state) {
  const lane = container.querySelector(`[data-lane-id="${cssEscape(taskId)}"]`);
  if (!lane) return;
  lane.classList.toggle('running', state === 'running');
  lane.querySelector('.lane-state').textContent = labelFor(state);
}

export function setProgress(container, progress) {
  const fill = container.querySelector('#sim-progress-fill');
  if (fill) fill.style.width = `${Math.round(progress * 100)}%`;
}

/**
 * Throttle real: con datasets grandes, SIMULATION_TASK_STARTED/COMPLETED
 * pueden dispararse muy seguido (speedFactor alto). Repintar en cada evento
 * saturaría el hilo principal; con throttle se actualiza como mucho a ~30fps.
 */
export const throttledSetLaneState = throttle(setLaneState, 33);

function cssEscape(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}
