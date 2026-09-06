# SmartFlow Engine

Modern JavaScript web application implementing an algorithmic planning engine based on graphs, dynamic scoring, conflict detection, concurrent task optimization, event-driven architecture, local persistence, simulation, and benchmarking.

The task manager is only the interface. The actual project is the engine: `src/core/`.

## 1. What it is

Given a set of tasks with dependencies, resources, priorities, and deadlines, SmartFlow Engine automatically calculates **which tasks can run in parallel, in what order, and with what priority**, detecting in advance any situation that would make the plan infeasible (cycles, impossible deadlines, insufficient resources).

## 2. Problem it solves

This is not a TODO list. The real problem is a variant of **RCPSP (Resource-Constrained Project Scheduling Problem)**: scheduling tasks with precedence constraints (directed graph), limited resources, and a concurrency limit, while maximizing a configurable score.

This problem is NP-hard in the general case — the engine uses a deterministic greedy heuristic, not an exact solver, and explicitly documents this in the code rather than pretending to provide optimal solutions.

## 3. Architecture

```text
/src
  /core           PlanningEngine, DependencyGraph, ScoringEngine, ConflictDetector, Optimizer
  /models         Task (immutable factory)
  /events         EventBus + event catalog
  /simulation     SimulationEngine (real clock, Promises)
  /data           TaskRepository (persistence) + DataGenerator (synthetic datasets)
  /performance    Cache (generic LRU), Benchmark, planningWorker (Web Worker)
  /errors         PlanningError + error code catalog
  /utils          validation, dateUtils, helpers (debounce/throttle/escapeHtml), PriorityQueue
  /ui             Dashboard, TaskManager, GraphView, OptimizerView, SimulationView,
                  PerformanceView, EventLogView, styles.css
  app.js          UI orchestrator (state + wiring)
/tests            51 tests (node:test), one test per core module
/scripts           verify-ui.mjs — full UI smoke test with jsdom
index.html
```

**Dependency rule respected throughout the entire project:** the UI imports the engine; the engine never imports anything from `/ui`.

`PlanningEngine.optimize()` is a pure function from start to finish — same `(tasks, constraints)`, same result — making it trivial to test, cache, and, once the dataset reaches a certain size, delegate to a Web Worker without redesigning anything.

## 4. Algorithms used

* **Iterative DFS with node coloring** (WHITE/GRAY/BLACK) to detect cycles, reconstructing the exact path — not merely reporting that "a cycle exists." Iterative traversal is intentional: with thousands of chained tasks, a recursive implementation could risk a stack overflow.
* **Kahn's algorithm** (BFS based on in-degree) for topological sorting, chosen over the DFS variant because it produces "levels" (waves of tasks that become unlocked together), the structure required by both `ConflictDetector` (resource overload) and `GraphView` (column-based layout).
* **Earliest-finish-time (CPM-style)** to detect mathematically impossible deadlines: it calculates the true lower bound of the best-case scenario (unlimited concurrency) and compares it against the available time.
* **Greedy scheduling with a persistent heap**: each task enters a priority queue exactly once, at the moment its dependencies are completed, with its score fixed at that moment. Admission is applied in strict order: dependencies → resources → concurrency (`maxConcurrency`) → score.
* **Sweep-line** to calculate which tasks overlapped in time (`concurrentWith`), instead of comparing every possible pair.
* **Mulberry32** (seeded PRNG) in `DataGenerator`, making benchmarks reproducible.

## 5. Time complexity

| Operation                     | Complexity                         |
| ----------------------------- | ---------------------------------- |
| Graph construction            | O(V + E)                           |
| Cycle detection               | O(V + E)                           |
| Topological sorting           | O(V + E)                           |
| Earliest-finish (deadlines)   | O(V + E)                           |
| Optimizer (full scheduling)   | O(V log V + E)                     |
| `concurrentWith` (sweep-line) | O(V · peak concurrency), not O(V²) |

**Honest audit note:** the first implementation of the Optimizer recalculated the entire available-task frontier on every completion event (O(V) per event), degenerating into a real O(V²) implementation and exhausting memory with 5,000 tasks.

It was fixed using a persistent heap + incremental unlocking through dependents (see the extensive comment in `Optimizer.js`). This is not an academic note: it was a real bug detected by running the benchmark, not a theoretical limitation anticipated in advance.

## 6. Dependency management

Tasks are modeled as a directed graph (`A → B` means "A depends on B").

`DependencyGraph` maintains both direct and reverse adjacency (`Map<id, Set<id>>`) so that both "what does this depend on?" and "who do I unlock?" operations are O(1)/O(degree).

A cycle is reported with its exact path (`metadata.cyclePath`), and any task that transitively depends on an unexecutable task (cyclic or requiring an impossible resource) is marked `BLOCKED_TASK` — the blockage is never discovered "by accident" during scheduling.

## 7. Scoring system

`ScoringEngine.score(task, context)` is a memoized wrapper around `computeScore()`, which is a pure function.

The score combines the following configurable factors (weights from 0–50 in the UI):

```text
score = priority + urgency + importance + deadlineUrgency + delay + dependencyImpact
        − durationPenalty − difficultyPenalty
```

`dependencyImpact` uses the number of **direct dependents** (not the full transitive closure): calculating the true transitive impact of every task would be O(V·(V+E)) in the worst case, which is unacceptable with 5,000 tasks.

This is a deliberate and documented simplification, not an oversight.

The `ScoringEngine` cache is fully invalidated whenever the weights change (`updateWeights`), because changing the weights affects every score — partial invalidation would be more complex than the cache itself without providing any meaningful benefit.

## 8. Optimization (concurrent scheduling)

`Optimizer.runVirtual` and `SimulationEngine.run` share the same decision function (`selectAdmissible`): there are never two diverging implementations of "what gets admitted now."

The former uses a **virtual clock** (jumps directly to the next completion event; synchronous and instantaneous computation — this is how `PlanningEngine` can produce a plan for 5,000 tasks in ~90ms).

The latter uses a **real clock** via `Promise.race` over a pool of active promises, providing actual concurrency rather than a progress bar that merely pretends to run tasks concurrently.

## 9. Performance

Real benchmark (`Benchmark.run`, `performance.now()`, average of 5 repetitions, `maxConcurrency=4`, fixed-seed synthetic dataset):

| Size | Average |     Min |      Max |
| ---- | ------: | ------: | -------: |
| 10   |  3.07ms |  0.38ms |  11.94ms |
| 50   |  1.50ms |  1.23ms |   1.96ms |
| 100  |  4.07ms |  2.80ms |   5.90ms |
| 500  | 22.39ms | 10.97ms |  40.28ms |
| 1000 | 40.11ms | 24.41ms |  64.50ms |
| 5000 | 91.74ms | 69.51ms | 140.92ms |

500× more tasks (10 → 5,000) costs ~30× more execution time, consistent with the claimed O(V log V + E) complexity rather than a quadratic blow-up.

**Web Worker** (`planningWorker.js`): the UI delegates `optimize()` to a worker starting at 500 tasks (`WORKER_THRESHOLD` in `app.js`).

The justification is practical rather than decorative: blocking the main thread for 100ms is noticeable (one frame at 60fps takes ~16ms). Below the threshold, the worker messaging overhead would exceed the computation cost itself, so execution remains on the main thread.

**LRU Cache** (`performance/Cache.js`): used by `ScoringEngine` (with a 20,000-entry limit as a safety cap — in practice, it never comes close to that limit thanks to the persistent heap) and by `Benchmark` (to avoid regenerating the same synthetic dataset between repetitions).

## 10. Testing

51 tests (`node --test`), with no artificial mocks — each test attempts to find a real error:

* `DependencyGraph`: construction, cycles, topological ordering, incremental availability.
* `ScoringEngine`: purity, priority ordering, cache invalidation when weights change.
* `ConflictDetector`: cycles, impossible deadlines (with dependency chains), impossible resources, overload.
* `PlanningEngine`: valid plan, blocked tasks, respect for `maxConcurrency` and resource capacity, 1,000-task dataset.
* `Optimizer` / `SimulationEngine`: event-measured real concurrency, impossible-resource deadlock without hanging.
* `EventBus`, `TaskRepository`, `DataGenerator`, `PriorityQueue`, `Cache`, `Benchmark`, `planningWorker`.

Additionally, `scripts/verify-ui.mjs` loads `index.html` + `app.js` with jsdom (injecting its globals and using Node's real ES module loader, since jsdom does not execute `<script type="module">`) and simulates real clicks across all 7 views, including running an actual simulation and benchmark.

21 checks, all green.

```bash
npm test          # unit test suite (node --test)
npm run verify-ui  # full UI smoke test
```

## 11. Relevant technical decisions

* **Task as an immutable factory, not a class**: it has no behavior dependent on internal state — it is a data record. `Object.freeze` (including internal arrays) prevents accidental mutations downstream in the pipeline.
* **localStorage over IndexedDB**: the volume (thousands of tasks, small JSON payloads) fits comfortably within localStorage; there are no indexed queries or transactions that would justify IndexedDB.
* **Direct, not transitive, dependent impact** (see §7): explicit cost-vs-benefit trade-off.
* **Persistent heap, not heap-per-event** (see §5): the result of a real performance audit, not an anticipated design choice.
* **Shared `selectAdmissible` between Optimizer and SimulationEngine**: zero duplicated scheduling decision logic.

## 12. Known limitations

* Scheduling is a **greedy heuristic**, not an optimal RCPSP solver: it does not guarantee the theoretical minimum makespan.
* A task's impact on "other tasks" in the scoring system uses direct dependents, not the complete transitive closure.
* `GraphView` and the Simulation panel truncate visualization to 220 and 150 nodes respectively for readability — the engine still processes the complete dataset; only the view is limited.
* The Tasks table is not virtualized: with very large datasets (thousands of rows), DOM rendering rather than the engine would become the bottleneck. This was not addressed because it is outside the scope of the algorithmic engine, which is the actual subject of this project.
* No formal WCAG audit was performed; however, semantic HTML, `aria-label` attributes on icon controls, native keyboard navigation (real buttons/inputs), and a consistent visible focus state (`:focus-visible`) were implemented.
* The synthetic generator (`DataGenerator`) constructs datasets without cycles by design (dependencies only point to earlier indices): cycle detection is therefore tested using small manually constructed datasets rather than the large generator.

## 13. Possible improvements

* Replace the greedy heuristic with a metaheuristic (simulated annealing, genetic algorithm) to get closer to the optimum on medium-sized instances.
* Calculate dependent impact incrementally and with caching (instead of direct-only) using the same persistent heap to avoid paying the full transitive cost.
* Virtualize the task table and SVG graph for datasets containing tens of thousands of tasks.
* Persist simulation history as well (not just the final state) to make it possible to "replay" a previous execution.

## Run

Open `index.html` directly in a modern browser (it uses native ES modules, with no build step).

For tests:

```bash
npm install   # only required for `npm run verify-ui` (jsdom); unit tests have no dependencies
npm test
npm run verify-ui
```
Contact / Commercial Use

This project is free and open source. If your company needs a scheduling engine like this integrated into your product, tailored to a specific domain, or with ongoing support and maintenance, you can contact me at: <br>
<a href="https://www.linkedin.com/in/facundo-aguilar-014265261/" target="_blank"><img src="https://raw.githubusercontent.com/maurodesouza/profile-readme-generator/master/src/assets/icons/social/linkedin/default.svg" width="22" height="22" alt="LinkedIn logo" style="vertical-align: middle; margin-right: 4px;" />  Facundo Aguilar</a>
