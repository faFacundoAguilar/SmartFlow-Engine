const SIZES = [10, 50, 100, 500, 1000, 5000];

export function renderPerformanceShell(container, { results, running }, actions) {
  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <strong style="font-family:var(--font-display); font-size:14px;">Benchmark</strong>
      <p class="view-desc">Mide el tiempo real de <span class="mono">PlanningEngine.optimize()</span> (vía <span class="mono">performance.now()</span>) sobre datasets sintéticos de distinto tamaño.</p>
      <div style="display:flex; gap:14px; flex-wrap:wrap; margin:12px 0;">
        ${SIZES.map(
          (size) => `
          <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-dim);">
            <input type="checkbox" name="bench-size" value="${size}" checked /> ${size.toLocaleString('es-ES')}
          </label>`,
        ).join('')}
      </div>
      <button class="btn btn-primary" id="run-benchmark" ${running ? 'disabled' : ''}>${running ? 'Ejecutando…' : 'Ejecutar benchmark'}</button>
    </div>

    <div class="panel">
      <div id="benchmark-results">
        ${results && results.length ? renderResults(results) : `<p style="color:var(--text-faint); font-size:12.5px;">Todavía no se ha ejecutado ningún benchmark.</p>`}
      </div>
    </div>
  `;

  container.querySelector('#run-benchmark').addEventListener('click', () => {
    const sizes = [...container.querySelectorAll('input[name="bench-size"]:checked')].map((el) => Number(el.value));
    actions.onRun(sizes);
  });
}

function renderResults(results) {
  const maxMs = Math.max(1, ...results.map((r) => r.meanMs));
  return results
    .map(
      (r) => `
      <div class="bench-bar-row">
        <span class="mono">${r.size.toLocaleString('es-ES')}</span>
        <div class="bench-bar-track"><div class="bench-bar-fill" style="width:${Math.max(2, (r.meanMs / maxMs) * 100)}%"></div></div>
        <span class="mono">${r.meanMs.toFixed(2)}ms</span>
      </div>`,
    )
    .join('');
}
