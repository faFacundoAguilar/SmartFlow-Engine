import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../../src/models/Task.js';
import { DependencyGraph } from '../../src/core/DependencyGraph.js';
import { analyzeConflicts } from '../../src/core/ConflictDetector.js';
import { PlanningErrorCode } from '../../src/errors/PlanningError.js';

function makeTask(overrides = {}) {
  return createTask({
    id: overrides.id ?? 't1',
    name: overrides.id ?? 't1',
    priority: 3,
    estimatedDuration: 30,
    difficulty: 3,
    importance: 3,
    urgency: 3,
    dependencies: [],
    ...overrides,
  });
}

test('ConflictDetector: reporta TASK_DEPENDENCY_CYCLE y BLOCKED_TASK para dependientes del ciclo', () => {
  const tasks = [
    makeTask({ id: 'A', dependencies: ['C'] }),
    makeTask({ id: 'B', dependencies: ['A'] }),
    makeTask({ id: 'C', dependencies: ['B'] }),
    makeTask({ id: 'D', dependencies: ['A'] }), // no está en el ciclo, pero depende de él
  ];
  const graph = DependencyGraph.build(tasks);
  const { conflicts } = analyzeConflicts(tasks, graph, {});

  const cycleConflicts = conflicts.filter((c) => c.code === PlanningErrorCode.TASK_DEPENDENCY_CYCLE);
  const blockedConflicts = conflicts.filter((c) => c.code === PlanningErrorCode.BLOCKED_TASK);
  const impossibleSchedule = conflicts.filter((c) => c.code === PlanningErrorCode.IMPOSSIBLE_SCHEDULE);

  assert.equal(cycleConflicts.length, 1);
  assert.ok(blockedConflicts.some((c) => c.metadata.taskId === 'D'));
  assert.equal(impossibleSchedule.length, 1);
});

test('ConflictDetector: detecta un deadline matemáticamente imposible dada la cadena de dependencias', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const tasks = [
    makeTask({ id: 'A', estimatedDuration: 100 }),
    // B depende de A (100 min) y dura 100 min más => earliest finish = 200 min,
    // pero su deadline es en solo 60 minutillos desde `now`: imposible.
    makeTask({ id: 'B', dependencies: ['A'], estimatedDuration: 100, deadline: new Date(now.getTime() + 60 * 60_000) }),
  ];
  const graph = DependencyGraph.build(tasks);
  const { conflicts } = analyzeConflicts(tasks, graph, { now });

  const deadlineConflicts = conflicts.filter((c) => c.code === PlanningErrorCode.DEADLINE_CONFLICT);
  assert.equal(deadlineConflicts.length, 1);
  assert.equal(deadlineConflicts[0].metadata.taskId, 'B');
});

test('ConflictDetector: NO reporta conflicto de deadline cuando sí es alcanzable', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const tasks = [makeTask({ id: 'A', estimatedDuration: 10, deadline: new Date(now.getTime() + 60 * 60_000) })];
  const graph = DependencyGraph.build(tasks);
  const { conflicts } = analyzeConflicts(tasks, graph, { now });

  assert.equal(conflicts.filter((c) => c.code === PlanningErrorCode.DEADLINE_CONFLICT).length, 0);
});

test('ConflictDetector: detecta RESOURCE_CONFLICT cuando una tarea pide más de la capacidad total', () => {
  const tasks = [makeTask({ id: 'A', resources: [{ id: 'gpu', amount: 5 }] })];
  const graph = DependencyGraph.build(tasks);
  const { conflicts } = analyzeConflicts(tasks, graph, { resourceCapacities: { gpu: 2 } });

  const resourceConflicts = conflicts.filter((c) => c.code === PlanningErrorCode.RESOURCE_CONFLICT);
  assert.equal(resourceConflicts.length, 1);
  assert.equal(resourceConflicts[0].metadata.resourceId, 'gpu');
});

test('ConflictDetector: reporta OVERLOAD (warning) cuando tareas independientes exceden la capacidad conjunta', () => {
  const tasks = [
    makeTask({ id: 'A', resources: [{ id: 'gpu', amount: 2 }] }),
    makeTask({ id: 'B', resources: [{ id: 'gpu', amount: 2 }] }),
  ];
  const graph = DependencyGraph.build(tasks);
  const { warnings } = analyzeConflicts(tasks, graph, { resourceCapacities: { gpu: 2 } });

  assert.ok(warnings.some((w) => w.code === PlanningErrorCode.OVERLOAD));
});
