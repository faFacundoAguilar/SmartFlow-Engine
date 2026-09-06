import { PriorityQueue } from '../utils/PriorityQueue.js';
import { selectAdmissible, releaseResources, normalizeCapacities } from '../core/Optimizer.js';
import { EventType } from '../events/eventTypes.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ejecuta el plan de verdad: concurrencia real vía Promises (no una barra de
 * progreso que finge). Reutiliza `selectAdmissible` del Optimizer para que
 * la decisión de "qué admitir ahora" sea EXACTAMENTE la misma que calculó
 * PlanningEngine — la simulación no reinventa la estrategia de scheduling,
 * solo la ejecuta con tiempo real en vez de tiempo virtual.
 *
 * Patrón usado: "promise pool" — se mantiene un Map de promesas activas
 * (una por tarea en curso) y se usa `Promise.race` para reaccionar en cuanto
 * termina la PRIMERA, sin bloquear el hilo principal esperando a todas
 * (`Promise.all` fijo no serviría: el conjunto de tareas en curso cambia
 * dinámicamente conforme se liberan huecos de concurrencia).
 *
 * `speedFactor` acelera el reloj real para que la demo sea usable: con
 * speedFactor=60, una tarea de 10 "minutos" tarda 10/60 s ≈ 166ms reales.
 */
export class SimulationEngine {
  #eventBus;
  #speedFactor;

  constructor({ eventBus, speedFactor = 60 } = {}) {
    this.#eventBus = eventBus;
    this.#speedFactor = speedFactor;
  }

  async run(schedulableTasks, graph, scoringEngine, constraints = {}) {
    const { maxConcurrency = Infinity } = constraints;
    const capacities = normalizeCapacities(constraints.resourceCapacities);
    const tasksById = new Map(schedulableTasks.map((t) => [t.id, t]));
    const scheduleIds = new Set(tasksById.keys());

    const maxDuration = Math.max(1, ...schedulableTasks.map((t) => t.estimatedDuration));
    const directDependentsCount = new Map();
    for (const id of scheduleIds) directDependentsCount.set(id, graph.getDependents(id).size);
    const maxDependents = Math.max(1, ...directDependentsCount.values());

    // Mismo fix estructural que en Optimizer.runVirtual: in-degree +
    // desbloqueo incremental por dependientes, en vez de recomputar el
    // frente disponible completo (O(V)) en cada finalización. Con datasets
    // grandes y maxConcurrency bajo, esa recomputación repetida degeneraba
    // en O(V²) real (ver comentario extenso en Optimizer.js).
    const inDegree = new Map();
    for (const id of scheduleIds) {
      let count = 0;
      for (const dep of graph.getDependencies(id)) if (scheduleIds.has(dep)) count += 1;
      inDegree.set(id, count);
    }
    const heap = new PriorityQueue((a, b) => a.scoreValue - b.scoreValue);
    let newlyReady = [...scheduleIds].filter((id) => inDegree.get(id) === 0);

    const completed = new Set();
    const resourceUsed = new Map([...capacities.keys()].map((r) => [r, 0]));
    const activePromises = new Map(); // taskId -> Promise<taskId>
    const completionLog = [];

    const startedAt = Date.now();
    this.#emit(EventType.SIMULATION_STARTED, { totalTasks: scheduleIds.size, maxConcurrency });

    while (completed.size < scheduleIds.size) {
      const availableSlots = maxConcurrency - activePromises.size;

      if (availableSlots > 0) {
        const admitted = selectAdmissible({
          heap,
          newlyReadyIds: newlyReady,
          tasksById,
          scoringEngine,
          buildContext: (id) => ({ now: new Date(), maxDuration, maxDependents, dependentsCount: directDependentsCount.get(id) }),
          resourceUsed,
          capacities,
          availableSlots,
        });
        newlyReady = [];

        for (const { id, task, scoreValue } of admitted) {
          const durationMs = (task.estimatedDuration / this.#speedFactor) * 1000;
          this.#emit(EventType.SIMULATION_TASK_STARTED, { taskId: id, score: scoreValue, estimatedMs: durationMs });
          activePromises.set(id, sleep(durationMs).then(() => id));
        }
      }

      if (activePromises.size === 0) {
        // Deadlock real: nada corre y no se pudo admitir nada más (recurso imposible, etc).
        break;
      }

      // eslint-disable-next-line no-await-in-loop -- es intencional: es el propio bucle de eventos.
      const finishedId = await Promise.race(activePromises.values());
      activePromises.delete(finishedId);
      completed.add(finishedId);
      releaseResources(tasksById.get(finishedId), resourceUsed);

      for (const dependent of graph.getDependents(finishedId)) {
        if (!scheduleIds.has(dependent)) continue;
        const remaining = inDegree.get(dependent) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) newlyReady.push(dependent);
      }

      const progress = completed.size / scheduleIds.size;
      completionLog.push({ taskId: finishedId, elapsedMs: Date.now() - startedAt, progress });
      this.#emit(EventType.SIMULATION_TASK_COMPLETED, { taskId: finishedId, progress, remaining: scheduleIds.size - completed.size });
    }

    const blockedTasks = [...scheduleIds].filter((id) => !completed.has(id));
    const elapsedMs = Date.now() - startedAt;
    this.#emit(EventType.SIMULATION_FINISHED, { completedCount: completed.size, blockedTasks, elapsedMs });

    return { completionLog, blockedTasks, elapsedMs };
  }

  #emit(type, payload) {
    this.#eventBus?.emit(type, payload);
  }
}
