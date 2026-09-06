import { PlanningError, PlanningErrorCode } from '../errors/PlanningError.js';

/**
 * Modela las tareas como un grafo dirigido: una arista de A hacia B significa
 * "A depende de B" (B debe completarse antes que A).
 *
 * Se mantienen DOS mapas de adyacencia a propósito:
 *  - #adjacency:  id -> Set(de qué depende)     (para recorrer "hacia atrás", detectar ciclos)
 *  - #dependents: id -> Set(quién depende de él) (para saber, al completar una tarea,
 *                                                  a quién puede desbloquear — O(1) en vez
 *                                                  de recorrer todas las tareas buscando).
 * Mantener ambos duplica memoria (O(E) extra) a cambio de que las dos operaciones
 * más frecuentes del motor (avanzar el grafo, y comprobar disponibilidad) sean O(1)/O(grado).
 */
export class DependencyGraph {
  #adjacency = new Map();
  #dependents = new Map();
  #taskIds;

  static build(tasks) {
    return new DependencyGraph(tasks);
  }

  constructor(tasks) {
    this.#taskIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      this.#adjacency.set(task.id, new Set(task.dependencies));
      if (!this.#dependents.has(task.id)) this.#dependents.set(task.id, new Set());
    }
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!this.#dependents.has(depId)) this.#dependents.set(depId, new Set());
        this.#dependents.get(depId).add(task.id);
      }
    }
  }

  get taskIds() {
    return this.#taskIds;
  }

  getDependencies(id) {
    return this.#adjacency.get(id) ?? new Set();
  }

  getDependents(id) {
    return this.#dependents.get(id) ?? new Set();
  }

  /**
   * Detección de ciclos mediante DFS con coloreado de nodos (WHITE/GRAY/BLACK).
   *
   * Implementación ITERATIVA (pila explícita), no recursiva: con datasets de
   * hasta 5000 tareas potencialmente encadenadas, una versión recursiva
   * arriesgaría un stack overflow en V8. Complejidad: O(V + E).
   *
   * Cuando se encuentra una arista hacia un nodo GRAY (en el camino actual),
   * se reconstruye el ciclo completo a partir del `path` que se va arrastrando,
   * en vez de limitarse a decir "hay un ciclo" — eso es lo que permite que
   * ConflictDetector reporte metadata.cyclePath útil para la UI.
   */
  detectCycles() {
    const color = new Map();
    for (const id of this.#taskIds) color.set(id, 'WHITE');
    const cycles = [];

    for (const startId of this.#taskIds) {
      if (color.get(startId) !== 'WHITE') continue;

      const stack = [{ id: startId, iterator: this.getDependencies(startId).values() }];
      const path = [startId];
      color.set(startId, 'GRAY');

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const next = frame.iterator.next();

        if (next.done) {
          color.set(frame.id, 'BLACK');
          stack.pop();
          path.pop();
          continue;
        }

        const neighbor = next.value;
        const neighborColor = color.get(neighbor);

        if (neighborColor === 'GRAY') {
          const cycleStart = path.indexOf(neighbor);
          cycles.push([...path.slice(cycleStart), neighbor]);
        } else if (neighborColor === 'WHITE') {
          color.set(neighbor, 'GRAY');
          path.push(neighbor);
          stack.push({ id: neighbor, iterator: this.getDependencies(neighbor).values() });
        }
        // Si es BLACK: ese subgrafo ya se exploró por otro camino sin ciclos. Se ignora.
      }
    }

    return { hasCycle: cycles.length > 0, cycles };
  }

  /**
   * Ordenamiento topológico por niveles (Kahn's algorithm, basado en BFS por
   * grados de entrada). Se elige Kahn's en vez de la variante DFS+stack porque
   * produce de forma natural los "niveles" (oleadas de tareas que se
   * desbloquean juntas), que es exactamente la estructura que necesita el
   * Optimizer para razonar sobre concurrencia. Complejidad: O(V + E).
   *
   * Lanza PlanningError(TASK_DEPENDENCY_CYCLE) si quedan tareas sin poder
   * ordenar — nunca devuelve un orden parcial de forma silenciosa.
   */
  topologicalSort() {
    const inDegree = new Map();
    for (const id of this.#taskIds) inDegree.set(id, this.getDependencies(id).size);

    let frontier = [...this.#taskIds].filter((id) => inDegree.get(id) === 0);
    const order = [];
    const levels = [];
    const remaining = new Set(this.#taskIds);

    while (frontier.length > 0) {
      levels.push([...frontier]);
      const nextFrontier = [];
      for (const id of frontier) {
        order.push(id);
        remaining.delete(id);
        for (const dependent of this.getDependents(id)) {
          const updated = inDegree.get(dependent) - 1;
          inDegree.set(dependent, updated);
          if (updated === 0) nextFrontier.push(dependent);
        }
      }
      frontier = nextFrontier;
    }

    if (remaining.size > 0) {
      throw new PlanningError(
        PlanningErrorCode.TASK_DEPENDENCY_CYCLE,
        `No se puede ordenar topológicamente: ${remaining.size} tarea(s) permanecen en un ciclo.`,
        { remainingTaskIds: [...remaining] },
      );
    }

    return { order, levels };
  }

  /**
   * Tareas cuyas dependencias están TODAS en `completedIds`, y que no están
   * ya completadas. Se usa en cada paso del Optimizer para recalcular el
   * frente disponible conforme avanza la ejecución concurrente.
   */
  getAvailableTasks(completedIds) {
    const completed = completedIds instanceof Set ? completedIds : new Set(completedIds);
    const available = [];
    for (const id of this.#taskIds) {
      if (completed.has(id)) continue;
      let ready = true;
      for (const dep of this.getDependencies(id)) {
        if (!completed.has(dep)) {
          ready = false;
          break;
        }
      }
      if (ready) available.push(id);
    }
    return available;
  }
}
