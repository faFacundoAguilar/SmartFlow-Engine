/** Restringe `value` al rango [min, max]. Pura, sin efectos secundarios. */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Normaliza un valor de la escala de dominio 1-5 a 0-1, usada por priority/urgency/importance/difficulty. */
export function normalizeScale(value, min = 1, max = 5) {
  return clamp((value - min) / (max - min), 0, 1);
}

/** Escapa HTML al insertar texto proporcionado por el usuario (nombre, descripción) en el DOM vía innerHTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * Debounce: retrasa la ejecución hasta que pasen `wait` ms sin nuevas
 * llamadas. Uso real en la UI: mover un slider de pesos dispara un
 * recálculo completo del PlanningEngine en cada `input` event; sin
 * debounce, arrastrar el slider dispararía decenas de recálculos por
 * segundo. Con debounce, solo se recalcula cuando el usuario se detiene.
 */
export function debounce(fn, wait = 150) {
  let timeoutId;
  return function debounced(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle: garantiza como máximo una ejecución cada `limit` ms. Uso real:
 * los eventos SIMULATION_TASK_STARTED/COMPLETED pueden dispararse muy
 * seguido con datasets grandes; repintar la grilla de simulación en CADA
 * evento saturaría el hilo principal. Con throttle, se repinta a lo sumo a
 * ~60fps, y el último estado siempre queda reflejado (trailing call).
 */
export function throttle(fn, limit = 100) {
  let lastCall = 0;
  let timeoutId = null;
  let pendingArgs = null;

  const invoke = (context) => {
    lastCall = Date.now();
    timeoutId = null;
    fn.apply(context, pendingArgs);
  };

  return function throttled(...args) {
    pendingArgs = args;
    const remaining = limit - (Date.now() - lastCall);
    if (remaining <= 0) {
      clearTimeout(timeoutId);
      invoke(this);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => invoke(this), remaining);
    }
  };
}
