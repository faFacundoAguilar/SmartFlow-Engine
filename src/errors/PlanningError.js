/**
 * Catálogo cerrado de códigos de error del dominio.
 * Usar un objeto congelado en vez de strings sueltos evita typos silenciosos
 * ("RESOURCE_CONFLIT") que romperían un `switch` en tiempo de ejecución sin avisar.
 */
export const PlanningErrorCode = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  DUPLICATE_TASK: 'DUPLICATE_TASK',
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  TASK_DEPENDENCY_CYCLE: 'TASK_DEPENDENCY_CYCLE',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  DEADLINE_CONFLICT: 'DEADLINE_CONFLICT',
  BLOCKED_TASK: 'BLOCKED_TASK',
  OVERLOAD: 'OVERLOAD',
  IMPOSSIBLE_SCHEDULE: 'IMPOSSIBLE_SCHEDULE',
});

/**
 * Error de dominio para todo lo relacionado con planificación.
 * Lleva un `code` (del catálogo de arriba) y `metadata` con los datos
 * concretos que permiten reconstruir *por qué* falló, no solo *que* falló.
 *
 * Ejemplo: en vez de "Ciclo detectado", metadata.cyclePath = ['A', 'B', 'C', 'A']
 * permite a la UI dibujar exactamente el ciclo sobre el grafo.
 */
export class PlanningError extends Error {
  constructor(code, message, metadata = {}) {
    super(message);
    this.name = 'PlanningError';
    this.code = code;
    this.metadata = metadata;

    // Mantiene un stack trace limpio en motores V8 (Node/Chrome),
    // omitiendo el propio constructor de la traza.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PlanningError);
    }
  }

  /** Serialización segura para logs o para enviar por el EventBus. */
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, metadata: this.metadata };
  }
}
