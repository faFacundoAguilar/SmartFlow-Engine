import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../../src/events/EventBus.js';

test('EventBus: emite a los listeners suscritos con el payload correcto', () => {
  const bus = new EventBus();
  const received = [];
  bus.on('PING', (event) => received.push(event.payload));

  bus.emit('PING', { value: 1 });
  bus.emit('PING', { value: 2 });

  assert.deepEqual(received, [{ value: 1 }, { value: 2 }]);
});

test('EventBus: off() detiene la entrega a ese listener', () => {
  const bus = new EventBus();
  let count = 0;
  const listener = () => (count += 1);

  bus.on('PING', listener);
  bus.emit('PING', {});
  bus.off('PING', listener);
  bus.emit('PING', {});

  assert.equal(count, 1);
});

test('EventBus: la función devuelta por on() desuscribe correctamente', () => {
  const bus = new EventBus();
  let count = 0;
  const unsubscribe = bus.on('PING', () => (count += 1));

  bus.emit('PING', {});
  unsubscribe();
  bus.emit('PING', {});

  assert.equal(count, 1);
});

test('EventBus: once() solo se ejecuta una vez', () => {
  const bus = new EventBus();
  let count = 0;
  bus.once('PING', () => (count += 1));

  bus.emit('PING', {});
  bus.emit('PING', {});

  assert.equal(count, 1);
});

test('EventBus: el canal comodín "*" recibe todos los eventos', () => {
  const bus = new EventBus();
  const seenTypes = [];
  bus.on('*', (event) => seenTypes.push(event.type));

  bus.emit('TASK_CREATED', {});
  bus.emit('TASK_COMPLETED', {});

  assert.deepEqual(seenTypes, ['TASK_CREATED', 'TASK_COMPLETED']);
});

test('EventBus: un listener que lanza un error no impide que otros reciban el evento', () => {
  const bus = new EventBus();
  let secondListenerRan = false;
  bus.on('PING', () => {
    throw new Error('listener roto');
  });
  bus.on('PING', () => {
    secondListenerRan = true;
  });

  assert.doesNotThrow(() => bus.emit('PING', {}));
  assert.equal(secondListenerRan, true);
});
