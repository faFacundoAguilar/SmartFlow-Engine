import { clamp, normalizeScale } from '../utils/helpers.js';
import { minutesUntilDeadline } from '../utils/dateUtils.js';
import { Cache } from '../performance/Cache.js';

// Cota de la caché de scores: con el heap persistente del Optimizer, cada
// tarea se puntúa una única vez por ejecución de `optimize()`, así que en
// la práctica nunca se acerca a este límite. Existe como red de seguridad
// ante datasets muy grandes o usos del ScoringEngine fuera del Optimizer
// (p. ej. la UI recalculando scores para mostrarlos en el Optimizer view).
const MAX_CACHE_ENTRIES = 20_000;

/**
 * Pesos por defecto. Son puntos de partida razonables, no una fórmula sagrada:
 * el usuario los puede reconfigurar por completo desde la UI, y el motor
 * debe seguir siendo coherente con cualquier combinación (incluidos pesos en 0).
 */
export const DEFAULT_WEIGHTS = Object.freeze({
  priority: 20,
  urgency: 20,
  importance: 15,
  deadline: 20,
  delay: 25,
  dependencyImpact: 15,
  durationPenalty: 10,
  difficultyPenalty: 8,
});

// Horizonte de referencia para convertir "minutos hasta el deadline" en un
// factor 0-1: una semana. Es una elección de diseño explícita, documentada,
// no un número mágico sin justificar. Deadlines a más de una semana no suman
// urgencia adicional; deadlines vencidos hace más de una semana ya están en
// el máximo de "delay".
const DEADLINE_HORIZON_MINUTES = 7 * 24 * 60;

/**
 * Función PURA: mismos argumentos, mismo resultado, sin tocar nada externo.
 * Es la pieza que se testea exhaustivamente y la que se memoiza en ScoringEngine.
 *
 * `context` trae estadísticas del dataset completo (calculadas una sola vez
 * por ejecución de PlanningEngine, no por tarea):
 *  - maxDuration: la duración estimada más alta del dataset, para normalizar la penalización.
 *  - maxDependents: el máximo número de tareas que dependen de una sola tarea, para normalizar el impacto.
 *  - dependentsCount: cuántas tareas dependen directa o indirectamente de ESTA tarea.
 *  - now: instante de referencia para deadline/delay (inyectable para tests deterministas).
 */
export function computeScore(task, context = {}, weights = DEFAULT_WEIGHTS) {
  const { now = new Date(), maxDuration = task.estimatedDuration || 1, maxDependents = 1, dependentsCount = 0 } = context;

  const priorityScore = normalizeScale(task.priority) * weights.priority;
  const urgencyScore = normalizeScale(task.urgency) * weights.urgency;
  const importanceScore = normalizeScale(task.importance) * weights.importance;

  const remainingMinutes = minutesUntilDeadline(task, now);
  let deadlineScore = 0;
  let delayScore = 0;

  if (remainingMinutes !== null) {
    if (remainingMinutes >= 0) {
      // Cuanto más cerca el deadline, mayor la urgencia (0 lejos, 1 inminente/ahora).
      const urgencyFactor = clamp(1 - remainingMinutes / DEADLINE_HORIZON_MINUTES, 0, 1);
      deadlineScore = urgencyFactor * weights.deadline;
    } else {
      // Ya vencido: cuanto más tiempo lleva vencida, más peso de "delay" (hasta el horizonte).
      const overdueFactor = clamp(-remainingMinutes / DEADLINE_HORIZON_MINUTES, 0, 1);
      delayScore = overdueFactor * weights.delay;
    }
  }

  const impactFactor = maxDependents > 0 ? dependentsCount / maxDependents : 0;
  const dependencyImpactScore = impactFactor * weights.dependencyImpact;

  const durationPenalty = (task.estimatedDuration / maxDuration) * weights.durationPenalty;
  const difficultyPenalty = normalizeScale(task.difficulty) * weights.difficultyPenalty;

  const total =
    priorityScore + urgencyScore + importanceScore + deadlineScore + delayScore + dependencyImpactScore - durationPenalty - difficultyPenalty;

  return {
    total,
    breakdown: {
      priorityScore,
      urgencyScore,
      importanceScore,
      deadlineScore,
      delayScore,
      dependencyImpactScore,
      durationPenalty,
      difficultyPenalty,
    },
  };
}

/**
 * Envoltorio con estado que añade memoization sobre `computeScore`.
 *
 * La clave de caché incluye el minuto redondeado de `now`: el deadline/delay
 * no necesita precisión de milisegundo, así que memoizar con granularidad de
 * un minuto es seguro y multiplica el hit-rate en escenarios de recálculo
 * frecuente (p. ej. el usuario moviendo un slider de pesos repetidamente).
 *
 * Al cambiar los pesos con `updateWeights`, la caché se invalida por completo:
 * un cambio de pesos afecta al score de TODAS las tareas, así que una
 * invalidación parcial sería más compleja que la propia memoization sin
 * aportar ninguna ventaja real.
 */
export class ScoringEngine {
  #weights;
  #cache = new Cache(MAX_CACHE_ENTRIES);
  #stats = { hits: 0, misses: 0 };

  constructor(weights = {}) {
    this.#weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  get weights() {
    return { ...this.#weights };
  }

  get cacheStats() {
    return { ...this.#stats, size: this.#cache.size };
  }

  updateWeights(partialWeights) {
    this.#weights = { ...this.#weights, ...partialWeights };
    this.#cache.clear();
  }

  score(task, context = {}) {
    const cacheKey = this.#buildCacheKey(task, context);
    const cached = this.#cache.get(cacheKey);
    if (cached) {
      this.#stats.hits += 1;
      return { ...cached, fromCache: true };
    }
    this.#stats.misses += 1;
    const result = computeScore(task, context, this.#weights);
    this.#cache.set(cacheKey, result);
    return { ...result, fromCache: false };
  }

  #buildCacheKey(task, context) {
    const now = context.now ?? new Date();
    const roundedMinute = Math.floor(now.getTime() / 60_000);
    return [task.id, roundedMinute, context.maxDuration, context.maxDependents, context.dependentsCount].join('|');
  }
}
