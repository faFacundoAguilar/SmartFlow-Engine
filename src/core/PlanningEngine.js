import { createTask } from '../models/Task.js';
import { validateTaskSet } from '../utils/validation.js';
import { DependencyGraph } from './DependencyGraph.js';
import { analyzeConflicts } from './ConflictDetector.js';
import { ScoringEngine } from './ScoringEngine.js';
import { Optimizer } from './Optimizer.js';
import { PlanningErrorCode } from '../errors/PlanningError.js';

/**
 * Punto de entrada público del motor. Deliberadamente NO es una clase con
 * estado propio: cada llamada a `optimize` es una función pura de principio
 * a fin dado (tasks, constraints) — esto hace que sea trivial de testear,
 * de cachear externamente, y de mover a un Web Worker en la Fase 8 sin
 * rediseñar nada (un worker solo puede recibir mensajes serializables y
 * devolver un resultado; una función pura encaja exactamente en ese modelo).
 *
 * El único estado que persiste entre llamadas es el opcional `scoringEngine`
 * que el caller puede reutilizar para aprovechar la memoization entre
 * recálculos sucesivos (p. ej. mientras el usuario mueve un slider de pesos).
 */
export const PlanningEngine = {
  /**
   * Fase de preparación compartida: validar, construir el grafo, detectar
   * conflictos y filtrar lo inejecutable. Se expone por separado (no solo
   * como parte interna de `optimize`) porque `SimulationEngine`, llamado
   * desde la UI, necesita EXACTAMENTE el mismo `schedulableTasks` + `graph`
   * que usó la planificación — recalcularlo de otra forma podría hacer que
   * la simulación "ejecute" tareas que el plan había descartado por
   * inejecutables, o al revés.
   */
  prepare(rawTasks, constraints = {}) {
    const tasks = rawTasks.map((t) => (isTask(t) ? t : createTask(t)));
    validateTaskSet(tasks);

    const graph = DependencyGraph.build(tasks);
    const { conflicts, warnings } = analyzeConflicts(tasks, graph, constraints);

    const unschedulableIds = collectUnschedulableIds(conflicts);
    const schedulableTasks = tasks.filter((t) => !unschedulableIds.has(t.id));
    const scoringEngine = constraints.scoringEngine ?? new ScoringEngine(constraints.weights);

    return { tasks, graph, conflicts, warnings, unschedulableIds, schedulableTasks, scoringEngine };
  },

  optimize(rawTasks, constraints = {}) {
    const startedAt = performance.now();

    const { tasks, graph, conflicts, warnings, unschedulableIds, schedulableTasks, scoringEngine } = PlanningEngine.prepare(
      rawTasks,
      constraints,
    );

    const { orderedTasks, blockedTasks: deadlockedIds, metrics: schedulingMetrics } = Optimizer.runVirtual(
      schedulableTasks,
      graph,
      scoringEngine,
      constraints,
    );

    const blockedTasks = [...new Set([...unschedulableIds, ...deadlockedIds])];
    const bottlenecks = extractBottlenecks(warnings);
    const score = computeOverallScore(orderedTasks, blockedTasks, tasks.length);

    const executionTime = performance.now() - startedAt;

    const result = {
      orderedTasks,
      blockedTasks,
      conflicts,
      bottlenecks,
      warnings,
      score,
      metrics: {
        ...schedulingMetrics,
        totalTasks: tasks.length,
        scheduledTasks: orderedTasks.length,
        blockedTaskCount: blockedTasks.length,
        conflictCount: conflicts.length,
        warningCount: warnings.length,
        cacheStats: scoringEngine.cacheStats,
      },
      executionTime,
    };

    constraints.eventBus?.emit('PLAN_RECALCULATED', result);

    return result;
  },
};

function isTask(candidate) {
  return Object.isFrozen(candidate) && typeof candidate === 'object' && Array.isArray(candidate.dependencies);
}

/** Ids que jamás pueden entrar al scheduler: forman parte de un ciclo, o dependen de uno. */
function collectUnschedulableIds(conflicts) {
  const ids = new Set();
  for (const conflict of conflicts) {
    if (conflict.code === PlanningErrorCode.TASK_DEPENDENCY_CYCLE) {
      conflict.metadata.cyclePath.forEach((id) => ids.add(id));
    }
    if (conflict.code === PlanningErrorCode.BLOCKED_TASK || conflict.code === PlanningErrorCode.RESOURCE_CONFLICT) {
      ids.add(conflict.metadata.taskId);
    }
  }
  return ids;
}

function extractBottlenecks(warnings) {
  const byResource = new Map();
  for (const warning of warnings) {
    if (warning.code !== PlanningErrorCode.OVERLOAD) continue;
    const { resourceId, demand, capacity } = warning.metadata;
    const existing = byResource.get(resourceId);
    if (!existing || demand - capacity > existing.excess) {
      byResource.set(resourceId, { resourceId, capacity, peakDemand: demand, excess: demand - capacity });
    }
  }
  return [...byResource.values()];
}

/**
 * Score global del plan: promedio del score de las tareas admitidas,
 * penalizado por la proporción de tareas bloqueadas (un plan con muchas
 * tareas inejecutables es un mal plan aunque las pocas admitidas tengan
 * scores individuales altos).
 */
function computeOverallScore(orderedTasks, blockedTasks, totalTaskCount) {
  if (orderedTasks.length === 0) return 0;
  const averageTaskScore = orderedTasks.reduce((sum, t) => sum + t.score, 0) / orderedTasks.length;
  const blockedRatio = totalTaskCount > 0 ? blockedTasks.length / totalTaskCount : 0;
  return averageTaskScore * (1 - blockedRatio);
}
