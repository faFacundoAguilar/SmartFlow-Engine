import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../../src/utils/PriorityQueue.js';

test('PriorityQueue: pop() siempre devuelve el elemento de mayor prioridad', () => {
  const pq = new PriorityQueue((a, b) => a - b);
  [5, 1, 9, 3, 7, 2].forEach((v) => pq.push(v));

  const output = [];
  while (!pq.isEmpty()) output.push(pq.pop());

  assert.deepEqual(output, [9, 7, 5, 3, 2, 1]);
});

test('PriorityQueue: peek() no elimina el elemento', () => {
  const pq = new PriorityQueue((a, b) => a - b);
  pq.push(10);
  pq.push(20);

  assert.equal(pq.peek(), 20);
  assert.equal(pq.size, 2);
});

test('PriorityQueue: funciona correctamente con inserciones y extracciones intercaladas', () => {
  const pq = new PriorityQueue((a, b) => a - b);
  pq.push(3);
  pq.push(1);
  assert.equal(pq.pop(), 3);
  pq.push(5);
  pq.push(2);
  assert.equal(pq.pop(), 5);
  assert.equal(pq.pop(), 2);
  assert.equal(pq.pop(), 1);
  assert.equal(pq.pop(), undefined);
});

test('PriorityQueue: mantiene el orden correcto con un volumen grande de elementos aleatorios', () => {
  const values = Array.from({ length: 2000 }, () => Math.floor(Math.random() * 100000));
  const pq = new PriorityQueue((a, b) => a - b);
  values.forEach((v) => pq.push(v));

  const output = [];
  while (!pq.isEmpty()) output.push(pq.pop());

  assert.deepEqual(output, [...values].sort((a, b) => b - a));
});
