import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTask } from '../../src/models/Task.js';
import { DependencyGraph } from '../../src/core/DependencyGraph.js';

function makeTask(id, dependencies = []) {
  return createTask({
    id,
    name: id,
    priority: 3,
    estimatedDuration: 10,
    difficulty: 2,
    importance: 3,
    urgency: 3,
    dependencies,
  });
}

test('DependencyGraph: construye adyacencia y adyacencia inversa correctamente', () => {
  const tasks = [makeTask('A'), makeTask('B', ['A']), makeTask('C', ['B'])];
  const graph = DependencyGraph.build(tasks);

  assert.deepEqual([...graph.getDependencies('B')], ['A']);
  assert.deepEqual([...graph.getDependencies('A')], []);
  assert.deepEqual([...graph.getDependents('A')], ['B']);
  assert.deepEqual([...graph.getDependents('B')], ['C']);
});

test('DependencyGraph: detecta un ciclo simple A -> B -> C -> A', () => {
  const tasks = [makeTask('A', ['C']), makeTask('B', ['A']), makeTask('C', ['B'])];
  const graph = DependencyGraph.build(tasks);

  const { hasCycle, cycles } = graph.detectCycles();

  assert.equal(hasCycle, true);
  assert.equal(cycles.length, 1);
  // El ciclo reportado debe contener  los 3 nodos implicados.
  assert.deepEqual(new Set(cycles[0]), new Set(['A', 'B', 'C']));
});

test('DependencyGraph: un grafo acíclico no reporta ciclos', () => {
  const tasks = [makeTask('A'), makeTask('B', ['A']), makeTask('C', ['A', 'B'])];
  const graph = DependencyGraph.build(tasks);

  assert.equal(graph.detectCycles().hasCycle, false);
});

test('DependencyGraph: el ordenamiento topológico respeta las dependencias', () => {
  const tasks = [makeTask('C', ['B']), makeTask('A'), makeTask('B', ['A'])];
  const graph = DependencyGraph.build(tasks);

  const { order } = graph.topologicalSort();
  const position = Object.fromEntries(order.map((id, i) => [id, i]));

  assert.ok(position.A < position.B);
  assert.ok(position.B < position.C);
  assert.equal(order.length, 3);
});

test('DependencyGraph: topologicalSort lanza PlanningError si hay un ciclo', () => {
  const tasks = [makeTask('A', ['B']), makeTask('B', ['A'])];
  const graph = DependencyGraph.build(tasks);

  assert.throws(() => graph.topologicalSort(), /ciclo/i);
});

test('DependencyGraph: getAvailableTasks devuelve solo tareas con dependencias satisfechas', () => {
  const tasks = [makeTask('A'), makeTask('B', ['A']), makeTask('C', ['A']), makeTask('D', ['B', 'C'])];
  const graph = DependencyGraph.build(tasks);

  assert.deepEqual(graph.getAvailableTasks(new Set()), ['A']);
  assert.deepEqual(new Set(graph.getAvailableTasks(new Set(['A']))), new Set(['B', 'C']));
  assert.deepEqual(graph.getAvailableTasks(new Set(['A', 'B', 'C'])), ['D']);
  assert.deepEqual(graph.getAvailableTasks(new Set(['A', 'B', 'C', 'D'])), []);
});
