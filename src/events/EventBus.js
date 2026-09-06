/**
 * EventBus mínimo pero completo: on/off/emit/once, más un canal comodín '*'
 * para quien quiera loguear absolutamente todo (el Event Log de la UI, por
 * ejemplo) sin suscribirse evento por evento.
 *
 * Se usa `Map<eventType, Set<listener>>` en vez de arrays: Set evita
 * duplicados si el mismo listener se suscribe dos veces por error, y da
 * O(1) en `off`.
 *
 * Un error lanzado dentro de un listener NO debe tumbar a los demás
 * listeners ni al emisor: se captura y se re-emite como evento de error,
 * para que un bug en, por ejemplo, el Event Log de la UI no rompa el motor.
 */
export class EventBus {
  #listeners = new Map();

  on(eventType, listener) {
    if (!this.#listeners.has(eventType)) this.#listeners.set(eventType, new Set());
    this.#listeners.get(eventType).add(listener);
    return () => this.off(eventType, listener); // devuelve función de desuscripción, patrón cómodo para la UI
  }

  once(eventType, listener) {
    const unsubscribe = this.on(eventType, (payload) => {
      unsubscribe();
      listener(payload);
    });
    return unsubscribe;
  }

  off(eventType, listener) {
    this.#listeners.get(eventType)?.delete(listener);
  }

  emit(eventType, payload) {
    const event = { type: eventType, payload, timestamp: Date.now() };
    this.#dispatch(this.#listeners.get(eventType), event);
    this.#dispatch(this.#listeners.get('*'), event);
  }

  #dispatch(listenerSet, event) {
    if (!listenerSet) return;
    for (const listener of listenerSet) {
      try {
        listener(event);
      } catch (err) {
        // Evita que un listener roto silencie o tumbe el resto del sistema de eventos.
        console.error(`[EventBus] listener para "${event.type}" lanzó un error:`, err);
      }
    }
  }

  listenerCount(eventType) {
    return this.#listeners.get(eventType)?.size ?? 0;
  }
}
