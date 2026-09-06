/**
 * Binary heap genérica (max-heap por defecto: el elemento con mayor
 * `compare(a, b) > 0` sale primero).
 *
 * Por qué existe: en el Optimizer, en cada evento de finalización de tarea
 * hay que preguntar repetidamente "¿cuál es la tarea disponible con mayor
 * score?" mientras se van admitiendo o descartando candidatas. Reordenar un
 * array completo con `.sort()` en cada uno de esos eventos es O(n log n) por
 * evento; con un heap, extraer el máximo es O(log n) y reinsertar también,
 * lo que mantiene el coste total del scheduling en O(V log V) en vez de
 * O(V² log V) para datasets grandes (hasta 5000 tareas).
 *
 * Se implementa sobre un array plano (representación clásica de heap:
 * hijos de i están en 2i+1 y 2i+2) en vez de con nodos enlazados, para
 * evitar overhead de punteros y mejorar la localidad de caché.
 */
export class PriorityQueue {
  #items = [];
  #compare;

  constructor(compareFn) {
    // compareFn(a, b) > 0  =>  a tiene más prioridad que b
    this.#compare = compareFn;
  }

  get size() {
    return this.#items.length;
  }

  isEmpty() {
    return this.#items.length === 0;
  }

  peek() {
    return this.#items[0];
  }

  push(item) {
    this.#items.push(item);
    this.#bubbleUp(this.#items.length - 1);
  }

  pop() {
    if (this.#items.length === 0) return undefined;
    const top = this.#items[0];
    const last = this.#items.pop();
    if (this.#items.length > 0) {
      this.#items[0] = last;
      this.#bubbleDown(0);
    }
    return top;
  }

  #bubbleUp(index) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#compare(this.#items[i], this.#items[parent]) > 0) {
        this.#swap(i, parent);
        i = parent;
      } else break;
    }
  }

  #bubbleDown(index) {
    let i = index;
    const n = this.#items.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let largest = i;
      if (left < n && this.#compare(this.#items[left], this.#items[largest]) > 0) largest = left;
      if (right < n && this.#compare(this.#items[right], this.#items[largest]) > 0) largest = right;
      if (largest === i) break;
      this.#swap(i, largest);
      i = largest;
    }
  }

  #swap(i, j) {
    [this.#items[i], this.#items[j]] = [this.#items[j], this.#items[i]];
  }
}
