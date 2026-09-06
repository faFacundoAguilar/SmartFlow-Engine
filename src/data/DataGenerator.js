const DEFAULT_RESOURCE_POOL = ['cpu', 'gpu', 'network', 'database', 'design-team'];
const DEFAULT_CATEGORIES = ['backend', 'frontend', 'infra', 'qa', 'research', 'design'];

/**
 * Generador de números pseudoaleatorios con semilla (mulberry32).
 * Se usa en vez de Math.random() para que un mismo `seed` produzca SIEMPRE
 * el mismo dataset: eso hace que los benchmarks (Fase 8) sean reproducibles
 * y comparables entre ejecuciones, algo imposible con Math.random().
 */
function mulberry32(seed) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DataGenerator = {
  /**
   * Genera `size` tareas sintéticas en formato "crudo" (compatible con
   * `createTask`). Las dependencias solo pueden apuntar a tareas de índice
   * anterior: esto garantiza por CONSTRUCCIÓN que el dataset es un DAG
   * válido (nunca hay ciclos), lo cual es deliberado — para probar la
   * detección de ciclos se usan datasets manuales pequeños, no el generador
   * masivo, que existe para estresar el rendimiento del Optimizer, no la
   * detección de errores.
   */
  generate(size, options = {}) {
    const {
      seed = 42,
      dependencyProbability = 0.35,
      maxDependencies = 3,
      resourcePool = DEFAULT_RESOURCE_POOL,
      resourceProbability = 0.4,
      deadlineProbability = 0.5,
      minDuration = 5,
      maxDuration = 180,
      now = new Date(),
    } = options;

    const random = mulberry32(seed);
    const tasks = [];

    for (let i = 0; i < size; i += 1) {
      const id = `task_${i}`;
      const dependencies = [];

      if (i > 0 && random() < dependencyProbability) {
        const depCount = 1 + Math.floor(random() * maxDependencies);
        for (let d = 0; d < depCount; d += 1) {
          const candidateIndex = Math.floor(random() * i); // solo índices anteriores => sin ciclos
          const candidateId = `task_${candidateIndex}`;
          if (!dependencies.includes(candidateId)) dependencies.push(candidateId);
        }
      }

      const resources = [];
      if (random() < resourceProbability) {
        const resourceId = resourcePool[Math.floor(random() * resourcePool.length)];
        // Amount=2 es intencionadamente poco frecuente (20%): con la
        // capacidad por defecto de 1 (ver ConflictDetector/Optimizer), pedir
        // 2 unidades de un recurso sin capacidad configurada es imposible
        // por definición. Un 20% deja suficientes RESOURCE_CONFLICT reales
        // para ejercitar la detección sin que domine el dataset entero.
        resources.push({ id: resourceId, amount: random() < 0.2 ? 2 : 1 });
      }

      const hasDeadline = random() < deadlineProbability;
      const deadlineMinutesFromNow = hasDeadline ? Math.floor(random() * 60 * 24 * 5) : null; // hasta 5 días vista

      tasks.push({
        id,
        name: `Tarea ${i}`,
        description: '',
        priority: 1 + Math.floor(random() * 5),
        estimatedDuration: minDuration + Math.floor(random() * (maxDuration - minDuration)),
        deadline: hasDeadline ? new Date(now.getTime() + deadlineMinutesFromNow * 60_000).toISOString() : null,
        difficulty: 1 + Math.floor(random() * 5),
        category: DEFAULT_CATEGORIES[Math.floor(random() * DEFAULT_CATEGORIES.length)],
        dependencies,
        resources,
        status: 'pending',
        importance: 1 + Math.floor(random() * 5),
        urgency: 1 + Math.floor(random() * 5),
      });
    }

    return tasks;
  },
};
