import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanningEngine } from '../../src/core/PlanningEngine.js';

function rawTask(overrides = {}) {
  return {
    id: overrides.id ?? 't1',
    name: overrides.id ?? 't1',
    priority: 3,
    estimatedDuration: 10,
    difficulty: 3,
    importance: 3,
    urgency: 3,
    dependencies: [],
    ...overrides,
  };
}

test('PlanningEngine: genera una planificación válida que respeta el orden de dependencias', () => {
  const tasks = [rawTask({ id: 'A' }), rawTask({ id: 'B', dependencies: ['A'] }), rawTask({ id: 'C', dependencies: ['B'] })];

  const result = PlanningEngine.optimize(tasks, { maxConcurrency: 1 });
  const byId = Object.fromEntries(result.orderedTasks.map((t) => [t.taskId, t]));

  assert.equal(result.orderedTasks.length, 3);
  assert.equal(result.blockedTasks.length, 0);
  assert.equal(result.conflicts.length, 0);
  assert.ok(byId.B.startTime >= byId.A.endTime);
  assert.ok(byId.C.startTime >= byId.B.endTime);
  assert.ok(result.executionTime >= 0);
});

test('PlanningEngine: maneja tareas bloqueadas por un ciclo sin lanzar excepción', () => {
  const tasks = [
    rawTask({ id: 'A', dependencies: ['B'] }),
    rawTask({ id: 'B', dependencies: ['A'] }),
    rawTask({ id: 'C' }), // independiente, sí debe poder planificarse
  ];

  const result = PlanningEngine.optimize(tasks, {});

  assert.ok(result.blockedTasks.includes('A'));
  assert.ok(result.blockedTasks.includes('B'));
  assert.ok(result.orderedTasks.some((t) => t.taskId === 'C'));
  assert.ok(result.conflicts.length > 0);
});

test('PlanningEngine: respeta maxConcurrency (nunca hay más de N tareas solapadas)', () => {
  // 6 tareas totalmente independientes, sin recursos: solo el límite de concurrencia debe regular el paralelismo.
  const tasks = Array.from({ length: 6 }, (_, i) => rawTask({ id: `t${i}`, estimatedDuration: 10 }));

  const result = PlanningEngine.optimize(tasks, { maxConcurrency: 2 });

  for (const entry of result.orderedTasks) {
    assert.ok(entry.concurrentWith.length <= 1, `la tarea ${entry.taskId} se solapa con más de 1 (maxConcurrency=2)`);
  }
  assert.ok(result.metrics.peakConcurrency <= 2);
});

test('PlanningEngine: respeta la capacidad de recursos durante el scheduling', () => {
  const tasks = [
    rawTask({ id: 'A', resources: [{ id: 'gpu', amount: 1 }] }),
    rawTask({ id: 'B', resources: [{ id: 'gpu', amount: 1 }] }),
    rawTask({ id: 'C', resources: [{ id: 'gpu', amount: 1 }] }),
  ];

  const result = PlanningEngine.optimize(tasks, { maxConcurrency: 10, resourceCapacities: { gpu: 1 } });

  // Con capacidad 1, ninguna pareja debería solaparse aunque maxConcurrency lo permitiría.
  for (const entry of result.orderedTasks) {
    assert.equal(entry.concurrentWith.length, 0);
  }
});

test('PlanningEngine: procesa un dataset grande (1000 tareas encadenadas en grupos) sin errores', () => {
  const tasks = [];
  const groupSize = 5;
  for (let i = 0; i < 1000; i += 1) {
    const dependencies = i % groupSize === 0 ? [] : [`t${i - 1}`];
    tasks.push(rawTask({ id: `t${i}`, dependencies, estimatedDuration: 5 + (i % 7) }));
  }

  const result = PlanningEngine.optimize(tasks, { maxConcurrency: 8 });

  assert.equal(result.orderedTasks.length, 1000);
  assert.equal(result.blockedTasks.length, 0);
  assert.ok(result.executionTime < 5000, `tardó demasiado: ${result.executionTime}ms`);
});
