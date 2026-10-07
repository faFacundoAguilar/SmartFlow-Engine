**SmartFlow Engine** is a JavaScript web application centered on an algorithmic scheduling engine designed to solve variants of the **RCPSP** (Resource-Constrained Project Scheduling Problem). It determines which tasks to execute in parallel, their optimal order, and their priority, while respecting dependencies and resource constraints. Its value lies entirely in the decoupled engine (`/src/core`).

---

##  Concept and architecture

* **Strict decoupling:** The user interface (UI) consumes the engine, but the engine has no knowledge of the interface.
* **Pure entry point:** The main entry point (`PlanningEngine.optimize()`) is pure and idempotent, facilitating testing, caching, and delegation to Web Workers.
* **Immutable data model:** Tasks are created using immutable factory functions (`Object.freeze`), preventing accidental side effects during execution flow updates.

### Project structure
* `/src/core`: `PlanningEngine`, `DependencyGraph`, `ScoringEngine`, `ConflictDetector`, `Optimizer`.
* `/simulation`: `SimulationEngine` (real-time clock + Promises).
* `/performance`: LRU Cache, Benchmark, `planningWorker` (Web Worker).
* `/ui`: Dashboard, charts, and simulation views.

---

##  Algorithm

The engine prioritizes high performance and scalability through the following key algorithmic decisions:

* **Cycle detection — $O(V + E)$:** Iterative DFS with node coloring (WHITE/GRAY/BLACK) to prevent stack overflow in datasets with thousands of tasks, while simultaneously providing the exact path of the cycle. * **Topological Sort — $O(V + E)$:** Kahn's algorithm (BFS) to process tasks in waves or levels of unlocked dependencies.
* **Greedy Scheduling — $O(V \log V + E)$:** Uses a priority queue (heap) to avoid re-evaluating the task frontier at every event, maintaining $O(V \log V)$ efficiency instead of degrading to $O(V^2)$. * **Sweep-Line:** Efficiently calculates concurrent tasks (`concurrentWith`), avoiding pairwise comparisons with $O(V^2)$ complexity.

---

## Performance and Testing

* **Scalability:** Execution time scales smoothly, ranging from **~3 ms for 10 tasks** to **~90 ms for 5,000 tasks**.
* **Web Worker:** Tasks with datasets exceeding 500 nodes automatically delegate calculations to a background thread (`planningWorker.js`) to maintain UI main-thread responsiveness.
* **LRU Cache:** Temporary storage for dynamic scoring calculations and benchmarking.
* **Test Suite:** Includes 51 native unit tests executed via `node --test`, along with UI smoke tests using `jsdom` (21 automated checks).

### Bash Commands
```bash
npm test # Run the unit test suite
npm run verify-ui # Run
```

Project in production </>

[Visitar sitio ↗︎](https://teal-porcupine-167160.hostingersite.com/)
