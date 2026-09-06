import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeFakeSelf() {
  const listeners = new Map();
  const posted = [];
  const fakeSelf = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    postMessage(data) {
      posted.push(data);
    },
    dispatch(data) {
      listeners.get('message')?.({ data });
    },
    posted,
  };
  return fakeSelf;
}

test('planningWorker: responde con el resultado de PlanningEngine.optimize para tareas válidas', async () => {
  const fakeSelf = makeFakeSelf();
  global.self = fakeSelf;

  await import('../../src/performance/planningWorker.js?t=' + Date.now());

  const tasks = [
    { id: 'A', name: 'A', priority: 3, estimatedDuration: 10, difficulty: 3, importance: 3, urgency: 3, dependencies: [] },
    { id: 'B', name: 'B', priority: 3, estimatedDuration: 10, difficulty: 3, importance: 3, urgency: 3, dependencies: ['A'] },
  ];

  fakeSelf.dispatch({ requestId: 1, tasks, constraints: { maxConcurrency: 2 } });

  assert.equal(fakeSelf.posted.length, 1);
  assert.equal(fakeSelf.posted[0].requestId, 1);
  assert.equal(fakeSelf.posted[0].ok, true);
  assert.equal(fakeSelf.posted[0].result.orderedTasks.length, 2);

  delete global.self;
});

test('planningWorker: responde con un error estructurado (no lanza) si las tareas son inválidas', async () => {
  const fakeSelf = makeFakeSelf();
  global.self = fakeSelf;

  await import('../../src/performance/planningWorker.js?t=' + Date.now());

  const invalidTasks = [{ id: 'A', name: 'A', dependencies: ['no-existe'], priority: 3, estimatedDuration: 10, difficulty: 3, importance: 3, urgency: 3 }];

  fakeSelf.dispatch({ requestId: 2, tasks: invalidTasks, constraints: {} });

  assert.equal(fakeSelf.posted[0].ok, false);
  assert.equal(fakeSelf.posted[0].error.code, 'INVALID_DEPENDENCY');

  delete global.self;
});
