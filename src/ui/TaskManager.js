import { escapeHtml } from '../utils/helpers.js';
import { isOverdue } from '../utils/dateUtils.js';
import { VALID_STATUSES } from '../utils/validation.js';

/**
 * Delegación de eventos deliberada: la tabla tiene UN listener de click
 * (asignado una sola vez por `app.js`, no en cada render), y se decide qué
 * hacer leyendo `data-action`/`data-id` del elemento pulsado. Si se
 * asignara un listener por fila, cada re-render (que reconstruye el HTML
 * completo de la tabla) tendría que volver a engancharlos todos — con
 * delegación, el listener vive en el contenedor y sobrevive a los re-renders.
 */
export function renderTaskManager(container, { tasks, editingTask, formError }, actions) {
  const editing = editingTask ?? null;

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <form id="task-form" class="task-form" novalidate>
        <div class="field">
          <label for="f-name">Nombre</label>
          <input id="f-name" name="name" type="text" required value="${escapeHtml(editing?.name ?? '')}" />
        </div>
        <div class="field">
          <label for="f-category">Categoría</label>
          <input id="f-category" name="category" type="text" value="${escapeHtml(editing?.category ?? 'general')}" />
        </div>
        <div class="field">
          <label for="f-duration">Duración estimada (min)</label>
          <input id="f-duration" name="estimatedDuration" type="number" min="1" required value="${editing?.estimatedDuration ?? 30}" />
        </div>
        <div class="field">
          <label for="f-deadline">Deadline (opcional)</label>
          <input id="f-deadline" name="deadline" type="datetime-local" value="${toLocalInputValue(editing?.deadline)}" />
        </div>

        <div class="field">
          <label for="f-priority">Prioridad (1-5)</label>
          <input id="f-priority" name="priority" type="number" min="1" max="5" required value="${editing?.priority ?? 3}" />
        </div>
        <div class="field">
          <label for="f-difficulty">Dificultad (1-5)</label>
          <input id="f-difficulty" name="difficulty" type="number" min="1" max="5" required value="${editing?.difficulty ?? 3}" />
        </div>
        <div class="field">
          <label for="f-importance">Importancia (1-5)</label>
          <input id="f-importance" name="importance" type="number" min="1" max="5" required value="${editing?.importance ?? 3}" />
        </div>
        <div class="field">
          <label for="f-urgency">Urgencia (1-5)</label>
          <input id="f-urgency" name="urgency" type="number" min="1" max="5" required value="${editing?.urgency ?? 3}" />
        </div>

        <div class="field span-2">
          <label for="f-deps">Dependencias</label>
          <select id="f-deps" name="dependencies" multiple size="4">
            ${tasks
              .filter((t) => t.id !== editing?.id)
              .map(
                (t) =>
                  `<option value="${escapeHtml(t.id)}" ${editing?.dependencies?.includes(t.id) ? 'selected' : ''}>${escapeHtml(t.name)}</option>`,
              )
              .join('')}
          </select>
        </div>
        <div class="field span-2">
          <label for="f-resources">Recursos (formato: id:cantidad, separados por coma)</label>
          <input id="f-resources" name="resources" type="text" placeholder="gpu:1, design-team:2" value="${resourcesToText(editing?.resources)}" />
        </div>

        ${formError ? `<div class="span-4" style="color:var(--critical); font-size:12.5px;">${escapeHtml(formError)}</div>` : ''}

        <div class="span-4" style="display:flex; gap:8px;">
          <button type="submit" class="btn btn-primary">${editing ? 'Guardar cambios' : 'Crear tarea'}</button>
          ${editing ? `<button type="button" class="btn" data-action="cancel-edit">Cancelar</button>` : ''}
        </div>
      </form>
    </div>

    <div class="panel">
      <table class="task-table">
        <thead>
          <tr>
            <th>Nombre</th><th>Categoría</th><th>Prioridad</th><th>Duración</th><th>Deadline</th><th>Dependencias</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody id="task-table-body">
          ${tasks.map(renderRow).join('') || `<tr><td colspan="8" style="color:var(--text-faint);">No hay tareas todavía.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  const form = container.querySelector('#task-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const input = {
      name: data.get('name'),
      category: data.get('category') || 'general',
      estimatedDuration: Number(data.get('estimatedDuration')),
      deadline: data.get('deadline') ? new Date(data.get('deadline')).toISOString() : null,
      priority: Number(data.get('priority')),
      difficulty: Number(data.get('difficulty')),
      importance: Number(data.get('importance')),
      urgency: Number(data.get('urgency')),
      dependencies: [...form.querySelector('#f-deps').selectedOptions].map((o) => o.value),
      resources: parseResources(data.get('resources')),
    };
    actions.onSubmit(input, editing?.id ?? null);
  });

  // Delegación: un único listener para editar/eliminar cualquier fila.
  container.querySelector('#task-table-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === 'edit') actions.onEdit(id);
    if (action === 'delete') actions.onDelete(id);
  });

  // Un único listener también para los <select> de estado (delegación por
  // tipo de evento 'change', igual de válida que por 'click').
  container.querySelector('#task-table-body').addEventListener('change', (event) => {
    const select = event.target.closest('select[data-action="status"]');
    if (!select) return;
    actions.onStatusChange(select.dataset.id, select.value);
  });

  container.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', () => actions.onCancelEdit());
}

function renderRow(task) {
  const overdue = isOverdue(task);
  return `
    <tr>
      <td>${escapeHtml(task.name)}</td>
      <td><span class="tag">${escapeHtml(task.category)}</span></td>
      <td class="mono">${task.priority}</td>
      <td class="mono">${task.estimatedDuration}m</td>
      <td class="mono" style="${overdue ? 'color:var(--critical);' : ''}">${task.deadline ? new Date(task.deadline).toLocaleString() : '—'}${overdue ? ' ⚠' : ''}</td>
      <td>${task.dependencies.length ? task.dependencies.map((d) => `<span class="tag">${escapeHtml(d)}</span>`).join(' ') : '—'}</td>
      <td>
        <select data-action="status" data-id="${escapeHtml(task.id)}" style="background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:4px; font-size:11.5px; padding:3px 5px;">
          ${VALID_STATUSES.map((s) => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}
        </select>
      </td>
      <td style="white-space:nowrap;">
        <button class="icon-btn" data-action="edit" data-id="${escapeHtml(task.id)}" aria-label="Editar ${escapeHtml(task.name)}">✎</button>
        <button class="icon-btn danger" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Eliminar ${escapeHtml(task.name)}">✕</button>
      </td>
    </tr>
  `;
}

function statusLabel(status) {
  return { pending: 'Pendiente', 'in-progress': 'En curso', completed: 'Completada', blocked: 'Bloqueada' }[status] ?? status;
}

function parseResources(text) {
  if (!text || !text.trim()) return [];
  return text
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [id, amount] = chunk.split(':').map((s) => s.trim());
      return { id, amount: Number(amount) || 1 };
    });
}

function resourcesToText(resources) {
  if (!resources || resources.length === 0) return '';
  return resources.map((r) => `${r.id}:${r.amount}`).join(', ');
}

function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
