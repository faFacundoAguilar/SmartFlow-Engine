import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataGenerator } from '../../src/data/DataGenerator.js';
import { createTask } from '../../src/models/Task.js';
import { DependencyGraph } from '../../src/core/DependencyGraph.js';

test('DataGenerator: genera exactamente el tamaño pedido', () => {
  const dataset = DataGenerator.generate(250, { seed: 1 });
  assert.equal(dataset.length, 250);
});

test('DataGenerator: la misma semilla (y el mismo `now`) produce siempre el mismo dataset', () => {
  // `now` se fija explícitamente: por defecto es `new Date()`, que varía de
  // una llamada a otra en milisegundos y afectaría a los deadlines
  // generados. Eso es correcto (cada ejecución real ocurre en un instante
  // distinto) pero para probar la reproducibilidad de la SEMILLA hay que
  // controlar también el reloj.
  const now = new Date('2026-01-01T00:00:00Z');
  const a = DataGenerator.generate(100, { seed: 7, now });
  const b = DataGenerator.generate(100, { seed: 7, now });
  assert.deepEqual(a, b);
});

test('DataGenerator: semillas distintas producen datasets distintos', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const a = DataGenerator.generate(100, { seed: 7, now });
  const b = DataGenerator.generate(100, { seed: 8, now });
  assert.notDeepEqual(a, b);
});

test('DataGenerator: el dataset generado nunca contiene ciclos (por construcción)', () => {
  const raw = DataGenerator.generate(500, { seed: 3, dependencyProbability: 0.6, maxDependencies: 4 });
  const tasks = raw.map((t) => createTask(t));
  const graph = DependencyGraph.build(tasks);

  assert.equal(graph.detectCycles().hasCycle, false);
});

test('DataGenerator: cada tarea generada es válida según las reglas de Task', () => {
  const raw = DataGenerator.generate(50, { seed: 9 });
  assert.doesNotThrow(() => raw.forEach((t) => createTask(t)));
});
