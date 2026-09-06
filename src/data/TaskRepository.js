/**
 * Adaptador de memoria: se usa como fallback cuando `localStorage` no existe
 * (Node, tests, SSR) para que el Repository nunca falle por el entorno en el
 * que corre — simplemente no persiste entre procesos, lo cual es correcto:
 * no hay disco que persistir en ese contexto.
 */
class InMemoryStorageAdapter {
  #store = new Map();
  getItem(key) {
    return this.#store.has(key) ? this.#store.get(key) : null;
  }
  setItem(key, value) {
    this.#store.set(key, value);
  }
  removeItem(key) {
    this.#store.delete(key);
  }
}

/**
 * Única puerta de entrada a la persistencia local. Nadie en el resto de la
 * aplicación debe llamar a `localStorage` directamente — eso dispersaría el
 * formato de las claves y haría imposible cambiar de backend (p. ej. a
 * IndexedDB) sin tocar cada punto de la UI.
 *
 * Se eligió localStorage sobre IndexedDB: el volumen de datos (hasta miles
 * de tareas, cada una un objeto JSON pequeño) cabe cómodamente en los ~5MB
 * típicos de localStorage, y no necesitamos queries indexadas ni
 * transacciones — justo el escenario donde IndexedDB añadiría complejidad
 * sin aportar ninguna ventaja real.
 */
export class TaskRepository {
  #storage;
  #namespace;

  constructor({ storage, namespace = 'smartflow' } = {}) {
    this.#storage = storage ?? (typeof localStorage !== 'undefined' ? localStorage : new InMemoryStorageAdapter());
    this.#namespace = namespace;
  }

  #taskKey(id) {
    return `${this.#namespace}:task:${id}`;
  }

  #indexKey() {
    return `${this.#namespace}:index`;
  }

  #readIndex() {
    const raw = this.#storage.getItem(this.#indexKey());
    return raw ? JSON.parse(raw) : [];
  }

  #writeIndex(ids) {
    this.#storage.setItem(this.#indexKey(), JSON.stringify(ids));
  }

  /** Sobrescribe el dataset completo. Útil tras generar datos sintéticos o al abrir la app. */
  saveAll(tasks) {
    for (const task of tasks) {
      this.#storage.setItem(this.#taskKey(task.id), JSON.stringify(task));
    }
    this.#writeIndex(tasks.map((t) => t.id));
  }

  /** Guarda o actualiza una única tarea, manteniendo el índice consistente. */
  save(task) {
    this.#storage.setItem(this.#taskKey(task.id), JSON.stringify(task));
    const index = this.#readIndex();
    if (!index.includes(task.id)) {
      index.push(task.id);
      this.#writeIndex(index);
    }
  }

  getAll() {
    return this.#readIndex()
      .map((id) => {
        const raw = this.#storage.getItem(this.#taskKey(id));
        return raw ? JSON.parse(raw) : null;
      })
      .filter(Boolean);
  }

  delete(id) {
    this.#storage.removeItem(this.#taskKey(id));
    this.#writeIndex(this.#readIndex().filter((existingId) => existingId !== id));
  }

  clear() {
    for (const id of this.#readIndex()) {
      this.#storage.removeItem(this.#taskKey(id));
    }
    this.#writeIndex([]);
  }
}
