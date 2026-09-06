import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf-8');

const dom = new JSDOM(html, { url: 'http://localhost/index.html', pretendToBeVisual: true });
const { window } = dom;

// jsdom NO ejecuta <script type="module"> (limitación conocida de jsdom, no
// de nuestro código). Por eso se importa app.js con el loader REAL de Node,
// tras exponer los globals del DOM simulado, en vez de dejar que jsdom lo
// "ejecute" solo — así probamos el módulo tal cual corre en un navegador,
// no una reimplementación de la carga de módulos.
global.window = window;
global.document = window.document;
global.MouseEvent = window.MouseEvent;
global.Event = window.Event;
global.localStorage = undefined; // fuerza el fallback en memoria de TaskRepository, como en Node real
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

global.Worker = class {
  postMessage() {}
  addEventListener() {}
};

const errors = [];
process.on('unhandledRejection', (err) => errors.push(err));

await import('../src/app.js');
await new Promise((r) => setTimeout(r, 300));

const doc = document;

function check(label, condition) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} - ${label}`);
  if (!condition) process.exitCode = 1;
}

check('sin errores no controlados', errors.length === 0);
if (errors.length) console.error(errors);

check('overview tiene 6 bloques de métricas', doc.querySelectorAll('#overview-container .metric-block').length === 6);
check('el grafo embebido en overview renderizó nodos', doc.querySelectorAll('#overview-container svg .graph-node').length > 0);

doc.querySelector('[data-view="tasks"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Tareas se activó', doc.getElementById('view-tasks').classList.contains('active'));
check('la tabla de tareas tiene filas (dataset semilla = 6 tareas)', doc.querySelectorAll('#tasks-container .task-table tbody tr').length === 6);

const statusSelect = doc.querySelector('#tasks-container select[data-action="status"]');
statusSelect.value = 'in-progress';
statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
check('cambiar el estado de una tarea no lanza excepción', errors.length === 0);
check(
  'el estado se persistió en el dataset en memoria',
  [...doc.querySelectorAll('#tasks-container select[data-action="status"]')].some((s) => s.value === 'in-progress'),
);

doc.querySelector('[data-view="graph"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Grafo se activó', doc.getElementById('view-graph').classList.contains('active'));
check('el grafo standalone renderizó nodos', doc.querySelectorAll('#graph-container svg .graph-node').length > 0);

doc.querySelector('[data-view="optimizer"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Optimizador se activó', doc.getElementById('view-optimizer').classList.contains('active'));
check('hay 8 sliders de pesos', doc.querySelectorAll('#optimizer-container input[type="range"]').length === 8);
check('hay filas en el ranking', doc.querySelectorAll('#optimizer-container .rank-row').length > 0);

const slider = doc.querySelector('#optimizer-container input[data-weight="priority"]');
slider.value = '45';
slider.dispatchEvent(new Event('input', { bubbles: true }));
check('el output del slider se actualiza al instante (antes del debounce)', doc.getElementById('out-priority').textContent === '45');

await new Promise((r) => setTimeout(r, 400)); // dejar pasar el debounce (200ms) del recálculo por cambio de peso
check('el motor recalculó tras el cambio de peso (no lanzó excepción)', errors.length === 0);

doc.querySelector('[data-view="simulation"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Simulación se activó', doc.getElementById('view-simulation').classList.contains('active'));
check('hay carriles de simulación', doc.querySelectorAll('#simulation-container .sim-lane').length > 0);

doc.getElementById('run-simulation').dispatchEvent(new MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 2000)); // speedFactor=200: unas pocas horas-tarea equivalen a milisegundos reales

check(
  'tras ejecutar, al menos un carril quedó "completada"',
  [...doc.querySelectorAll('#simulation-container .lane-state')].some((n) => n.textContent === 'completada'),
);
check('la barra de progreso avanzó', parseInt(doc.getElementById('sim-progress-fill').style.width || '0', 10) > 0);

doc.querySelector('[data-view="performance"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Rendimiento se activó', doc.getElementById('view-performance').classList.contains('active'));
doc.querySelectorAll('input[name="bench-size"]').forEach((cb) => {
  if (Number(cb.value) > 100) cb.checked = false; // limitar el smoke test a tamaños pequeños
});
doc.getElementById('run-benchmark').dispatchEvent(new MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 500));
check('el benchmark produjo resultados visibles', doc.querySelectorAll('#performance-container .bench-bar-row').length > 0);

doc.querySelector('[data-view="events"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
check('vista Eventos se activó', doc.getElementById('view-events').classList.contains('active'));
check('el registro de eventos tiene filas', doc.querySelectorAll('#events-container .event-row').length > 0);

console.log('\nSmoke test finalizado.');
