/**
 * Justificación de este Web Worker (punto 11 del brief, aplicado con
 * criterio, no "porque sí"): el benchmark real (ver Fase 8, Benchmark.js)
 * muestra que `PlanningEngine.optimize` tarda del orden de 100ms con 5000
 * tareas. 100ms bloqueando el hilo principal es suficiente para que la UI
 * se sienta "congelada" un instante (un frame a 60fps son ~16ms). Para
 * datasets pequeños (la mayoría de uso real) el coste de serializar
 * mensajes hacia/desde un worker sería MAYOR que el propio cálculo — por
 * eso la UI (`app.js`) solo delega aquí a partir de un umbral de tamaño, y
 * ejecuta el motor directamente en el hilo principal por debajo de él.
 *
 * El worker es una capa de transporte, no reimplementa nada: recibe
 * tareas + constraints ya serializables (JSON-friendly), llama al mismo
 * `PlanningEngine.optimize` que usa el resto de la aplicación, y devuelve
 * el resultado. Cero lógica de negocio duplicada.
 */
import { PlanningEngine } from '../core/PlanningEngine.js';

self.addEventListener('message', (event) => {
  const { requestId, tasks, constraints } = event.data;
  try {
    // Los pesos y capacidades viajan como objetos planos (JSON), no como
    // Map: el worker reconstruye lo que PlanningEngine espera.
    const result = PlanningEngine.optimize(tasks, constraints ?? {});
    self.postMessage({ requestId, ok: true, result });
  } catch (error) {
    self.postMessage({
      requestId,
      ok: false,
      error: { message: error.message, code: error.code ?? null, metadata: error.metadata ?? null },
    });
  }
});
