import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../../src/performance/Cache.js';

test('Cache: get/set básico', () => {
  const cache = new Cache(10);
  cache.set('a', 1);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('missing'), undefined);
});

test('Cache: desaloja la entrada menos recientemente usada al superar maxSize', () => {
  const cache = new Cache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.set('d', 4); // debería desalojar 'a' (la menos usada)

  assert.equal(cache.has('a'), false);
  assert.equal(cache.has('b'), true);
  assert.equal(cache.has('c'), true);
  assert.equal(cache.has('d'), true);
  assert.equal(cache.size, 3);
});

test('Cache: leer una entrada la marca como recientemente usada (no se desaloja primero)', () => {
  const cache = new Cache(3);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  cache.get('a'); // 'a' pasa a ser la más reciente
  cache.set('d', 4); // ahora debería desalojar 'b', no 'a'

  assert.equal(cache.has('a'), true);
  assert.equal(cache.has('b'), false);
});
