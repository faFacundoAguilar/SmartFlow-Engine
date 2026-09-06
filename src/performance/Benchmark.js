import { DataGenerator } from '../data/DataGenerator.js';
import { PlanningEngine } from '../core/PlanningEngine.js';
import { Cache } from './Cache.js';

const datasetCache = new Cache(20);

/**
 * Ejecuta `PlanningEngine.optimize` sobre varios tamaños de dataset y
 * agrega estadísticas reales (min/max/media) sobre `executionTime`, que a su
 * vez viene de `performance.now()` dentro del propio motor — nunca se
 * inventan cifras aquí.
 *
 * El dataset de cada tamaño se genera UNA vez (con semilla fija) y se
 * reutiliza en las repeticiones: así medimos el coste del algoritmo, no el
 * coste de generar datos sintéticos distintos en cada repetición. `Cache`
 * evita regenerar el mismo dataset si se vuelve a pedir el mismo tamaño en
 * una ejecución posterior del benchmark dentro de la misma sesión.
 */
export const Benchmark = {
  run(sizes = [10, 100, 500, 1000, 5000], options = {}) {
    const { repeats = 3, seed = 42, maxConcurrency = 4, resourceCapacities = {} } = options;

    return sizes.map((size) => {
      const cacheKey = `${size}:${seed}`;
      let dataset = datasetCache.get(cacheKey);
      if (!dataset) {
        dataset = DataGenerator.generate(size, { seed });
        datasetCache.set(cacheKey, dataset);
      }

      const timings = [];
      let lastResult = null;
      for (let i = 0; i < repeats; i += 1) {
        lastResult = PlanningEngine.optimize(dataset, { maxConcurrency, resourceCapacities });
        timings.push(lastResult.executionTime);
      }

      return {
        size,
        repeats,
        meanMs: average(timings),
        minMs: Math.min(...timings),
        maxMs: Math.max(...timings),
        timings,
        scheduledTasks: lastResult.orderedTasks.length,
        blockedTasks: lastResult.blockedTasks.length,
      };
    });
  },
};

function average(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
