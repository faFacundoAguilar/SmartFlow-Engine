import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskRepository } from '../../src/data/TaskRepository.js';

function makeRepo() {
  // Sin `storage` explícito, TaskRepository usa su fallback en memoria (no hay localStorage en Node).
  return new TaskRepository({ namespace: `test_${Math.random()}` });
}

test('TaskRepository: saveAll + getAll conservan todas las tareas', () => {
  const repo = makeRepo();
  repo.saveAll([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);

  const all = repo.getAll();
  assert.equal(all.length, 2);
  assert.deepEqual(new Set(all.map((t) => t.id)), new Set(['a', 'b']));
});

test('TaskRepository: save() añade una tarea nueva sin duplicar el índice', () => {
  const repo = makeRepo();
  repo.saveAll([{ id: 'a', name: 'A' }]);
  repo.save({ id: 'b', name: 'B' });
  repo.save({ id: 'a', name: 'A actualizada' });

  const all = repo.getAll();
  assert.equal(all.length, 2);
  assert.equal(all.find((t) => t.id === 'a').name, 'A actualizada');
});

test('TaskRepository: delete() elimina la tarea y la saca del índice', () => {
  const repo = makeRepo();
  repo.saveAll([{ id: 'a' }, { id: 'b' }]);
  repo.delete('a');

  const all = repo.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'b');
});

test('TaskRepository: clear() vacía completamente el repositorio', () => {
  const repo = makeRepo();
  repo.saveAll([{ id: 'a' }, { id: 'b' }]);
  repo.clear();

  assert.deepEqual(repo.getAll(), []);
});
