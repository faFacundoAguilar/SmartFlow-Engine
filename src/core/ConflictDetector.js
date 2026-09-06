import { PlanningErrorCode } from '../errors/PlanningError.js';
import { minutesUntilDeadline } from '../utils/dateUtils.js';

/**
 * Los conflictos NO se lanzan como excepciones: una tarea con problemas no
 * debe impedir analizar el resto del dataset. Se devuelven como datos
 * estructurados (misma forma que PlanningError.toJSON()) para que la UI y
 * el resto del motor los consuman de manera uniforme, se hayan generado por
 * un throw real o por este detector.
 */
function createConflict(code, message, metadata = {}) {
  return { code, message, metadata, severity: HARD_CODES.has(code) ? 'error' : 'warning' };
}

const HARD_CODES = new Set([
  PlanningErrorCode.TASK_DEPENDENCY_CYCLE,
  PlanningErrorCode.RESOURCE_CONFLICT,
  PlanningErrorCode.DEADLINE_CONFLICT,
  PlanningErrorCode.BLOCKED_TASK,
  PlanningErrorCode.IMPOSSIBLE_SCHEDULE,
]);

/**
 * Analiza el dataset completo y devuelve { conflicts, warnings }.
 *
 * `constraints.resourceCapacities`: Map o objeto { resourceId: capacidadTotal }.
 * Si un recurso no aparece ahí, se asume capacidad = 1 (un único "slot" del recurso).
 * `constraints.now`: instante de referencia para deadlines (inyectable para tests).
 */
export function analyzeConflicts(tasks, graph, constraints = {}) {
  const now = constraints.now ?? new Date();
  const capacities = normalizeCapacities(constraints.resourceCapacities);
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  const conflicts = [];
  const warnings = [];

  const { hasCycle, cycles } = graph.detectCycles();
  const cyclicIds = new Set(cycles.flat());

  if (hasCycle) {
    for (const cyclePath of cycles) {
      conflicts.push(
        createConflict(
          PlanningErrorCode.TASK_DEPENDENCY_CYCLE,
          `Dependencia circular detectada: ${cyclePath.join(' → ')}.`,
          { cyclePath },
        ),
      );
    }
  }

  // Deadlines imposibles: solo tiene sentido calcularlos sobre la parte
  // acíclica del grafo (si hay ciclos, el earliest-finish no está definido).
  if (!hasCycle) {
    const earliestFinish = computeEarliestFinish(tasks, graph, tasksById);
    for (const task of tasks) {
      const availableMinutes = minutesUntilDeadline(task, now);
      if (availableMinutes === null) continue;
      const requiredMinutes = earliestFinish.get(task.id);
      if (requiredMinutes > availableMinutes) {
        conflicts.push(
          createConflict(
            PlanningErrorCode.DEADLINE_CONFLICT,
            `La tarea "${task.id}" no puede cumplir su deadline: necesita al menos ${requiredMinutes.toFixed(
              1,
            )} min (contando dependencias) pero solo quedan ${availableMinutes.toFixed(1)} min.`,
            { taskId: task.id, requiredMinutes, availableMinutes },
          ),
        );
      }
    }
  }

  // Recursos: una tarea que por sí sola pide más de la capacidad total del recurso, nunca podrá ejecutarse.
  const resourceImpossibleIds = new Set();
  for (const task of tasks) {
    for (const resource of task.resources) {
      const capacity = capacities.get(resource.id) ?? 1;
      if (resource.amount > capacity) {
        resourceImpossibleIds.add(task.id);
        conflicts.push(
          createConflict(
            PlanningErrorCode.RESOURCE_CONFLICT,
            `La tarea "${task.id}" requiere ${resource.amount} unidad(es) de "${resource.id}", pero la capacidad total es ${capacity}.`,
            { taskId: task.id, resourceId: resource.id, requested: resource.amount, capacity },
          ),
        );
      }
    }
  }

  // Cualquier tarea inejecutable (cíclica o con un recurso imposible) bloquea
  // transitivamente a quien dependa de ella. Se calcula UNA vez sobre la
  // unión de ambas causas para no duplicar el recorrido del grafo.
  const unschedulableIds = new Set([...cyclicIds, ...resourceImpossibleIds]);
  if (unschedulableIds.size > 0) {
    const transitivelyBlocked = findTransitivelyBlocked(graph, unschedulableIds);
    for (const id of transitivelyBlocked) {
      conflicts.push(
        createConflict(
          PlanningErrorCode.BLOCKED_TASK,
          `La tarea "${id}" nunca podrá completarse: depende (directa o indirectamente) de una tarea inejecutable.`,
          { taskId: id },
        ),
      );
    }
    if (hasCycle) {
      conflicts.push(
        createConflict(
          PlanningErrorCode.IMPOSSIBLE_SCHEDULE,
          `El plan no puede completarse en su totalidad: ${cyclicIds.size} tarea(s) forman parte de dependencias circulares.`,
          { affectedTaskCount: cyclicIds.size },
        ),
      );
    }
  }

  // Sobrecarga: tareas mutuamente independientes (sin relación de dependencia
  // entre ellas) que compiten por el mismo recurso y, sumadas, exceden la
  // capacidad. No es necesariamente un error irrecuperable (el Optimizer las
  // podrá secuenciar), pero sí una señal de posible cuello de botella.
  warnings.push(...detectResourceOverload(tasks, graph, capacities));

  return { conflicts, warnings };
}

/** Cualquier tarea (que no sea ella misma inejecutable) que dependa transitivamente de alguna en `unschedulableIds`. */
function findTransitivelyBlocked(graph, unschedulableIds) {
  const blocked = new Set();
  for (const id of graph.taskIds) {
    if (unschedulableIds.has(id)) continue;
    const stack = [...graph.getDependencies(id)];
    const seen = new Set();
    while (stack.length > 0) {
      const dep = stack.pop();
      if (seen.has(dep)) continue;
      seen.add(dep);
      if (unschedulableIds.has(dep)) {
        blocked.add(id);
        break;
      }
      stack.push(...graph.getDependencies(dep));
    }
  }
  return blocked;
}

/**
 * Earliest-finish-time de cada tarea asumiendo concurrencia ILIMITADA
 * (mejor caso posible): earliestFinish(t) = duration(t) + max(earliestFinish(dep) para dep en deps(t), 0 si no hay deps).
 * Se recorre en orden topológico para que los deps ya estén resueltos. O(V + E).
 * Esto da una cota inferior real: si ni en el mejor caso se llega al deadline,
 * es matemáticamente imposible cumplirlo con cualquier estrategia de scheduling.
 */
function computeEarliestFinish(tasks, graph, tasksById) {
  const { order } = graph.topologicalSort();
  const earliestFinish = new Map();
  for (const id of order) {
    const task = tasksById.get(id);
    const deps = [...graph.getDependencies(id)];
    const earliestStart = deps.length === 0 ? 0 : Math.max(...deps.map((d) => earliestFinish.get(d)));
    earliestFinish.set(id, earliestStart + task.estimatedDuration);
  }
  return earliestFinish;
}

/**
 * Agrupa tareas por "componente de independencia" de forma aproximada:
 * usa los niveles del ordenamiento topológico como proxy de "podrían
 * ejecutarse a la vez". Es una heurística deliberadamente simple: el
 * análisis exacto de qué conjuntos de tareas son mutuamente independientes
 * es más caro (cierre transitivo completo) y el Optimizer, al ejecutar de
 * verdad, es la fuente de la verdad final sobre sobrecarga real.
 */
function detectResourceOverload(tasks, graph, capacities) {
  const warnings = [];
  let levels;
  try {
    ({ levels } = graph.topologicalSort());
  } catch {
    return warnings; // con ciclos presentes, ya se reportó por otra vía.
  }
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  for (const level of levels) {
    const demandByResource = new Map();
    for (const id of level) {
      const task = tasksById.get(id);
      for (const resource of task.resources) {
        demandByResource.set(resource.id, (demandByResource.get(resource.id) ?? 0) + resource.amount);
      }
    }
    for (const [resourceId, demand] of demandByResource) {
      const capacity = capacities.get(resourceId) ?? 1;
      if (demand > capacity) {
        warnings.push(
          createConflict(
            PlanningErrorCode.OVERLOAD,
            `${level.length} tarea(s) disponibles simultáneamente demandan ${demand} unidad(es) de "${resourceId}", pero la capacidad es ${capacity}. Algunas deberán esperar.`,
            { resourceId, demand, capacity, taskIds: level },
          ),
        );
      }
    }
  }
  return warnings;
}

function normalizeCapacities(resourceCapacities) {
  if (!resourceCapacities) return new Map();
  if (resourceCapacities instanceof Map) return resourceCapacities;
  return new Map(Object.entries(resourceCapacities));
}
