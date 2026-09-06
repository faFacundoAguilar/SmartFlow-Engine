import { PriorityQueue } from '../utils/PriorityQueue.js';

/**
 * Núcleo de scheduling concurrente.
 *
 * DECISIÓN DE DISEÑO IMPORTANTE (fruto de una auditoría de rendimiento real,
 * no teórica): la primera versión de este módulo recalculaba, en CADA
 * evento de finalización, la lista completa de tareas disponibles
 * (`graph.getAvailableTasks(completed)`, O(V)) y reconstruía un heap desde
 * cero con ella. Con datasets grandes (5000 tareas) y concurrencia baja
 * (p. ej. maxConcurrency=4), la mayoría de las tareas quedan "disponibles"
 * casi de inmediato pero no se admiten hasta mucho después por falta de
 * huecos — así que esa lista de disponibles-pero-no-admitidas se
 * recalculaba y reordenaba miles de veces, degenerando en O(V²) real y
 * agotando memoria en la práctica (heap de V8 out-of-memory con 5000 tareas).
 *
 * La solución: un heap PERSISTENTE a lo largo de toda la ejecución, más
 * desbloqueo incremental por dependientes directos (idéntico al Kahn's de
 * DependencyGraph, pero aquí en tiempo de scheduling en vez de análisis
 * estático). Cada tarea entra al heap exactamente UNA vez, en el momento en
 * que sus dependencias se completan, con su score calculado en ESE
 * instante (no se recalcula mientras espera turno). Esto hace que el coste
 * total de mantenimiento del heap sea O(V log V) real a lo largo de toda la
 * ejecución, y el desbloqueo de dependientes O(E) total — de nuevo O(V log V + E).
 *
 * Efecto secundario aceptado y documentado: el score de una tarea se fija
 * en el momento en que queda disponible, no se re-evalúa continuamente
 * mientras espera en cola dentro de la MISMA ejecución de `optimize()`. Un
 * cambio de pesos SÍ sigue disparando un recálculo completo (nueva llamada
 * a `optimize()`), que es lo que pide el enunciado; lo que se descarta es
 * la re-evaluación continua de la urgencia por deadline mientras una tarea
 * ya lista espera su turno dentro del mismo cálculo, que era además la
 * causa real del problema de rendimiento.
 *
 * Sigue siendo una heurística GREEDY determinista, no un solver óptimo: el
 * scheduling con precedencia + recursos + concurrencia limitada es NP-hard
 * en general (variante de RCPSP).
 */
export class Optimizer {
  static runVirtual(schedulableTasks, graph, scoringEngine, constraints = {}) {
    const { maxConcurrency = Infinity, now = new Date() } = constraints;
    const capacities = normalizeCapacities(constraints.resourceCapacities);
    const tasksById = new Map(schedulableTasks.map((t) => [t.id, t]));
    const scheduleIds = new Set(tasksById.keys());

    const maxDuration = Math.max(1, ...schedulableTasks.map((t) => t.estimatedDuration));
    const directDependentsCount = new Map();
    for (const id of scheduleIds) directDependentsCount.set(id, graph.getDependents(id).size);
    const maxDependents = Math.max(1, ...directDependentsCount.values());

    const inDegree = buildInDegree(graph, scheduleIds);
    const completed = new Set();
    const running = new Map(); // id -> endTime
    const resourceUsed = new Map([...capacities.keys()].map((r) => [r, 0]));
    const scheduled = new Map();
    const heap = new PriorityQueue((a, b) => a.scoreValue - b.scoreValue);

    let clock = 0;
    let concurrencyAreaSum = 0;
    let peakConcurrency = 0;
    const resourceAreaSum = new Map([...capacities.keys()].map((r) => [r, 0]));
    let totalTime = 0;
    let newlyReady = [...scheduleIds].filter((id) => inDegree.get(id) === 0);

    while (completed.size < scheduleIds.size) {
      const virtualNow = new Date(now.getTime() + clock * 60_000);

      const admitted = selectAdmissible({
        heap,
        newlyReadyIds: newlyReady,
        tasksById,
        scoringEngine,
        buildContext: (id) => ({ now: virtualNow, maxDuration, maxDependents, dependentsCount: directDependentsCount.get(id) }),
        resourceUsed,
        capacities,
        availableSlots: maxConcurrency - running.size,
      });
      newlyReady = [];

      for (const { id, task, scoreValue } of admitted) {
        const startTime = clock;
        const endTime = clock + task.estimatedDuration;
        running.set(id, endTime);
        scheduled.set(id, { startTime, endTime, score: scoreValue });
      }

      peakConcurrency = Math.max(peakConcurrency, running.size);

      if (running.size === 0) break; // nada corre y nada más se pudo admitir: deadlock real (recurso imposible, etc).

      const nextTime = Math.min(...running.values());
      const intervalLength = nextTime - clock;
      concurrencyAreaSum += running.size * intervalLength;
      for (const [resourceId, used] of resourceUsed) {
        resourceAreaSum.set(resourceId, resourceAreaSum.get(resourceId) + used * intervalLength);
      }
      totalTime += intervalLength;

      const justCompleted = [];
      for (const [id, endTime] of [...running.entries()]) {
        if (endTime === nextTime) {
          running.delete(id);
          completed.add(id);
          releaseResources(tasksById.get(id), resourceUsed);
          justCompleted.push(id);
        }
      }
      clock = nextTime;
      newlyReady = unlockDependents(graph, scheduleIds, inDegree, justCompleted);
    }

    const blockedTasks = [...scheduleIds].filter((id) => !completed.has(id));
    const orderedTasks = buildOrderedTasksWithConcurrency(scheduled);

    const metrics = {
      makespan: clock,
      peakConcurrency,
      averageConcurrency: totalTime > 0 ? concurrencyAreaSum / totalTime : 0,
      concurrencyUtilization:
        Number.isFinite(maxConcurrency) && maxConcurrency > 0 && totalTime > 0
          ? concurrencyAreaSum / totalTime / maxConcurrency
          : null,
      resourceUtilization: Object.fromEntries(
        [...capacities.entries()].map(([resourceId, capacity]) => [
          resourceId,
          totalTime > 0 ? resourceAreaSum.get(resourceId) / (capacity * totalTime) : 0,
        ]),
      ),
    };

    return { orderedTasks, blockedTasks, metrics };
  }
}

/** In-degree restringido al subconjunto schedulable (las dependencias hacia tareas excluidas ya se filtraron antes de llegar aquí). */
function buildInDegree(graph, scheduleIds) {
  const inDegree = new Map();
  for (const id of scheduleIds) {
    let count = 0;
    for (const dep of graph.getDependencies(id)) {
      if (scheduleIds.has(dep)) count += 1;
    }
    inDegree.set(id, count);
  }
  return inDegree;
}

/** Decrementa el in-degree de los dependientes directos de las tareas recién completadas; O(grado), no O(V). */
function unlockDependents(graph, scheduleIds, inDegree, justCompletedIds) {
  const newlyReady = [];
  for (const id of justCompletedIds) {
    for (const dependent of graph.getDependents(id)) {
      if (!scheduleIds.has(dependent)) continue;
      const remaining = inDegree.get(dependent) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) newlyReady.push(dependent);
    }
  }
  return newlyReady;
}

/**
 * Admite tareas del heap PERSISTENTE respetando recursos y concurrencia.
 * Las recién disponibles (`newlyReadyIds`) se insertan con su score fijado
 * en este instante. Las que no caben por recursos se reinsertan al heap
 * (`deferred`) para reintentarse en el próximo evento — nunca se pierden.
 */
export function selectAdmissible({ heap, newlyReadyIds, tasksById, scoringEngine, buildContext, resourceUsed, capacities, availableSlots }) {
  for (const id of newlyReadyIds) {
    const task = tasksById.get(id);
    const { total } = scoringEngine.score(task, buildContext(id));
    heap.push({ id, task, scoreValue: total });
  }

  const admitted = [];
  const deferred = [];
  let slots = availableSlots;

  while (slots > 0 && !heap.isEmpty()) {
    const candidate = heap.pop();
    if (canAllocateResources(candidate.task, resourceUsed, capacities)) {
      allocateResources(candidate.task, resourceUsed, capacities);
      admitted.push(candidate);
      slots -= 1;
    } else {
      deferred.push(candidate);
    }
  }
  for (const d of deferred) heap.push(d);

  return admitted;
}

function canAllocateResources(task, resourceUsed, capacities) {
  for (const resource of task.resources) {
    const capacity = capacities.get(resource.id) ?? 1;
    const used = resourceUsed.get(resource.id) ?? 0;
    if (used + resource.amount > capacity) return false;
  }
  return true;
}

function allocateResources(task, resourceUsed, capacities) {
  for (const resource of task.resources) {
    if (!resourceUsed.has(resource.id)) resourceUsed.set(resource.id, 0);
    if (!capacities.has(resource.id)) capacities.set(resource.id, 1);
    resourceUsed.set(resource.id, resourceUsed.get(resource.id) + resource.amount);
  }
}

export function releaseResources(task, resourceUsed) {
  for (const resource of task.resources) {
    resourceUsed.set(resource.id, resourceUsed.get(resource.id) - resource.amount);
  }
}

/**
 * sweep-line para calcular `concurrentWith` sin comparar todos los pares:
 * el tamaño del conjunto "activo" está acotado por la concurrencia real
 * alcanzada, así que el coste es O(n · concurrenciaPico), no O(n²).
 */
function buildOrderedTasksWithConcurrency(scheduled) {
  const entries = [...scheduled.entries()].map(([id, data]) => ({ id, ...data, concurrentWith: new Set() }));
  entries.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));

  const events = [];
  for (const e of entries) {
    events.push({ time: e.startTime, type: 'start', entry: e });
    events.push({ time: e.endTime, type: 'end', entry: e });
  }
  events.sort((a, b) => a.time - b.time || (a.type === 'end' ? -1 : 1));

  const active = new Set();
  for (const event of events) {
    if (event.type === 'start') {
      for (const other of active) {
        event.entry.concurrentWith.add(other.id);
        other.concurrentWith.add(event.entry.id);
      }
      active.add(event.entry);
    } else {
      active.delete(event.entry);
    }
  }

  return entries.map((e) => ({
    taskId: e.id,
    startTime: e.startTime,
    endTime: e.endTime,
    score: e.score,
    concurrentWith: [...e.concurrentWith],
  }));
}

export function normalizeCapacities(resourceCapacities) {
  if (!resourceCapacities) return new Map();
  if (resourceCapacities instanceof Map) return new Map(resourceCapacities);
  return new Map(Object.entries(resourceCapacities));
}
