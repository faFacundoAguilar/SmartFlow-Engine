import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../../src/models/Task.js';
import { DependencyGraph } from '../../src/core/DependencyGraph.js';
import { ScoringEngine } from '../../src/core/ScoringEngine.js';
import { SimulationEngine } from '../../src/simulation/SimulationEngine.js';
import { EventBus } from '../../src/events/EventBus.js';
import { EventType } from '../../src/events/eventTypes.js';

function makeTask(overrides = {}) {
  return createTask({
    id: overrides.id ?? 't1',
    name: overrides.id ?? 't1',
    priority: 3,
    estimatedDuration: 10,
    difficulty: 3,
    importance: 3,
    urgency: 3,
    dependencies: [],
    resources: [],
    ...overrides,
  });
}

test('SimulationEngine: ejecuta con concurrencia real y respeta el orden de dependencias', async () => {
  const tasks = [makeTask({ id: 'A' }), makeTask({ id: 'B', dependencies: ['A'] }), makeTask({ id: 'C' })];
  const graph = DependencyGraph.build(tasks);
  const scoringEngine = new ScoringEngine();
  const sim = new SimulationEngine({ speedFactor: 6000 }); // tareas de 10min -> 100ms reales

  const result = await sim.run(tasks, graph, scoringEngine, { maxConcurrency: 2 });

  const order = result.completionLog.map((e) => e.taskId);
  assert.ok(order.indexOf('A') < order.indexOf('B'));
  assert.equal(result.blockedTasks.length, 0);
  assert.equal(result.completionLog.length, 3);
});

test('SimulationEngine: nunca corren más de maxConcurrency tareas a la vez (concurrencia real medida por eventos)', async () => {
  const tasks = Array.from({ length: 5 }, (_, i) => makeTask({ id: `t${i}`, estimatedDuration: 10 }));
  const graph = DependencyGraph.build(tasks);
  const scoringEngine = new ScoringEngine();
  const eventBus = new EventBus();

  let currentlyRunning = 0;
  let peak = 0;
  eventBus.on(EventType.SIMULATION_TASK_STARTED, () => {
    currentlyRunning += 1;
    peak = Math.max(peak, currentlyRunning);
  });
  eventBus.on(EventType.SIMULATION_TASK_COMPLETED, () => {
    currentlyRunning -= 1;
  });

  const sim = new SimulationEngine({ eventBus, speedFactor: 6000 });
  await sim.run(tasks, graph, scoringEngine, { maxConcurrency: 2 });

  assert.ok(peak <= 2, `pico de concurrencia observado: ${peak}`);
});

test('SimulationEngine: reporta blockedTasks cuando un recurso es imposible, sin colgarse', async () => {
  const tasks = [makeTask({ id: 'A', resources: [{ id: 'gpu', amount: 5 }] })];
  const graph = DependencyGraph.build(tasks);
  const scoringEngine = new ScoringEngine();
  const sim = new SimulationEngine({ speedFactor: 6000 });

  const result = await sim.run(tasks, graph, scoringEngine, { resourceCapacities: { gpu: 1 } });

  assert.deepEqual(result.blockedTasks, ['A']);
});
