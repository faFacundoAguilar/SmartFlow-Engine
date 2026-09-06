import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Benchmark } from '../../src/performance/Benchmark.js';

test('Benchmark: devuelve una entrada por tamaño con timings reales (>= 0)', () => {
  const results = Benchmark.run([10, 50], { repeats: 2, seed: 1 });

  assert.equal(results.length, 2);
  for (const r of results) {
    assert.ok(r.meanMs >= 0);
    assert.equal(r.timings.length, 2);
    assert.ok(r.minMs <= r.meanMs && r.meanMs <= r.maxMs);
  }
});

test('Benchmark: un dataset mayor no debería ser drásticamente más lento que uno pequeño (sin blow-up cuadrático)', () => {
  const [small, large] = Benchmark.run([50, 1000], { repeats: 2, seed: 5, maxConcurrency: 4 });
  // Con la heurística O(V log V + E), 20x más tareas no debería traducirse en
  // un tiempo 100x mayor. Umbral generoso para no hacer el test frágil en CI.
  assert.ok(large.meanMs < small.meanMs * 100, `large=${large.meanMs}ms small=${small.meanMs}ms`);
});
