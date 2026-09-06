/**
 * Cache LRU (Least Recently Used) genérica sobre un `Map`.
 *
 * Se aprovecha una propiedad poco conocida pero real de `Map`: itera en
 * orden de INSERCIÓN. Si al leer una clave la borramos y la reinsertamos,
 * queda "al final" — es decir, se convierte en la más recientemente usada
 * sin necesitar una lista doblemente enlazada aparte. Cuando se supera
 * `maxSize`, se elimina la primera clave del iterador (`keys().next()`),
 * que es, por construcción, la menos recientemente usada. O(1) amortizado
 * en get/set, sin estructuras adicionales.
 */
export class Cache {
  #store = new Map();
  #maxSize;

  constructor(maxSize = 100) {
    this.#maxSize = maxSize;
  }

  get size() {
    return this.#store.size;
  }

  has(key) {
    return this.#store.has(key);
  }

  get(key) {
    if (!this.#store.has(key)) return undefined;
    const value = this.#store.get(key);
    this.#store.delete(key);
    this.#store.set(key, value); // reinsertar = marcar como recién usada
    return value;
  }

  set(key, value) {
    if (this.#store.has(key)) this.#store.delete(key);
    this.#store.set(key, value);
    if (this.#store.size > this.#maxSize) {
      const oldestKey = this.#store.keys().next().value;
      this.#store.delete(oldestKey);
    }
  }

  clear() {
    this.#store.clear();
  }
}
