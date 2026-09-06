import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../../src/models/Task.js';
import { computeScore, ScoringEngine } from '../../src/core/ScoringEngine.js';

function makeTask(overrides = {}) {
  return createTask({
    id: 't1',
    name: 'Tarea',
    priority: 3,
    estimatedDuration: 30,
    difficulty: 3,
    importance: 3,
    urgency: 3,
    dependencies: [],
    ...overrides,
  });
}

test('computeScore: es una función pura (mismos inputs -> mismo output)', () => {
  const task = makeTask();
  const now = new Date('2026-01-01T00:00:00Z');
  const r1 = computeScore(task, { now, maxDuration: 60, maxDependents: 4, dependentsCount: 2 });
  const r2 = computeScore(task, { now, maxDuration: 60, maxDependents: 4, dependentsCount: 2 });
  assert.deepEqual(r1, r2);
});

test('computeScore: mayor prioridad produce mayor score, el resto igual', () => {
  const low = makeTask({ id: 'low', priority: 1 });
  const high = makeTask({ id: 'high', priority: 5 });
  const context = { now: new Date(), maxDuration: 60, maxDependents: 1, dependentsCount: 0 };

  const lowScore = computeScore(low, context).total;
  const highScore = computeScore(high, context).total;

  assert.ok(highScore > lowScore);
});

test('computeScore: una tarea vencida (overdue) recibe delayScore > 0 y deadlineScore = 0', () => {
  const task = makeTask({ deadline: '2025-01-01T00:00:00Z', estimatedDuration: 10 });
  const now = new Date('2025-01-02T00:00:00Z'); // un día después del deadline
  const { breakdown } = computeScore(task, { now, maxDuration: 60, maxDependents: 1, dependentsCount: 0 });

  assert.ok(breakdown.delayScore > 0);
  assert.equal(breakdown.deadlineScore, 0);
});

test('ScoringEngine: cambiar los pesos invalida la caché y cambia el resultado', () => {
  const engine = new ScoringEngine({ priority: 10 });
  const task = makeTask({ priority: 5 });
  const context = { now: new Date(), maxDuration: 60, maxDependents: 1, dependentsCount: 0 };

  const before = engine.score(task, context);
  assert.equal(before.fromCache, false);

  const cached = engine.score(task, context);
  assert.equal(cached.fromCache, true);
  assert.equal(cached.total, before.total);

  engine.updateWeights({ priority: 100 });
  const after = engine.score(task, context);

  assert.equal(after.fromCache, false); // la caché se invalidó
  assert.ok(after.total > before.total); // el peso más alto se refleja en el score
});

test('ScoringEngine: aumenta cacheStats.hits en llamadas repetidas dentro del mismo minuto', () => {
  const engine = new ScoringEngine();
  const task = makeTask();
  const now = new Date('2026-01-01T00:00:30Z');
  const context = { now, maxDuration: 60, maxDependents: 1, dependentsCount: 0 };

  engine.score(task, context);
  engine.score(task, context);
  engine.score(task, context);

  assert.equal(engine.cacheStats.hits, 2);
  assert.equal(engine.cacheStats.misses, 1);
});
