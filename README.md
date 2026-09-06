# SmartFlow Engine

Aplicación web desarrollada con JavaScript moderno que implementa un motor algorítmico de planificación basado en grafos, scoring dinámico, detección de conflictos, optimización de tareas con concurrencia real, arquitectura orientada a eventos, persistencia local, simulación y benchmarking.

El gestor de tareas es solo la interfaz. El proyecto real es el motor: `src/core/`.

## 1. Qué es

Dado un conjunto de tareas con dependencias, recursos, prioridades y deadlines, SmartFlow Engine calcula automáticamente **qué tareas pueden ejecutarse en paralelo, en qué orden, y con qué prioridad**, detectando de antemano cualquier situación que haga el plan inviable (ciclos, deadlines imposibles, recursos insuficientes).

## 2. Problema que resuelve

No es un TODO-list. El problema real es una variante de **RCPSP (Resource-Constrained Project Scheduling Problem)**: planificar tareas con precedencia (grafo dirigido), recursos limitados y un límite de concurrencia, maximizando un score configurable. Este problema es NP-hard en el caso general — el motor usa una heurística greedy determinista, no un solver exacto, y lo documenta como tal en el propio código en vez de fingir optimalidad.

## 3. Arquitectura

```
/src
  /core           PlanningEngine, DependencyGraph, ScoringEngine, ConflictDetector, Optimizer
  /models         Task (factory inmutable)
  /events         EventBus + catálogo de eventos
  /simulation     SimulationEngine (reloj real, Promises)
  /data           TaskRepository (persistencia) + DataGenerator (datasets sintéticos)
  /performance    Cache (LRU genérica), Benchmark, planningWorker (Web Worker)
  /errors         PlanningError + catálogo de códigos
  /utils          validation, dateUtils, helpers (debounce/throttle/escapeHtml), PriorityQueue
  /ui             Dashboard, TaskManager, GraphView, OptimizerView, SimulationView,
                  PerformanceView, EventLogView, styles.css
  app.js          orquestador de la UI (estado + wiring)
/tests            51 tests (node:test), un test por módulo del núcleo
/scripts          verify-ui.mjs — smoke test de la UI completa con jsdom
index.html
```

**Regla de dependencia respetada en todo el proyecto:** la UI importa el motor; el motor nunca importa nada de `/ui`. `PlanningEngine.optimize()` es una función pura de principio a fin — mismos `(tasks, constraints)`, mismo resultado — lo que la hace trivial de testear, cachear y (a partir de cierto tamaño) delegar a un Web Worker sin rediseñar nada.

## 4. Algoritmos utilizados

- **DFS iterativo con coloreado de nodos** (WHITE/GRAY/BLACK) para detectar ciclos, reconstruyendo el camino exacto — no solo "existe un ciclo". Iterativo (pila explícita) a propósito: con miles de tareas encadenadas, una versión recursiva arriesgaría un stack overflow.
- **Kahn's algorithm** (BFS por grados de entrada) para el ordenamiento topológico, elegido sobre la variante DFS porque produce "niveles" (oleadas de tareas que se desbloquean juntas), la estructura que necesitan tanto `ConflictDetector` (sobrecarga de recursos) como `GraphView` (layout por columnas).
- **Earliest-finish-time (estilo CPM)** para detectar deadlines matemáticamente imposibles: calcula la cota inferior real del mejor caso (concurrencia ilimitada) y la compara contra el tiempo disponible.
- **Scheduling greedy con heap persistente**: cada tarea entra a una cola de prioridad (binary heap) exactamente una vez, en el instante en que sus dependencias se completan, con su score fijado en ese momento. La admisión aplica, en orden estricto: dependencias → recursos → concurrencia (`maxConcurrency`) → score.
- **Sweep-line** para calcular qué tareas se solaparon en el tiempo (`concurrentWith`), en vez de comparar todos los pares.
- **Mulberry32** (PRNG con semilla) en `DataGenerator`, para que los benchmarks sean reproducibles.

## 5. Complejidad temporal

| Operación | Complejidad |
|---|---|
| Construcción del grafo | O(V + E) |
| Detección de ciclos | O(V + E) |
| Ordenamiento topológico | O(V + E) |
| Earliest-finish (deadlines) | O(V + E) |
| Optimizer (scheduling completo) | O(V log V + E) |
| `concurrentWith` (sweep-line) | O(V · concurrencia pico), no O(V²) |

**Nota de auditoría honesta:** la primera implementación del Optimizer recalculaba el frente de tareas disponibles completo en cada evento de finalización (O(V) por evento), degenerando en O(V²) real y agotando memoria con 5000 tareas. Se corrigió con un heap persistente + desbloqueo incremental por dependientes (ver comentario extenso en `Optimizer.js`). Esto no es una nota académica: fue un bug real, detectado ejecutando el benchmark, no una limitación teórica anticipada de antemano.

## 6. Gestión de dependencias

Las tareas se modelan como un grafo dirigido (`A → B` significa "A depende de B"). `DependencyGraph` mantiene adyacencia directa e inversa (`Map<id, Set<id>>`) para que tanto "de qué depende" como "a quién desbloqueo" sean O(1)/O(grado). Un ciclo se reporta con el camino exacto (`metadata.cyclePath`), y cualquier tarea que dependa transitivamente de una tarea inejecutable (cíclica o con un recurso imposible) se marca `BLOCKED_TASK` — nunca se descubre el bloqueo "por accidente" durante el scheduling.

## 7. Sistema de scoring

`ScoringEngine.score(task, context)` es una envoltura con memoization sobre `computeScore()`, una función pura. El score combina, de forma configurable (pesos 0-50 desde la UI):

```
score = priority + urgency + importance + deadlineUrgency + delay + dependencyImpact
        − durationPenalty − difficultyPenalty
```

`dependencyImpact` usa el número de **dependientes directos** (no el cierre transitivo completo): calcular el impacto transitivo real de cada tarea sería O(V·(V+E)) en el peor caso, inaceptable a 5000 tareas. Es una simplificación deliberada y documentada, no un descuido.

La caché de `ScoringEngine` se invalida por completo al cambiar los pesos (`updateWeights`), porque un cambio de pesos afecta a todos los scores — una invalidación parcial sería más compleja que la propia caché sin aportar nada.

## 8. Optimización (scheduling concurrente)

`Optimizer.runVirtual` y `SimulationEngine.run` comparten la misma función de decisión (`selectAdmissible`): nunca hay dos implementaciones divergentes de "qué se admite ahora". El primero usa un reloj **virtual** (salta directo al siguiente evento de finalización, cálculo síncrono e instantáneo — así es como PlanningEngine produce un plan de 5000 tareas en ~90ms). El segundo usa un reloj **real** vía `Promise.race` sobre un pool de promesas activas, para que la simulación sea concurrencia de verdad, no una barra de progreso que finge.

## 9. Performance

Benchmark real (`Benchmark.run`, `performance.now()`, media de 5 repeticiones, `maxConcurrency=4`, dataset sintético con semilla fija):

| Tamaño | Media | Min | Max |
|---|---|---|---|
| 10 | 3.07ms | 0.38ms | 11.94ms |
| 50 | 1.50ms | 1.23ms | 1.96ms |
| 100 | 4.07ms | 2.80ms | 5.90ms |
| 500 | 22.39ms | 10.97ms | 40.28ms |
| 1000 | 40.11ms | 24.41ms | 64.50ms |
| 5000 | 91.74ms | 69.51ms | 140.92ms |

500x más tareas (10 → 5000) cuesta ~30x más tiempo, consistente con la complejidad O(V log V + E) reclamada, no con un blow-up cuadrático.

**Web Worker** (`planningWorker.js`): la UI delega `optimize()` a un worker a partir de 500 tareas (`WORKER_THRESHOLD` en `app.js`). Justificación real, no decorativa: 100ms bloqueando el hilo principal es perceptible (un frame a 60fps son ~16ms); por debajo del umbral, el coste de mensajería del worker superaría al del propio cálculo, así que ahí se ejecuta directo en el hilo principal.

**Cache LRU** (`performance/Cache.js`): usada por `ScoringEngine` (con cota de 20.000 entradas, red de seguridad — en la práctica nunca se acerca a ese límite gracias al heap persistente) y por `Benchmark` (evita regenerar el mismo dataset sintético entre repeticiones).

## 10. Testing

51 tests (`node --test`), sin mocks artificiales — cada test intenta encontrar un error real:

- `DependencyGraph`: construcción, ciclos, orden topológico, disponibilidad incremental.
- `ScoringEngine`: pureza, orden por prioridad, invalidación de caché al cambiar pesos.
- `ConflictDetector`: ciclos, deadlines imposibles (con cadena de dependencias), recursos imposibles, sobrecarga.
- `PlanningEngine`: plan válido, tareas bloqueadas, respeto de `maxConcurrency` y de capacidad de recursos, dataset de 1000 tareas.
- `Optimizer` / `SimulationEngine`: concurrencia real medida por eventos, deadlock por recurso imposible sin colgarse.
- `EventBus`, `TaskRepository`, `DataGenerator`, `PriorityQueue`, `Cache`, `Benchmark`, `planningWorker`.

Adicionalmente, `scripts/verify-ui.mjs` carga `index.html` + `app.js` con jsdom (inyectando sus globals y usando el loader real de ES modules de Node, ya que jsdom no ejecuta `<script type="module">`) y simula clicks reales por las 7 vistas, incluyendo ejecutar una simulación real y un benchmark. 21 comprobaciones, todas en verde.

```bash
npm test         # suite unitaria (node --test)
npm run verify-ui  # smoke test de la UI completa
```

## 11. Decisiones técnicas relevantes

- **Task como factory inmutable, no clase**: no tiene comportamiento propio dependiente de su estado interno — es un registro de datos. `Object.freeze` (incluyendo arrays internos) evita mutaciones accidentales aguas abajo del pipeline.
- **localStorage sobre IndexedDB**: el volumen (miles de tareas, JSON pequeño) cabe cómodo en localStorage; no hay queries indexadas ni transacciones que justifiquen IndexedDB.
- **Impacto de dependientes directo, no transitivo** (ver §7): coste vs. beneficio explícito.
- **Heap persistente, no heap-por-evento** (ver §5): fruto de una auditoría real de rendimiento, no de un diseño anticipado.
- **`selectAdmissible` compartido entre Optimizer y SimulationEngine**: cero lógica de negoción de scheduling duplicada.

## 12. Limitaciones conocidas

- El scheduling es una **heurística greedy**, no un solver óptimo de RCPSP: no garantiza el makespan mínimo teórico.
- El impacto de una tarea sobre "otras tareas" en el scoring usa dependientes directos, no el cierre transitivo completo.
- `GraphView` y el panel de Simulación truncan la visualización a 220 y 150 nodos respectivamente por legibilidad — el motor sí procesa el dataset completo, solo la vista se limita.
- La tabla de Tareas no está virtualizada: con datasets muy grandes (miles de filas) el render del DOM, no el motor, sería el cuello de botella. No se abordó por estar fuera del alcance del motor algorítmico, que es el objeto real de este proyecto.
- No se realizó una auditoría WCAG formal; sí se implementó HTML semántico, `aria-label` en controles icónicos, navegación por teclado nativa (botones/inputs reales) y un estado de foco visible consistente (`:focus-visible`).
- El generador sintético (`DataGenerator`) construye datasets sin ciclos por construcción (las dependencias solo apuntan a índices anteriores): para probar la detección de ciclos se usan datasets manuales pequeños en los tests, no el generador masivo.

## 13. Posibles mejoras

- Reemplazar la heurística greedy por una metaheurística (recocido simulado, algoritmo genético) para acercarse más al óptimo en instancias medianas.
- Calcular el impacto de dependientes de forma incremental y cacheada (en vez de direct-only) usando el mismo heap persistente para no pagar el coste transitivo completo.
- Virtualización de la tabla de tareas y del grafo SVG para datasets de decenas de miles de tareas.
- Persistir también el historial de simulaciones (no solo el estado final) para poder "reproducir" una ejecución pasada.

## Ejecutar

Abre `index.html` directamente en un navegador moderno (usa módulos ES nativos, sin build step). Para los tests:

```bash
npm install   # solo necesario para `npm run verify-ui` (jsdom); los tests unitarios no tienen dependencias
npm test
npm run verify-ui
```
