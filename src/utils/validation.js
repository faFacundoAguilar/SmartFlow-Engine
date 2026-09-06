import { PlanningError, PlanningErrorCode } from '../errors/PlanningError.js';

export const VALID_STATUSES = Object.freeze(['pending', 'in-progress', 'completed', 'blocked']);
const SCALE_MIN = 1;
const SCALE_MAX = 5;

/**
 * Valida los campos de UNA tarea de forma aislada (sin conocer al resto del
 * dataset). Reglas que dependen de otras tareas (dependencias inexistentes,
 * duplicados) se validan aparte en `validateTaskSet`, porque necesitan
 * contexto global y mezclar ambas cosas aquí complicaría el testeo.
 *
 * Nunca confiamos en los datos que llegan desde la UI: esta función es el
 * único punto de entrada legítimo de una tarea al sistema.
 */
export function validateTask(task) {
  const errors = [];

  if (!task || typeof task !== 'object') {
    throw new PlanningError(PlanningErrorCode.VALIDATION_ERROR, 'La tarea debe ser un objeto.', { task });
  }

  const { id, name, priority, estimatedDuration, deadline, difficulty, importance, urgency, dependencies, resources, status } = task;

  if (!id || typeof id !== 'string') {
    errors.push('id es obligatorio y debe ser un string.');
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name es obligatorio y no puede estar vacío.');
  }
  for (const [field, value] of Object.entries({ priority, difficulty, importance, urgency })) {
    if (!isInRange(value, SCALE_MIN, SCALE_MAX)) {
      errors.push(`${field} debe ser un número entre ${SCALE_MIN} y ${SCALE_MAX} (recibido: ${value}).`);
    }
  }
  if (typeof estimatedDuration !== 'number' || Number.isNaN(estimatedDuration) || estimatedDuration <= 0) {
    errors.push(`estimatedDuration debe ser un número positivo (recibido: ${estimatedDuration}).`);
  }
  if (deadline !== null && deadline !== undefined) {
    const d = new Date(deadline);
    if (Number.isNaN(d.getTime())) {
      errors.push(`deadline no es una fecha válida (recibido: ${deadline}).`);
    }
  }
  if (dependencies !== undefined && !Array.isArray(dependencies)) {
    errors.push('dependencies debe ser un array de ids.');
  }
  if (dependencies?.includes(id)) {
    errors.push('una tarea no puede depender de sí misma.');
  }
  if (resources !== undefined) {
    if (!Array.isArray(resources)) {
      errors.push('resources debe ser un array.');
    } else {
      resources.forEach((r, i) => {
        if (!r || typeof r.id !== 'string' || typeof r.amount !== 'number' || r.amount <= 0) {
          errors.push(`resources[${i}] debe tener { id: string, amount: number > 0 }.`);
        }
      });
    }
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    errors.push(`status debe ser uno de: ${VALID_STATUSES.join(', ')} (recibido: ${status}).`);
  }

  if (errors.length > 0) {
    throw new PlanningError(PlanningErrorCode.VALIDATION_ERROR, `Tarea inválida (${id ?? 'sin id'}): ${errors.join(' ')}`, {
      taskId: id,
      errors,
    });
  }
}

/**
 * Valida el CONJUNTO de tareas: duplicados y dependencias que apuntan a ids
 * que no existen en el dataset. Los ciclos NO se detectan aquí: ese es un
 * problema de grafo y vive en DependencyGraph, para no duplicar el recorrido.
 */
export function validateTaskSet(tasks) {
  if (!Array.isArray(tasks)) {
    throw new PlanningError(PlanningErrorCode.VALIDATION_ERROR, 'El conjunto de tareas debe ser un array.', {});
  }

  const seenIds = new Set();
  for (const task of tasks) {
    validateTask(task);
    if (seenIds.has(task.id)) {
      throw new PlanningError(PlanningErrorCode.DUPLICATE_TASK, `Id de tarea duplicado: "${task.id}".`, { taskId: task.id });
    }
    seenIds.add(task.id);
  }

  for (const task of tasks) {
    for (const depId of task.dependencies ?? []) {
      if (!seenIds.has(depId)) {
        throw new PlanningError(
          PlanningErrorCode.INVALID_DEPENDENCY,
          `La tarea "${task.id}" depende de "${depId}", que no existe en el conjunto.`,
          { taskId: task.id, missingDependency: depId },
        );
      }
    }
  }
}

function isInRange(value, min, max) {
  return typeof value === 'number' && !Number.isNaN(value) && value >= min && value <= max;
}
