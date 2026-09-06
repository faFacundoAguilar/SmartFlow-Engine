import { validateTask } from '../utils/validation.js';

/**
 * `Task` se modela como un objeto plano inmutable, no como una clase.
 * Razón: no tiene comportamiento propio (no hay métodos que dependan de su
 * estado interno de forma no trivial) — es un registro de datos. Una clase
 * aquí solo añadiría ceremonia sin beneficio real. Donde SÍ usamos clases es
 * en DependencyGraph, ScoringEngine, etc., que tienen estado y comportamiento
 * genuinamente encapsulados.
 *
 * `createTask` es la única puerta de entrada: valida y congela (shallow en
 * el objeto, y también los arrays internos) para que nada aguas abajo del
 * pipeline pueda mutar una tarea por accidente. Si el motor necesita una
 * tarea "distinta" (p. ej. marcarla completada), crea una copia nueva con
 * spread — nunca muta la original.
 */
export function createTask(input) {
  const task = {
    id: input.id,
    name: input.name,
    description: input.description ?? '',
    priority: input.priority,
    estimatedDuration: input.estimatedDuration,
    deadline: input.deadline ?? null,
    difficulty: input.difficulty,
    category: input.category ?? 'general',
    dependencies: Object.freeze([...(input.dependencies ?? [])]),
    resources: Object.freeze((input.resources ?? []).map((r) => Object.freeze({ ...r }))),
    status: input.status ?? 'pending',
    importance: input.importance,
    urgency: input.urgency,
  };

  validateTask(task);

  return Object.freeze(task);
}

/**
 * Devuelve una nueva tarea con los campos indicados sobrescritos.
 * Nunca muta `task`; re-valida el resultado para no dejar colar un estado
 * inconsistente por una actualización parcial descuidada.
 */
export function withUpdates(task, updates) {
  return createTask({ ...task, ...updates });
}
