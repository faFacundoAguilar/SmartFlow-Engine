import { PlanningEngine } from './core/PlanningEngine.js';
import { DEFAULT_WEIGHTS } from './core/ScoringEngine.js';
import { withUpdates } from './models/Task.js';
import { TaskRepository } from './data/TaskRepository.js';
import { DataGenerator } from './data/DataGenerator.js';
import { EventBus } from './events/EventBus.js';
import { EventType } from './events/eventTypes.js';
import { SimulationEngine } from './simulation/SimulationEngine.js';
import { Benchmark } from './performance/Benchmark.js';
import { PlanningError } from './errors/PlanningError.js';

import { renderOverview } from './ui/Dashboard.js';
import { renderTaskManager } from './ui/TaskManager.js';
import { renderGraph } from './ui/GraphView.js';
import { renderOptimizer } from './ui/OptimizerView.js';
import { renderSimulationShell, setLaneState, setProgress, throttledSetLaneState } from './ui/SimulationView.js';
import { renderPerformanceShell } from './ui/PerformanceView.js';
import { renderEventLogShell, appendEventLogRow } from './ui/EventLogView.js';

// A partir de este tamaño, el cálculo del plan se delega a un Web Worker
// para no bloquear el hilo principal (ver justificación en planningWorker.js
// y en el benchmark real de la Fase 8: por debajo de este umbral, el coste
// de mensajería del worker supera al del propio cálculo).
const WORKER_THRESHOLD = 500;

const eventBus = new EventBus();
const repository = new TaskRepository();

const state = {
  tasks: [],
  weights: { ...DEFAULT_WEIGHTS },
  constraints: { maxConcurrency: 4, resourceCapacities: {} },
  result: null,
  activeView: 'overview',
  editingTaskId: null,
  formError: null,
  simulationRunning: false,
  benchmarkResults: null,
  benchmarkRunning: false,
};

const el = {
  overview: document.getElementById('overview-container'),
  tasks: document.getElementById('tasks-container'),
  graph: document.getElementById('graph-container'),
  optimizer: document.getElementById('optimizer-container'),
  simulation: document.getElementById('simulation-container'),
  performance: document.getElementById('performance-container'),
  events: document.getElementById('events-container'),
};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

function seedInitialTasks() {
  const now = new Date();
  const inDays = (d) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000).toISOString();
  // El ejemplo del propio brief (punto 5): Diseñar BD -> Crear API -> Crear
  // frontend -> Testing, más un par de tareas paralelas para que la
  // concurrencia sea visible desde el primer render.
  return [
    { id: 'db', name: 'Diseñar base de datos', category: 'backend', estimatedDuration: 90, priority: 4, difficulty: 3, importance: 5, urgency: 3, dependencies: [], resources: [{ id: 'database', amount: 1 }], deadline: null },
    { id: 'api', name: 'Crear API', category: 'backend', estimatedDuration: 120, priority: 4, difficulty: 4, importance: 5, urgency: 3, dependencies: ['db'], resources: [], deadline: null },
    { id: 'frontend', name: 'Crear frontend', category: 'frontend', estimatedDuration: 150, priority: 3, difficulty: 3, importance: 4, urgency: 2, dependencies: ['api'], resources: [], deadline: null },
    { id: 'design', name: 'Diseño de interfaz', category: 'design', estimatedDuration: 60, priority: 3, difficulty: 2, importance: 3, urgency: 2, dependencies: [], resources: [{ id: 'design-team', amount: 1 }], deadline: null },
    { id: 'testing', name: 'Testing end-to-end', category: 'qa', estimatedDuration: 45, priority: 5, difficulty: 2, importance: 5, urgency: 4, dependencies: ['frontend', 'design'], resources: [], deadline: inDays(3) },
    { id: 'docs', name: 'Documentación', category: 'research', estimatedDuration: 40, priority: 2, difficulty: 1, importance: 2, urgency: 1, dependencies: ['api'], resources: [], deadline: null },
  ];
}

function bootstrap() {
  const stored = repository.getAll();
  state.tasks = stored.length > 0 ? stored : seedInitialTasks();
  if (stored.length === 0) repository.saveAll(state.tasks);

  setupNav();
  setupDatasetControls();
  renderEventLogShell(el.events);
  eventBus.on('*', (event) => appendEventLogRow(el.events, event));

  recalcPlan();
}

// ---------------------------------------------------------------------------
// Planificación (con delegación a Web Worker para datasets grandes)
// ---------------------------------------------------------------------------

let worker = null;
let requestCounter = 0;
const pendingRequests = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./performance/planningWorker.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event) => {
      const { requestId, ok, result, error } = event.data;
      const pending = pendingRequests.get(requestId);
      pendingRequests.delete(requestId);
      if (!pending) return;
      ok ? pending.resolve(result) : pending.reject(error);
    });
  }
  return worker;
}

function runInWorker(tasks, constraints) {
  return new Promise((resolve, reject) => {
    const requestId = ++requestCounter;
    pendingRequests.set(requestId, { resolve, reject });
    getWorker().postMessage({ requestId, tasks, constraints });
  });
}

function recalcPlan() {
  const constraints = { ...state.constraints, weights: state.weights };

  if (state.tasks.length >= WORKER_THRESHOLD) {
    runInWorker(state.tasks, constraints)
      .then((result) => {
        state.result = result;
        eventBus.emit(EventType.PLAN_RECALCULATED, result);
        renderView(state.activeView);
      })
      .catch((error) => {
        console.error('[SmartFlow] error planificando en el worker:', error);
        state.result = null;
        renderView(state.activeView);
      });
    return;
  }

  try {
    state.result = PlanningEngine.optimize(state.tasks, { ...constraints, eventBus });
  } catch (error) {
    console.error('[SmartFlow] error planificando:', error);
    state.result = null;
  }
  renderView(state.activeView);
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

function setupNav() {
  document.getElementById('main-nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (!button) return;
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = button.dataset.view;
    document.getElementById(`view-${view}`).classList.add('active');
    state.activeView = view;
    renderView(view);
  });
}

function setupDatasetControls() {
  document.getElementById('generate-dataset').addEventListener('click', () => {
    const size = Number(document.getElementById('dataset-size').value);
    state.tasks = DataGenerator.generate(size, { seed: Date.now() % 100000 });
    repository.saveAll(state.tasks);
    eventBus.emit(EventType.DATASET_GENERATED, { size });
    state.editingTaskId = null;
    recalcPlan();
  });
}

// ---------------------------------------------------------------------------
// Render por vista (solo se renderiza la vista activa, para no pagar el
// coste de las demás en cada cambio de estado)
// ---------------------------------------------------------------------------

function renderView(view) {
  const tasksById = new Map(state.tasks.map((t) => [t.id, t]));

  if (view === 'overview') {
    renderOverview(el.overview, { tasks: state.tasks, result: state.result });
  } else if (view === 'tasks') {
    const editingTask = state.editingTaskId ? tasksById.get(state.editingTaskId) : null;
    renderTaskManager(el.tasks, { tasks: state.tasks, editingTask, formError: state.formError }, taskManagerActions);
  } else if (view === 'graph') {
    renderGraph(el.graph, { tasks: state.tasks, result: state.result });
  } else if (view === 'optimizer') {
    renderOptimizer(el.optimizer, { weights: state.weights, result: state.result, tasksById }, optimizerActions);
  } else if (view === 'simulation') {
    const schedulable = state.result
      ? state.tasks.filter((t) => !state.result.blockedTasks.includes(t.id))
      : state.tasks;
    renderSimulationShell(el.simulation, { tasks: schedulable, running: state.simulationRunning }, simulationActions);
  } else if (view === 'performance') {
    renderPerformanceShell(el.performance, { results: state.benchmarkResults, running: state.benchmarkRunning }, performanceActions);
  }
}

// ---------------------------------------------------------------------------
// Acciones: Task Manager
// ---------------------------------------------------------------------------

const taskManagerActions = {
  onSubmit(input, editingId) {
    const id = editingId ?? slugify(input.name);
    const taskInput = { ...input, id, status: tasksIndexOf(id)?.status ?? 'pending' };

    try {
      // Validamos contra el resto del dataset (createTask + validateTaskSet
      // ocurren dentro de PlanningEngine.prepare; aquí hacemos una pasada
      // rápida usando el propio motor para no duplicar reglas de validación).
      const candidateTasks = editingId
        ? state.tasks.map((t) => (t.id === editingId ? taskInput : t))
        : [...state.tasks, taskInput];

      PlanningEngine.prepare(candidateTasks, {}); // lanza PlanningError si algo es inválido

      state.tasks = candidateTasks;
      state.formError = null;
      state.editingTaskId = null;
      repository.saveAll(state.tasks);
      eventBus.emit(editingId ? EventType.TASK_UPDATED : EventType.TASK_CREATED, { taskId: id });
      recalcPlan();
    } catch (error) {
      state.formError = error instanceof PlanningError ? error.message : String(error);
      renderView('tasks');
    }
  },

  onEdit(id) {
    state.editingTaskId = id;
    state.formError = null;
    renderView('tasks');
  },

  onCancelEdit() {
    state.editingTaskId = null;
    state.formError = null;
    renderView('tasks');
  },

  onDelete(id) {
    state.tasks = state.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, dependencies: t.dependencies.filter((d) => d !== id) }));
    repository.saveAll(state.tasks);
    eventBus.emit(EventType.TASK_DELETED, { taskId: id });
    recalcPlan();
  },

  onStatusChange(id, status) {
    const task = tasksIndexOf(id);
    if (!task) return;
    try {
      const updated = withUpdates(task, { status });
      state.tasks = state.tasks.map((t) => (t.id === id ? updated : t));
      repository.saveAll(state.tasks);
      eventBus.emit(EventType.TASK_UPDATED, { taskId: id, status });
      recalcPlan();
    } catch (error) {
      console.error('[SmartFlow] error actualizando estado:', error);
    }
  },
};

function tasksIndexOf(id) {
  return state.tasks.find((t) => t.id === id);
}

function slugify(name) {
  const base = String(name || 'tarea')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  let candidate = base || 'tarea';
  let suffix = 1;
  while (tasksIndexOf(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// Acciones: Optimizer (pesos)
// ---------------------------------------------------------------------------

const optimizerActions = {
  onWeightChange(key, value) {
    state.weights = { ...state.weights, [key]: value };
    eventBus.emit(EventType.WEIGHTS_UPDATED, { key, value });
    recalcPlan();
  },
};

// ---------------------------------------------------------------------------
// Acciones: Simulación
// ---------------------------------------------------------------------------

const simulationActions = {
  async onRun() {
    if (state.simulationRunning || !state.result) return;
    state.simulationRunning = true;
    renderView('simulation');

    const { schedulableTasks, graph, scoringEngine } = PlanningEngine.prepare(state.tasks, {
      ...state.constraints,
      weights: state.weights,
    });

    const simulation = new SimulationEngine({ eventBus, speedFactor: 200 });
    const container = el.simulation;

    const onStarted = (event) => throttledSetLaneState(container, event.payload.taskId, 'running');
    const onCompleted = (event) => {
      throttledSetLaneState(container, event.payload.taskId, 'done');
      setProgress(container, event.payload.progress);
    };
    eventBus.on(EventType.SIMULATION_TASK_STARTED, onStarted);
    eventBus.on(EventType.SIMULATION_TASK_COMPLETED, onCompleted);

    try {
      await simulation.run(schedulableTasks, graph, scoringEngine, { ...state.constraints, weights: state.weights });
    } finally {
      eventBus.off(EventType.SIMULATION_TASK_STARTED, onStarted);
      eventBus.off(EventType.SIMULATION_TASK_COMPLETED, onCompleted);
      state.simulationRunning = false;
      // Refleja en el dataset persistido qué tareas quedaron "completadas" tras la simulación real.
      const completedIds = new Set(schedulableTasks.map((t) => t.id));
      state.tasks = state.tasks.map((t) => (completedIds.has(t.id) ? { ...t, status: 'completed' } : t));
      repository.saveAll(state.tasks);
      renderView('simulation');
    }
  },
};

// ---------------------------------------------------------------------------
// Acciones: Performance
// ---------------------------------------------------------------------------

const performanceActions = {
  onRun(sizes) {
    state.benchmarkRunning = true;
    renderView('performance');
    // Se difiere al siguiente frame para que el botón "Ejecutando…" pinte antes del cómputo síncrono.
    requestAnimationFrame(() => {
      state.benchmarkResults = Benchmark.run(sizes, { repeats: 2, maxConcurrency: state.constraints.maxConcurrency });
      state.benchmarkRunning = false;
      eventBus.emit(EventType.BENCHMARK_COMPLETED, { sizes });
      renderView('performance');
    });
  },
};

bootstrap();
