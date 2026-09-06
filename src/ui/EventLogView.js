import { escapeHtml } from '../utils/helpers.js';

const MAX_ROWS = 200;

export function renderEventLogShell(container) {
  container.innerHTML = `
    <div class="panel">
      <strong style="font-family:var(--font-display); font-size:14px;">Registro de eventos</strong>
      <p class="view-desc">Todo lo que emite el EventBus interno: motor, simulación y generador de datos, desacoplados de la UI.</p>
      <div id="event-log-list" class="list-scroll" style="max-height:480px; margin-top:10px;"></div>
    </div>
  `;
}

export function appendEventLogRow(container, event) {
  const list = container.querySelector('#event-log-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'event-row';
  const time = new Date(event.timestamp).toLocaleTimeString();
  row.innerHTML = `<span>${time}</span><span class="event-type">${escapeHtml(event.type)}</span><span>${escapeHtml(summarize(event.payload))}</span>`;
  list.prepend(row);
  while (list.children.length > MAX_ROWS) list.removeChild(list.lastChild);
}

function summarize(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const keys = Object.keys(payload).slice(0, 3);
  return keys.map((k) => `${k}=${formatValue(payload[k])}`).join(' ');
}

function formatValue(value) {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'number') return Number.isInteger(value) ? value : value.toFixed(1);
  return String(value);
}
