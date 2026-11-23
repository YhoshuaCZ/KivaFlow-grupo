/* =========================================================
   KivaFlow · Aplicación SPA (7 vistas interactivas)
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  const STATE = {
    page: "inicio",
    inicio: "F22_C39",
    destinos: ["F05_C05", "F39_C10", "F11_C29"],
    bloqueados: [],
    perfil: "punta",
    regresar: false,
    clickModo: "Inicio",
    exploreAlg: "bfs",
    ekOrigen: "Recepción y Almacenamiento",
    ekDestino: "Empaque y Despacho",
    sim: {
      escala: "pedido",
      alg: "bfs",
      nOps: 24,
      maxProd: 3,
      hora: "punta",
      zOrigen: "Recepción y Almacenamiento",
      zDestino: "Empaque y Despacho",
      semilla: 1,
      result: null,
    },
    expCache: null,
    verifCache: null,
  };

  let activeCleanups = [];

  function saveSessionState() {
    try {
      sessionStorage.setItem(
        "kf_state_v1",
        JSON.stringify({
          inicio: STATE.inicio,
          destinos: STATE.destinos,
          bloqueados: STATE.bloqueados,
          perfil: STATE.perfil,
          regresar: STATE.regresar,
          exploreAlg: STATE.exploreAlg,
        })
      );
    } catch (_) { }
  }

  function restoreSessionState(data) {
    try {
      const raw = sessionStorage.getItem("kf_state_v1");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.inicio && data.nodos[saved.inicio]) STATE.inicio = saved.inicio;
      if (Array.isArray(saved.destinos)) {
        const valid = saved.destinos.filter((id) => data.nodos[id] && id !== STATE.inicio).slice(0, 10);
        if (valid.length > 0) STATE.destinos = valid;
      }
      if (Array.isArray(saved.bloqueados)) {
        STATE.bloqueados = saved.bloqueados.filter((id) => data.nodos[id] && id !== STATE.inicio && !STATE.destinos.includes(id));
      }
      if (saved.perfil === "punta" || saved.perfil === "valle") STATE.perfil = saved.perfil;
      if (typeof saved.regresar === "boolean") STATE.regresar = saved.regresar;
      if (["bfs", "bellman_ford", "edmonds_karp"].includes(saved.exploreAlg)) {
        STATE.exploreAlg = saved.exploreAlg;
      }
    } catch (_) { }
  }

  function registerCleanup(fn) {
    activeCleanups.push(fn);
  }

  function runCleanups() {
    for (const fn of activeCleanups) {
      try {
        fn();
      } catch (_) { }
    }
    activeCleanups = [];
  }

  function pageHeader(title, accent, sub) {
    return `
      <header class="page-header">
        <h1>${title} <span class="title-accent">${accent}</span></h1>
        <p class="page-sub">${sub}</p>
      </header>
    `;
  }

  function renderBars(title, entries, fmt, note = "menos es mejor") {
    const maxVal = Math.max(...entries.map((e) => e.val), 0.0001);
    const rows = entries
      .map(
        (e) => `
      <div class="bar-row">
        <span>${KF.NOMBRE[e.alg]}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width:${(100 * e.val) / maxVal}%;background:${KF.PALETA.ALGORITMO[e.alg]}"></div>
        </div>
        <span class="bar-val">${fmt(e.val)}</span>
      </div>`
      )
      .join("");
    return `
      <div class="bar-block">
        <div class="bar-header">
          <b>${title}</b>
          <span class="card-note">${note}</span>
        </div>
        ${rows}
      </div>
    `;
  }

  function renderLegend(items) {
    return `<div class="canvas-legend">${items
      .map((it) =>
        it.dot
          ? `<span class="legend-item"><span class="legend-dot" style="background:${it.color};${it.border ? `border:2px solid ${it.border}` : ""}"></span>${it.label}</span>`
          : `<span class="legend-item"><span class="legend-swatch" style="background:${it.color}"></span>${it.label}</span>`
      )
      .join("")}</div>`;
  }

  function renderSkeletonBlock(kpiCount = 4, showTable = true) {
    const kpis = Array.from({ length: kpiCount }, (_, i) => `
      <div class="card kpi-${(i % 4) + 1} sk-kpi">
        <div class="sk sk-line w-45"></div>
        <div class="sk sk-num"></div>
        <div class="sk sk-line w-80"></div>
      </div>`).join("");
    const table = showTable
      ? `<div class="card sk-box">
           <div class="sk sk-line w-40"></div>
           <div class="sk sk-table-row"></div>
           <div class="sk sk-table-row"></div>
           <div class="sk sk-table-row"></div>
           <div class="sk sk-table-row"></div>
         </div>`
      : `<div class="grid-2">
           <div class="card sk-box" style="min-height:340px"><div class="sk sk-line w-45"></div><div class="sk sk-canvas"></div></div>
           <div class="card sk-box" style="min-height:340px"><div class="sk sk-line w-45"></div><div class="sk sk-canvas"></div></div>
         </div>`;
    return `<div class="stack" aria-busy="true"><div class="grid-${kpiCount}">${kpis}</div>${table}</div>`;
  }

  /* =======================================================
     Selector interactivo de puntos (reutilizado en Comparar y Explorar)
     ======================================================= */
  function mountPointSelector(container, data, onChange) {
    container.innerHTML = `
      <div class="stack">
        <div class="row-between">
          <div class="row">
            <div class="control-group">
              <span class="control-label">El clic en el mapa marca</span>
              <div class="segmented" data-seg="modo">
                <button type="button" data-val="Inicio" class="${STATE.clickModo === "Inicio" ? "active" : ""}">Inicio</button>
                <button type="button" data-val="Destino" class="${STATE.clickModo === "Destino" ? "active" : ""}">Destino</button>
                <button type="button" data-val="Bloquear" class="${STATE.clickModo === "Bloquear" ? "active" : ""}">Bloquear </button>
              </div>
            </div>

            <div class="control-group">
              <span class="control-label">Escenario de pesos</span>
              <div class="segmented" data-seg="perfil">
                <button type="button" data-val="punta" class="${STATE.perfil === "punta" ? "active" : ""}">Dataset (punta)</button>
                <button type="button" data-val="valle" class="${STATE.perfil === "valle" ? "active" : ""}">Sensibilidad (valle)</button>
              </div>
            </div>

            <div class="control-group">
              <span class="control-label">Retorno</span>
              <label class="toggle-wrap">
                <input type="checkbox" id="sel-regresar" ${STATE.regresar ? "checked" : ""} />
                Volver al inicio
              </label>
            </div>
          </div>

          <div class="row">
            <div class="control-group">
              <span class="control-label">Agregar por SKU (${data.skuMap.size} disponibles)</span>
              <div class="row" style="gap:6px">
                <input type="text" id="sel-sku-input" class="input" list="kf-sku-list" placeholder="Ej. SKU-0512" style="width:142px" />
                <datalist id="kf-sku-list">
                  ${Array.from(data.skuMap.keys()).sort().map((sku) => `<option value="${sku}"></option>`).join("")}
                </datalist>
                <button type="button" id="sel-sku-add" class="btn">Agregar SKU</button>
              </div>
            </div>
            <div class="control-group">
              <span class="control-label">Cant. destinos</span>
              <input type="number" id="sel-n" class="input" min="1" max="10" value="${Math.max(1, STATE.destinos.length)}" style="width:74px" />
            </div>
            <div class="control-group">
              <span class="control-label">&nbsp;</span>
              <button type="button" id="sel-azar" class="btn">Al azar</button>
            </div>
          </div>
        </div>
        <div id="sel-sku-msg" class="card-note" aria-live="polite" hidden></div>

        <div class="canvas-card" style="padding:10px 12px">
          <div class="canvas-wrap"><canvas id="sel-canvas"></canvas></div>
        </div>

        <div class="row" style="font-size:13px">
          <span class="card-note">Inicio:</span>
          <span class="chip chip-dark">${STATE.inicio}</span>
          <span class="card-note" style="margin-left:6px">Destinos (${STATE.destinos.length}):</span>
          ${STATE.destinos.length
        ? STATE.destinos.map((d) => {
          const sku = data.nodos[d] && data.nodos[d].sku ? ` · ${data.nodos[d].sku}` : "";
          return `<span class="chip">${d}${sku}<button type="button" class="chip-remove" data-rm="${d}" aria-label="Quitar destino ${d}" title="Quitar">×</button></span>`;
        }).join("")
        : `<span class="card-note">— haz clic en el mapa o busca un SKU para agregar</span>`
      }
          ${STATE.bloqueados.length
        ? `<span class="card-note" style="margin-left:8px">Bloqueados (${STATE.bloqueados.length}):</span>` +
        STATE.bloqueados.map((b) => `<span class="chip" style="background:var(--ek-soft);color:var(--ek)">${b}<button type="button" class="chip-remove" data-rm-blk="${b}" aria-label="Desbloquear ${b}" title="Quitar bloqueo">×</button></span>`).join("") +
        `<button type="button" id="sel-clear-blk" class="btn btn-sm" style="margin-left:4px">Limpiar ×</button>`
        : ""
      }
        </div>
      </div>
    `;

    const canvasEl = container.querySelector("#sel-canvas");
    const map = new KF.WarehouseCanvas(canvasEl, data, {
      width: 820,
      height: 360,
      interactive: true,
      onNodeClick: (nodeId) => {
        if (STATE.clickModo === "Inicio") {
          STATE.inicio = nodeId;
          STATE.bloqueados = STATE.bloqueados.filter((b) => b !== nodeId);
        } else if (STATE.clickModo === "Bloquear") {
          const idx = STATE.bloqueados.indexOf(nodeId);
          if (idx >= 0) STATE.bloqueados.splice(idx, 1);
          else if (nodeId !== STATE.inicio && !STATE.destinos.includes(nodeId)) {
            STATE.bloqueados.push(nodeId);
          }
        } else {
          const idx = STATE.destinos.indexOf(nodeId);
          if (idx >= 0) STATE.destinos.splice(idx, 1);
          else if (STATE.destinos.length < 10 && nodeId !== STATE.inicio) {
            STATE.bloqueados = STATE.bloqueados.filter((b) => b !== nodeId);
            STATE.destinos.push(nodeId);
          }
        }
        saveSessionState();
        onChange();
      },
    });
    map.render({ start: STATE.inicio, destinations: STATE.destinos, blockedList: STATE.bloqueados });
    registerCleanup(() => map.destroy());

    container.querySelectorAll(".chip-remove[data-rm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = STATE.destinos.indexOf(btn.dataset.rm);
        if (idx >= 0) {
          STATE.destinos.splice(idx, 1);
          saveSessionState();
          onChange();
        }
      });
    });

    container.querySelectorAll(".chip-remove[data-rm-blk]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = STATE.bloqueados.indexOf(btn.dataset.rmBlk);
        if (idx >= 0) {
          STATE.bloqueados.splice(idx, 1);
          saveSessionState();
          onChange();
        }
      });
    });

    const clearBlkBtn = container.querySelector("#sel-clear-blk");
    if (clearBlkBtn) {
      clearBlkBtn.addEventListener("click", () => {
        STATE.bloqueados = [];
        saveSessionState();
        onChange();
      });
    }

    container.querySelectorAll('[data-seg="modo"] button').forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.clickModo = btn.dataset.val;
        container
          .querySelectorAll('[data-seg="modo"] button')
          .forEach((b) => b.classList.toggle("active", b === btn));
      });
    });

    container.querySelectorAll('[data-seg="perfil"] button').forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.perfil = btn.dataset.val;
        onChange();
      });
    });

    container.querySelector("#sel-regresar").addEventListener("change", (ev) => {
      STATE.regresar = ev.target.checked;
      onChange();
    });

    const skuInput = container.querySelector("#sel-sku-input");
    const skuMsg = container.querySelector("#sel-sku-msg");
    function addSkuTarget() {
      const val = (skuInput.value || "").trim().toUpperCase();
      if (!val) return;
      const racks = data.skuMap.get(val);
      if (!racks || racks.length === 0) {
        skuMsg.textContent = `No se encontró el producto ${val} en el inventario del almacén.`;
        skuMsg.hidden = false;
        return;
      }
      const refNode = STATE.destinos.length > 0 ? STATE.destinos[STATE.destinos.length - 1] : STATE.inicio;
      const excluded = new Set([STATE.inicio, ...STATE.destinos, ...STATE.bloqueados]);
      const chosen = data.nearestRackForSku
        ? data.nearestRackForSku(val, refNode, excluded)
        : racks.find((id) => !excluded.has(id)) || racks[0];
      if (STATE.destinos.includes(chosen)) {
        skuMsg.textContent = `${val} (${chosen}) ya está en la lista de destinos.`;
        skuMsg.hidden = false;
        return;
      }
      if (STATE.destinos.length >= 10) {
        skuMsg.textContent = "Máximo 10 destinos por pedido.";
        skuMsg.hidden = false;
        return;
      }
      STATE.destinos.push(chosen);
      saveSessionState();
      onChange();
    }
    container.querySelector("#sel-sku-add").addEventListener("click", addSkuTarget);
    skuInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        addSkuTarget();
      }
    });

    container.querySelector("#sel-azar").addEventListener("click", () => {
      const n = Math.max(1, Math.min(10, parseInt(container.querySelector("#sel-n").value, 10) || 3));
      const pool = data.racksPicking && data.racksPicking.length ? data.racksPicking : data.racks;
      const muelles = data.estacionesDespacho && data.estacionesDespacho.length ? data.estacionesDespacho : data.estaciones;
      STATE.inicio = muelles[Math.floor(Math.random() * muelles.length)];
      const chosen = new Set([STATE.inicio, ...STATE.bloqueados]);
      const dests = [];
      while (dests.length < n) {
        const c = pool[Math.floor(Math.random() * pool.length)];
        if (!chosen.has(c)) {
          chosen.add(c);
          dests.push(c);
        }
      }
      STATE.destinos = dests;
      saveSessionState();
      onChange();
    });
  }

  /* =======================================================
     1. INICIO
     ======================================================= */
  function renderInicio(main, data) {
    const startId = "F22_C39";
    const destId = "F08_C03";
    const { directed } = data.graphs.punta;

    // Ruta inicial con Bellman-Ford (registrando rondas reales para la animación de búsqueda)
    const initSteps = [];
    const initFull = KF.bellmanFord(data.ids, directed, startId, initSteps);
    const fullInitPath = [];
    for (let cur = destId; cur !== null && cur !== undefined; cur = initFull.parent.get(cur)) {
      fullInitPath.push(cur);
    }
    fullInitPath.reverse();

    // Elegir el incidente en el primer tramo de congestión Alta después del 25% del recorrido (coherencia operativa)
    let hitEdgeIdx = -1;
    const minIdx = Math.max(4, Math.floor(fullInitPath.length * 0.25));
    const maxIdx = Math.min(fullInitPath.length - 5, Math.floor(fullInitPath.length * 0.72));
    for (let i = minIdx; i <= maxIdx; i++) {
      const e = data.edgeMap.get(KF.edgeKey(fullInitPath[i], fullInitPath[i + 1]));
      if (e && e.frec === "Alta") {
        hitEdgeIdx = i + 1;
        break;
      }
    }
    const blockedIdx = hitEdgeIdx > 0 ? hitEdgeIdx : Math.floor(fullInitPath.length * 0.48);
    // El operario avanza hasta el nodo inmediatamente anterior al bloqueo antes de detectar la avería
    const midIdx = Math.max(2, blockedIdx - 1);
    const fromNode = fullInitPath[midIdx];
    const blockedNode = fullInitPath[blockedIdx];

    // Bloquear un corredor completo de 7 filas en la columna averiada para forzar un desvío real y visible
    const bn = data.nodos[blockedNode];
    const blockedCorridor = [];
    const blockedKeys = new Set();
    for (let dr = -3; dr <= 3; dr++) {
      const r = bn.fila + dr;
      if (r < 0 || r >= data.rows) continue;
      const nid = `F${String(r).padStart(2, "0")}_C${String(bn.col).padStart(2, "0")}`;
      if (nid === fromNode || nid === destId || !data.nodos[nid]) continue;
      blockedCorridor.push(nid);
      for (const nb of data.graphs.punta.adj[nid] || []) {
        blockedKeys.add(KF.edgeKey(nid, nb.to));
      }
    }

    const recalcSteps = [];
    const recalcFull = KF.bellmanFord(data.ids, directed, fromNode, recalcSteps, blockedKeys);
    const recalcPath = [];
    for (let cur = destId; cur !== null && cur !== undefined; cur = recalcFull.parent.get(cur)) {
      recalcPath.push(cur);
    }
    recalcPath.reverse();

    const initMetrics = KF.medirRuta(fullInitPath, data.edgeMap, "punta");
    const finalWalkedPath = fullInitPath.slice(0, midIdx + 1).concat(recalcPath.slice(1));
    const finalMetrics = KF.medirRuta(finalWalkedPath, data.edgeMap, "punta");

    function appendSearchPhase(framesArr, rawSteps, maxFrames, baseOverlay, captionFn) {
      const stride = Math.max(1, Math.ceil(rawSteps.length / maxFrames));
      const acc = new Set();
      for (let r = 0; r < rawSteps.length; r++) {
        const improved = rawSteps[r];
        for (let k = 0; k < improved.length; k++) acc.add(improved[k]);
        const isLast = r === rawSteps.length - 1;
        if (r % stride === 0 || isLast) {
          framesArr.push(
            Object.assign({}, baseOverlay, {
              visited: new Set(acc),
              frontier: new Set(improved),
              caption: captionFn(r + 1, rawSteps.length, acc.size, isLast),
            })
          );
        }
      }
    }

    // Armar cuadros de la historia: búsqueda inicial -> caminata -> incidencia + rebúsqueda -> desvío
    const frames = [];
    appendSearchPhase(
      frames,
      initSteps,
      12,
      { phase: "search1", worker: startId, walked: [], blocked: false },
      (r, tot, n, isLast) =>
        isLast
          ? `Ruta óptima inicial calculada (${initMetrics.tiempoS} s · ${initMetrics.pasillos} pasillos). El operario inicia el recorrido.`
          : `Buscando ruta inicial con Bellman-Ford (ronda ${r}/${tot}): ${KF.formatNum(n)} ubicaciones relajadas.`
    );
    for (let i = 0; i <= midIdx; i++) {
      frames.push({
        phase: "walk1",
        worker: fullInitPath[i],
        walked: fullInitPath.slice(0, i + 1),
        blocked: false,
        caption: `Paso ${i + 1}/${fullInitPath.length - 1}: el operario avanza por la ruta óptima inicial (${startId} → ${destId}).`,
      });
    }
    // Incidencia justo frente al nodo bloqueado + onda real de rebúsqueda evitando el corredor bloqueado
    appendSearchPhase(
      frames,
      recalcSteps,
      12,
      {
        phase: "search2",
        worker: fromNode,
        walked: fullInitPath.slice(0, midIdx + 1),
        oldPlan: fullInitPath.slice(midIdx),
        blocked: true,
      },
      (r, tot, n, isLast) =>
        isLast
          ? `¡Desvío óptimo hallado desde ${fromNode}! Rodea las ${blockedCorridor.length} ubicaciones cerradas del pasillo PV${String(bn.col).padStart(2, "0")}.`
          : `¡Avería frente al operario en ${blockedNode}! Bellman-Ford explora rutas alternas desde ${fromNode} (ronda ${r}/${tot}).`
    );
    for (let i = 1; i < recalcPath.length; i++) {
      frames.push({
        phase: "walk2",
        worker: recalcPath[i],
        walked: fullInitPath.slice(0, midIdx + 1).concat(recalcPath.slice(1, i + 1)),
        oldPlan: fullInitPath.slice(midIdx),
        blocked: true,
        caption: `Desvío activo (${i}/${recalcPath.length - 1}): completando entrega hacia ${destId} (${finalMetrics.tiempoS} s totales).`,
      });
    }

    main.innerHTML = `
      ${pageHeader(
      "Bienvenido a",
      "KivaFlow",
      "Sistema de simulación basado en grafos para la optimización de rutas de picking y análisis de flujo en almacenes inteligentes tipo Amazon."
    )}

      <div class="grid-hero" style="margin-bottom:20px">
        <div class="hero-card">
          <div>
            <span class="hero-badge"><span class="hero-badge-dot"></span>Rutas · Congestión · Capacidad</span>
            <h2 class="hero-title">
              Encuentra la ruta, <span class="title-accent">entiende la congestión.</span>
            </h2>
            <p class="hero-lead">
              Modelamos un centro de cumplimiento de <strong>1 800 ubicaciones</strong> y <strong>3 515 pasillos</strong>
              para comparar caminos mínimos, penalizaciones de tráfico y cuellos de botella en tiempo real.
            </p>
          </div>

          <div class="hero-alg-list">
            <div class="hero-alg-item" style="border-left-color:${KF.PALETA.ALGORITMO.bfs}">
              <span class="hero-alg-name">BFS</span>
              <span class="hero-alg-desc">Línea base por niveles: halla el camino con menos pasillos sin ponderar tráfico.</span>
              <span class="chip">O(V + E)</span>
            </div>
            <div class="hero-alg-item" style="border-left-color:${KF.PALETA.ALGORITMO.bellman_ford}">
              <span class="hero-alg-name">Bellman-Ford</span>
              <span class="hero-alg-desc">Relaja aristas ponderadas para minimizar el tiempo de caminata y esquivar averías.</span>
              <span class="chip">O(V · E)</span>
            </div>
            <div class="hero-alg-item" style="border-left-color:${KF.PALETA.ALGORITMO.edmonds_karp}">
              <span class="hero-alg-name">Edmonds-Karp</span>
              <span class="hero-alg-desc">Calcula el flujo máximo entre zonas y localiza el corte mínimo de pasillos saturados.</span>
              <span class="chip">O(V · E²)</span>
            </div>
          </div>

          <div class="hero-telemetry">
            <div>
              <div class="hero-tel-lbl">Trayecto demo</div>
              <div class="hero-tel-val">${startId} → ${destId}</div>
            </div>
            <div>
              <div class="hero-tel-lbl">Avería en ruta</div>
              <div class="hero-tel-val">${blockedNode} (×${blockedCorridor.length})</div>
            </div>
            <div>
              <div class="hero-tel-lbl">Tiempo original / desvío</div>
              <div class="hero-tel-val">${initMetrics.tiempoS}s → ${finalMetrics.tiempoS}s</div>
            </div>
          </div>

          <div class="row">
            <a href="#simular" class="btn btn-primary" data-nav="comparar">Simular pedido</a>
            <a href="#simular" class="btn" data-nav="simular">Simular turno</a>
            <a href="#explorar" class="btn" data-nav="explorar">Explorar paso a paso</a>
          </div>
        </div>

        <div class="canvas-card">
          <div class="canvas-title">El operario que recalcula</div>
          <div class="canvas-subtitle" id="story-caption" aria-live="polite">
            Dale play: la congestión alta (naranja) es lenta pero transitable; cuando un pasillo saturado sufre una <strong>avería (×)</strong> en <strong>${blockedNode}</strong>, Bellman-Ford recalcula desde <strong>${fromNode}</strong>.
          </div>
          <div class="canvas-wrap"><canvas id="story-canvas"></canvas></div>
          ${renderLegend([
      { color: KF.PALETA.ALGORITMO.bellman_ford, label: "Ruta activa (Bellman-Ford)" },
      { color: KF.PALETA.ALGORITMO.edmonds_karp, label: "Tramo bloqueado / avería" },
      { color: KF.PALETA.CONGESTION.Alta, label: "Congestión alta" },
      { color: KF.PALETA.CONGESTION.Media, label: "Congestión media" },
    ])}
          <div id="story-controls"></div>
        </div>
      </div>

      <div class="grid-4" style="margin-bottom:18px">
        <div class="card kpi-1">
          <div class="card-label">Ubicaciones (V)</div>
          <div class="card-num">1 800</div>
          <div class="card-note">45 × 40 en tres zonas (585 / 630 / 585)</div>
        </div>
        <div class="card kpi-2">
          <div class="card-label">Pasillos (E)</div>
          <div class="card-num">3 515</div>
          <div class="card-note">1.5 m horizontales · 2.5 m verticales</div>
        </div>
        <div class="card kpi-3">
          <div class="card-label">Algoritmos</div>
          <div class="card-num">3</div>
          <div class="card-note">BFS · Bellman-Ford · Edmonds-Karp</div>
        </div>
        <div class="card kpi-4">
          <div class="card-label">Inventario</div>
          <div class="card-num">${KF.formatNum(data.racks.length)}<small>racks</small></div>
          <div class="card-note">${data.estaciones.length} estaciones · ${data.skuMap.size} SKUs únicos</div>
        </div>
      </div>

      <div class="grid-3">
        <div class="card">
          <span class="step-num">01</span>
          <strong>Elige los puntos</strong>
          <p class="card-note" style="margin:6px 0 0">Clic en el mapa o al azar: estación de inicio y hasta 10 racks destino en cualquier zona.</p>
        </div>
        <div class="card">
          <span class="step-num">02</span>
          <strong>Mira al algoritmo pensar</strong>
          <p class="card-note" style="margin:6px 0 0">El pseudocódigo se ilumina línea a línea mientras el almacén se explora o relaja en vivo.</p>
        </div>
        <div class="card">
          <span class="step-num">03</span>
          <strong>Compara y decide</strong>
          <p class="card-note" style="margin:6px 0 0">Tiempo de caminata contra trabajo de cálculo: el trade-off entre BFS y Bellman-Ford, con números.</p>
        </div>
      </div>
    `;

    const canvas = new KF.WarehouseCanvas(main.querySelector("#story-canvas"), data, {
      width: 720,
      height: 410,
    });
    const captionEl = main.querySelector("#story-caption");
    const ctrl = new KF.PlaybackController(
      main.querySelector("#story-controls"),
      frames.length,
      (idx) => {
        const f = frames[idx];
        captionEl.textContent = f.caption;
        canvas.render({
          start: startId,
          destinations: [destId],
          visited: f.visited || null,
          visitedColor: KF.PALETA.ALGORITMO_CLARO.bfs,
          frontier: f.frontier || null,
          path: f.walked,
          pathColor: KF.PALETA.ALGORITMO.bellman_ford,
          secondaryPath: f.oldPlan || null,
          secondaryColor: "rgba(193, 18, 31, 0.5)",
          blockedNode: f.blocked ? blockedNode : null,
          blockedNodes: f.blocked ? blockedCorridor : null,
          workers: [{ node: f.worker, color: KF.PALETA.TINTA, radius: 6.2 }],
        });
      },
      110
    );
    registerCleanup(() => {
      ctrl.destroy();
      canvas.destroy();
    });
  }

  /* =======================================================
     2. EXPLORAR PASO A PASO
     ======================================================= */
  function renderExplorar(main, data) {
    main.innerHTML = `
      ${pageHeader(
      "Explorar",
      "paso a paso",
      "Un algoritmo a la vez, con su pseudocódigo iluminado en vivo y narración de cada operación."
    )}

      <div class="stack">
        <div class="row-between">
          <div class="segmented" id="exp-alg-seg">
            <button type="button" data-alg="bfs" class="${STATE.exploreAlg === "bfs" ? "active" : ""}">BFS</button>
            <button type="button" data-alg="bellman_ford" class="${STATE.exploreAlg === "bellman_ford" ? "active" : ""}">Bellman-Ford</button>
            <button type="button" data-alg="edmonds_karp" class="${STATE.exploreAlg === "edmonds_karp" ? "active" : ""}">Edmonds-Karp</button>
          </div>
          <div class="row">
            <span class="chip">${KF.COMPLEJIDAD[STATE.exploreAlg].tiempo} tiempo</span>
            <span class="chip">${KF.COMPLEJIDAD[STATE.exploreAlg].espacio} espacio</span>
          </div>
        </div>

        <div id="exp-config"></div>

        <div class="grid-explore">
          <div class="canvas-card">
            <div class="canvas-title" id="exp-title"></div>
            <div class="canvas-wrap"><canvas id="exp-canvas"></canvas></div>
            <div id="exp-legend"></div>
            <div id="exp-controls"></div>
          </div>

          <div class="pseudo-panel">
            <div class="row-between">
              <strong style="font-size:14px">Pseudocódigo · ${KF.NOMBRE[STATE.exploreAlg]}</strong>
              <span class="chip chip-sans" id="exp-step-badge">Paso 1</span>
            </div>
            <div class="pseudo-narration" id="exp-narration" aria-live="polite"></div>
            <div class="pseudo-code" id="exp-code"></div>
            <div class="pseudo-stats" id="exp-stats"></div>
          </div>
        </div>
      </div>
    `;

    main.querySelectorAll("#exp-alg-seg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        STATE.exploreAlg = btn.dataset.alg;
        navigate("explorar");
      });
    });

    const configEl = main.querySelector("#exp-config");
    const codeEl = main.querySelector("#exp-code");
    const narrEl = main.querySelector("#exp-narration");
    const statsEl = main.querySelector("#exp-stats");
    const badgeEl = main.querySelector("#exp-step-badge");
    const titleEl = main.querySelector("#exp-title");
    const legendEl = main.querySelector("#exp-legend");

    const lines = KF.PSEUDO[STATE.exploreAlg];
    codeEl.innerHTML = lines
      .map(
        (ln, i) =>
          `<div class="pseudo-line" data-ln="${i}"><span class="ln">${i + 1}</span><span>${ln}</span></div>`
      )
      .join("");

    function highlightLine(idx) {
      codeEl.querySelectorAll(".pseudo-line").forEach((el) => {
        el.classList.toggle("active", parseInt(el.dataset.ln, 10) === idx);
      });
    }

    if (STATE.exploreAlg === "edmonds_karp") {
      const destOpts = KF.ZONAS.filter((z) => z !== STATE.ekOrigen);
      if (!destOpts.includes(STATE.ekDestino)) STATE.ekDestino = destOpts[destOpts.length - 1];

      configEl.innerHTML = `
        <div class="card">
          <div class="row">
            <div class="control-group" style="flex:1;min-width:220px">
              <span class="control-label">Desde la zona (fuente s)</span>
              <select id="ek-origen" class="select">
                ${KF.ZONAS.map((z) => `<option value="${z}" ${z === STATE.ekOrigen ? "selected" : ""}>${z}</option>`).join("")}
              </select>
            </div>
            <div class="control-group" style="flex:1;min-width:220px">
              <span class="control-label">Hasta la zona (sumidero t)</span>
              <select id="ek-destino" class="select">
                ${destOpts.map((z) => `<option value="${z}" ${z === STATE.ekDestino ? "selected" : ""}>${z}</option>`).join("")}
              </select>
            </div>
          </div>
          <p class="card-note" style="margin:10px 0 0">
            Edmonds-Karp calcula la capacidad máxima en unidades de flujo que puede circular simultáneamente de una zona a otra
            (capacidad por pasillo según congestión: Baja = 3, Media = 2, Alta = 1) y marca los pasillos saturados del corte mínimo.
          </p>
        </div>
      `;

      configEl.querySelector("#ek-origen").addEventListener("change", (ev) => {
        STATE.ekOrigen = ev.target.value;
        navigate("explorar");
      });
      configEl.querySelector("#ek-destino").addEventListener("change", (ev) => {
        STATE.ekDestino = ev.target.value;
        navigate("explorar");
      });

      const caps = data.buildCapacities(null);
      const ekSteps = [];
      const res = KF.edmondsKarpBetweenZones(caps, data.nodos, STATE.ekOrigen, STATE.ekDestino, ekSteps);

      // Construir cuadros acumulativos
      const flowFrames = [];
      const accEdges = new Map();
      let accFlow = 0;
      flowFrames.push({
        edges: new Map(),
        aug: [],
        cut: [],
        flow: 0,
        delta: 0,
        line: 0,
        narration: `Red residual inicializada desde ${STATE.ekOrigen} hasta ${STATE.ekDestino}.`,
      });
      for (let i = 0; i < ekSteps.length; i++) {
        const st = ekSteps[i];
        accFlow += st.delta;
        for (let j = 0; j < st.path.length - 1; j++) {
          const k = KF.edgeKey(st.path[j], st.path[j + 1]);
          accEdges.set(k, (accEdges.get(k) || 0) + st.delta);
        }
        flowFrames.push({
          edges: new Map(accEdges),
          aug: st.path,
          cut: [],
          flow: accFlow,
          delta: st.delta,
          line: 4,
          narration: `Camino de aumento #${i + 1}: BFS halló una ruta de ${st.path.length - 1} pasillos con cuello δ = ${st.delta} unidades de flujo. Flujo acumulado = ${accFlow}.`,
        });
      }
      flowFrames.push({
        edges: new Map(accEdges),
        aug: [],
        cut: res.minCut,
        flow: res.maxFlow,
        delta: 0,
        line: 7,
        narration: `Sin más caminos en la red residual. Flujo máximo = ${res.maxFlow} unidades de flujo; corte mínimo = ${res.minCut.length} pasillos cuello de botella.`,
      });

      titleEl.textContent = `Edmonds-Karp · ${STATE.ekOrigen} → ${STATE.ekDestino}`;
      legendEl.innerHTML = renderLegend([
        { color: KF.PALETA.FRENTE, label: "Camino de aumento actual" },
        { color: KF.PALETA.ALGORITMO.bellman_ford, label: "Flujo acumulado" },
        { color: KF.PALETA.ALGORITMO.edmonds_karp, label: "Corte mínimo (cuellos de botella)" },
      ]);

      const canvas = new KF.WarehouseCanvas(main.querySelector("#exp-canvas"), data, {
        width: 760,
        height: 460,
      });

      const ctrl = new KF.PlaybackController(
        main.querySelector("#exp-controls"),
        flowFrames.length,
        (idx) => {
          const f = flowFrames[idx];
          badgeEl.textContent = `Paso ${idx + 1} / ${flowFrames.length}`;
          narrEl.textContent = f.narration;
          highlightLine(f.line);
          statsEl.innerHTML = `
            <div class="pseudo-stat"><div class="card-label">Flujo acumulado</div><div class="val">${f.flow} u. flujo</div></div>
            <div class="pseudo-stat"><div class="card-label">Caminos hallados</div><div class="val">${Math.min(idx, ekSteps.length)}</div></div>
            <div class="pseudo-stat"><div class="card-label">Cuello δ actual</div><div class="val">${f.delta || "—"}</div></div>
            <div class="pseudo-stat"><div class="card-label">Aristas corte mín.</div><div class="val">${f.cut.length || "—"}</div></div>
          `;
          canvas.render({
            flowEdges: f.edges,
            augmentingPath: f.aug,
            minCut: f.cut,
          });
        },
        130
      );
      registerCleanup(() => {
        ctrl.destroy();
        canvas.destroy();
      });
      return;
    }

    // BFS o Bellman-Ford
    configEl.innerHTML = `
      <details class="kf-details">
        <summary>Puntos: inicio <strong>${STATE.inicio}</strong> · ${STATE.destinos.length} destinos · hora ${STATE.perfil}</summary>
        <div id="exp-selector-inner"></div>
      </details>
    `;
    mountPointSelector(configEl.querySelector("#exp-selector-inner"), data, () => navigate("explorar"));

    if (!STATE.inicio || STATE.destinos.length === 0) {
      titleEl.textContent = "Marca un inicio y al menos un destino para explorar.";
      return;
    }

    const blockedSet = new Set(STATE.bloqueados);
    const r = KF.rutaPedido(
      data,
      STATE.perfil,
      STATE.inicio,
      STATE.destinos,
      STATE.exploreAlg,
      true,
      STATE.regresar,
      blockedSet
    );
    const frames = KF.buildSearchFrames(r.segments, STATE.exploreAlg, data, 180);
    const met = KF.medirRuta(r.path, data.edgeMap, STATE.perfil);

    const orderedDests =
      r.order && r.order.length === STATE.destinos.length ? r.order : STATE.destinos;
    titleEl.textContent = r.unreachable
      ? `${KF.NOMBRE[STATE.exploreAlg]} · Ruta parcial (algunos destinos están bloqueados por ×)`
      : `${KF.NOMBRE[STATE.exploreAlg]} · ${met.tiempoS} s (${met.pasillos} pasillos · ${met.distFisica} m)`;
    legendEl.innerHTML = renderLegend([
      { color: KF.PALETA.ALGORITMO[STATE.exploreAlg], label: `Ruta ${KF.NOMBRE[STATE.exploreAlg]}` },
      { color: KF.PALETA.ALGORITMO_CLARO[STATE.exploreAlg], label: "Explorados / relajados" },
      { color: KF.PALETA.FRENTE, label: "Frente activo" },
      { dot: true, color: KF.PALETA.TINTA, label: "Inicio" },
      { dot: true, color: "#FFFFFF", border: KF.PALETA.TINTA, label: "Destinos" },
    ]);

    const canvas = new KF.WarehouseCanvas(main.querySelector("#exp-canvas"), data, {
      width: 760,
      height: 460,
    });

    const ctrl = new KF.PlaybackController(
      main.querySelector("#exp-controls"),
      frames.length,
      (idx) => {
        const f = frames[idx];
        badgeEl.textContent = `Cuadro ${idx + 1} / ${frames.length}`;
        narrEl.textContent = f.narration;
        highlightLine(f.line);
        const c = f.counters;
        statsEl.innerHTML =
          STATE.exploreAlg === "bfs"
            ? `
            <div class="pseudo-stat"><div class="card-label">Tramo</div><div class="val">${c.tramo}</div></div>
            <div class="pseudo-stat"><div class="card-label">Nodos visitados</div><div class="val">${KF.formatNum(c.visitados)}</div></div>
            <div class="pseudo-stat"><div class="card-label">Nivel (pasillos)</div><div class="val">${c.nivel}</div></div>
            <div class="pseudo-stat"><div class="card-label">Aristas revisadas</div><div class="val">${KF.formatNum(c.aristas)}</div></div>
          `
            : `
            <div class="pseudo-stat"><div class="card-label">Tramo</div><div class="val">${c.tramo}</div></div>
            <div class="pseudo-stat"><div class="card-label">Ronda actual</div><div class="val">${c.ronda}</div></div>
            <div class="pseudo-stat"><div class="card-label">Relajaciones</div><div class="val">${KF.formatNum(c.relajaciones)}</div></div>
            <div class="pseudo-stat"><div class="card-label">Aristas revisadas</div><div class="val">${KF.formatNum(c.aristas)}</div></div>
          `;
        canvas.render({
          start: STATE.inicio,
          destinations: orderedDests,
          blockedList: STATE.bloqueados,
          visited: f.visited,
          visitedColor: KF.PALETA.ALGORITMO_CLARO[STATE.exploreAlg],
          frontier: f.frontier,
          path: f.path,
          pathColor: KF.PALETA.ALGORITMO[STATE.exploreAlg],
        });
      },
      115
    );
    registerCleanup(() => {
      ctrl.destroy();
      canvas.destroy();
    });
  }

  /* =======================================================
     3. SIMULAR (Vista unificada: Pedido individual o Turno completo)
     ======================================================= */
  function renderUnifiedSimular(main, data) {
    const s = STATE.sim;
    s.escala = s.escala || "pedido";

    main.innerHTML = `
      ${pageHeader(
      "Simular",
      "y comparar",
      "Analiza y compara los algoritmos en un pedido individual (con selección de puntos y bloqueos × en el mapa) o en un turno completo de múltiples operarios con flujo máximo y corte mínimo."
    )}
      <div class="stack">
        <div class="card row-between">
          <div>
            <strong>Escala del laboratorio</strong>
            <div class="card-note">Elige entre simular un pedido específico paso a paso o un turno completo con múltiples operarios simultáneos.</div>
          </div>
          <div class="segmented" id="sim-escala-seg">
            <button type="button" data-escala="pedido" class="${s.escala === "pedido" ? "active" : ""}">Pedido individual (BFS vs. Bellman-Ford)</button>
            <button type="button" data-escala="turno" class="${s.escala === "turno" ? "active" : ""}">Turno completo (Multi-operario + Edmonds-Karp)</button>
          </div>
        </div>
        <div id="sim-escala-body"></div>
      </div>
    `;

    main.querySelectorAll("#sim-escala-seg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.escala = btn.dataset.escala;
        navigate("simular");
      });
    });

    const bodyEl = main.querySelector("#sim-escala-body");
    if (s.escala === "pedido") {
      renderCompararInner(bodyEl, data);
    } else {
      renderTurnoInner(bodyEl, data);
    }
  }

  function renderCompararInner(main, data) {
    main.innerHTML = `
      <div class="stack">
        <div class="card" id="cmp-selector"></div>
        <div id="cmp-results"></div>
      </div>
    `;

    mountPointSelector(main.querySelector("#cmp-selector"), data, () => {
      STATE.sim.escala = "pedido";
      navigate("simular");
    });

    const resEl = main.querySelector("#cmp-results");
    if (!STATE.inicio || STATE.destinos.length === 0) {
      resEl.innerHTML = `
        <div class="card row-between">
          <div>
            <strong>Sin destinos seleccionados</strong>
            <div class="card-note">Marca al menos un rack en el mapa o carga un pedido de ejemplo para comparar BFS y Bellman-Ford.</div>
          </div>
          <button type="button" id="cmp-load-sample" class="btn btn-primary">Cargar pedido de ejemplo</button>
        </div>
      `;
      resEl.querySelector("#cmp-load-sample").addEventListener("click", () => {
        STATE.inicio = "F22_C39";
        STATE.destinos = ["F05_C05", "F39_C10", "F11_C29"];
        STATE.sim.escala = "pedido";
        saveSessionState();
        navigate("simular");
      });
      return;
    }

    const blockedSet = new Set(STATE.bloqueados);
    const results = {};
    for (const alg of ["bfs", "bellman_ford"]) {
      const t0 = performance.now();
      const r = KF.rutaPedido(data, STATE.perfil, STATE.inicio, STATE.destinos, alg, true, STATE.regresar, blockedSet);
      const ms = performance.now() - t0;
      const m = KF.medirRuta(r.path, data.edgeMap, STATE.perfil);
      const frames = KF.buildSearchFrames(r.segments, alg, data, 120);
      results[alg] = { r, m, ms, frames, work: frames[frames.length - 1].work };
    }

    const b = results.bfs;
    const f = results.bellman_ford;
    const ahorro = b.m.tiempoS - f.m.tiempoS;
    const pct = b.m.tiempoS > 0 ? (100 * ahorro) / b.m.tiempoS : 0;
    const veces = f.work / Math.max(1, b.work);

    const conclusion =
      b.r.unreachable || f.r.unreachable
        ? `<strong>Atención:</strong> los bloqueos (×) colocados en el mapa impiden alcanzar todos los destinos seleccionados (${b.r.order.length} de ${STATE.destinos.length} alcanzados). Quita o mueve algún bloqueo para completar el pedido.`
        : ahorro > 0.05
          ? `<strong>Bellman-Ford ahorra ${ahorro.toFixed(1)} s</strong> de caminata (${pct.toFixed(1)} %) esquivando pasillos congestionados (${f.m.alta} tramos de congestión alta frente a ${b.m.alta} de BFS), pero revisa <strong>${veces.toFixed(0)}× más aristas</strong> que BFS.`
          : `Ambas rutas cuestan prácticamente lo mismo en este trayecto (el camino mínimo en pasillos no atravesaba congestión crítica), pero Bellman-Ford revisó <strong>${veces.toFixed(0)}× más aristas</strong>.`;

    // Construir línea de tiempo en 2 fases para que AMBOS mapas tengan animación completa:
    // Fase 1 (50 cuadros): Exploración de ondas (escala progresiva donde se ve la onda completa de BFS y la de Bellman-Ford).
    // Fase 2 (45 cuadros): Carrera en tiempo real de caminata (los dos operarios recorren sus rutas según los segundos de cada pasillo).
    const searchPhaseFrames = 50;
    const walkPhaseFrames = 45;
    const totalSyncFrames = searchPhaseFrames + walkPhaseFrames;
    const maxWork = Math.max(b.work, f.work, 1);

    function frameAtWork(frames, targetWork) {
      let chosen = frames[0];
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].work <= targetWork) chosen = frames[i];
        else break;
      }
      return chosen;
    }

    function buildWalkTimeline(path) {
      const cumTimes = [0];
      let acc = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const e = data.edgeMap.get(KF.edgeKey(path[i], path[i + 1]));
        const dt = e ? (STATE.perfil === "valle" ? e.tiempoValle : e.tiempoPunta) : 1.5;
        acc += dt;
        cumTimes.push(acc);
      }
      return { path, cumTimes, totalTime: acc };
    }

    function walkStateAtTime(tl, tSec) {
      if (tl.path.length <= 1) return { walked: tl.path, worker: tl.path[0], done: true };
      let idx = 0;
      while (idx < tl.cumTimes.length - 1 && tl.cumTimes[idx + 1] <= tSec) {
        idx++;
      }
      return {
        walked: tl.path.slice(0, idx + 1),
        worker: tl.path[idx],
        done: tSec >= tl.totalTime - 0.05,
        timeNow: Math.min(tSec, tl.totalTime),
      };
    }

    const tlBfs = buildWalkTimeline(b.r.path);
    const tlBf = buildWalkTimeline(f.r.path);
    const maxWalkTime = Math.max(tlBfs.totalTime, tlBf.totalTime, 1);

    resEl.innerHTML = `
      <div class="stack">
        <div class="canvas-card" style="padding:22px 24px">
          <div class="row-between" style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div>
              <div class="canvas-title" style="font-size:1.35rem">Sincronizados por trabajo (aristas revisadas)</div>
              <div class="canvas-subtitle" style="margin-bottom:0">
                Ambos mapas avanzan al mismo ritmo de trabajo computacional: BFS termina casi de inmediato mientras Bellman-Ford continúa relajando pasillos.
              </div>
            </div>
            <span class="chip chip-dark" id="cmp-work-chip" style="font-size:13px;padding:5px 12px">0 aristas</span>
          </div>

          <div class="grid-2" style="gap:22px">
            ${["bfs", "bellman_ford"]
        .map((alg) => {
          const d = results[alg];
          const stId = alg === "bfs" ? "cmp-bfs-st" : "cmp-bf-st";
          const cvId = alg === "bfs" ? "cmp-bfs-canvas" : "cmp-bf-canvas";
          return `
              <div class="stack" style="gap:12px">
                <div class="row-between">
                  <div class="row">
                    <h3 style="color:${KF.PALETA.ALGORITMO[alg]}">${KF.NOMBRE[alg]}</h3>
                    <span class="chip">${KF.COMPLEJIDAD[alg].tiempo}</span>
                    <span class="chip">espacio ${KF.COMPLEJIDAD[alg].espacio}</span>
                  </div>
                  <span class="chip" id="${stId}">en curso</span>
                </div>
                <div class="mini-metrics">
                  <div class="mini-metric"><div class="card-label">Caminata</div><div class="card-num">${d.m.tiempoS} s</div></div>
                  <div class="mini-metric"><div class="card-label">Dist. ajustada</div><div class="card-num">${d.m.distAjustada} m</div></div>
                  <div class="mini-metric"><div class="card-label">Dist. física (${d.m.pasillos})</div><div class="card-num">${d.m.distFisica} m</div></div>
                  <div class="mini-metric"><div class="card-label">Cálculo</div><div class="card-num">${d.ms.toFixed(1)} ms</div></div>
                </div>
                <div class="canvas-wrap"><canvas id="${cvId}"></canvas></div>
              </div>`;
        })
        .join("")}
          </div>

          <div id="cmp-controls" style="margin-top:6px"></div>
        </div>

        <div class="card stack" style="gap:16px">
          <div class="grid-3" style="gap:22px">
            <div>
              ${renderBars(
          "Tiempo de caminata (s)",
          [
            { alg: "bfs", val: b.m.tiempoS },
            { alg: "bellman_ford", val: f.m.tiempoS },
          ],
          (v) => `${v.toFixed(1)} s`
        )}
            </div>
            <div>
              ${renderBars(
          "Aristas revisadas",
          [
            { alg: "bfs", val: b.work },
            { alg: "bellman_ford", val: f.work },
          ],
          (v) => KF.formatNum(v)
        )}
            </div>
            <div>
              ${renderBars(
          "Tiempo de cálculo (ms)",
          [
            { alg: "bfs", val: b.ms },
            { alg: "bellman_ford", val: f.ms },
          ],
          (v) => `${v.toFixed(1)} ms`,
          "depende de la PC"
        )}
            </div>
          </div>
          <div class="conclusion-box">${conclusion}</div>
        </div>
      </div>
    `;

    const cBfs = new KF.WarehouseCanvas(resEl.querySelector("#cmp-bfs-canvas"), data, {
      width: 640,
      height: 440,
    });
    const cBf = new KF.WarehouseCanvas(resEl.querySelector("#cmp-bf-canvas"), data, {
      width: 640,
      height: 440,
    });
    const workChip = resEl.querySelector("#cmp-work-chip");
    const bfsSt = resEl.querySelector("#cmp-bfs-st");
    const bfSt = resEl.querySelector("#cmp-bf-st");

    const ctrl = new KF.PlaybackController(
      resEl.querySelector("#cmp-controls"),
      totalSyncFrames,
      (idx) => {
        const bDests = b.r.order && b.r.order.length === STATE.destinos.length ? b.r.order : STATE.destinos;
        const fDests = f.r.order && f.r.order.length === STATE.destinos.length ? f.r.order : STATE.destinos;

        if (idx < searchPhaseFrames) {
          // Fase 1: Exploración de ondas (primeros 24 cuadros muestran toda la onda de BFS paso a paso; luego B-F termina sus rondas)
          const bfsIdx = Math.min(b.frames.length - 1, Math.round((idx / 23) * (b.frames.length - 1)));
          const fb = b.frames[bfsIdx];
          const wNow =
            idx <= 23
              ? Math.round((idx / 23) * b.work)
              : Math.round(b.work + ((idx - 23) / (searchPhaseFrames - 1 - 23)) * Math.max(0, maxWork - b.work));
          const ff = frameAtWork(f.frames, Math.max(wNow, Math.round((idx / (searchPhaseFrames - 1)) * f.work)));

          workChip.textContent = `Fase 1 · Exploración: ${KF.formatNum(Math.max(fb.work, ff.work))} aristas`;
          bfsSt.textContent = idx >= 23 ? `ruta lista ✓ (${KF.formatNum(b.work)} aristas)` : `explorando · ${KF.formatNum(fb.work)} aristas`;
          bfSt.textContent = idx >= searchPhaseFrames - 1 ? `ruta lista ✓ (${KF.formatNum(f.work)} aristas)` : `relajando · ${KF.formatNum(ff.work)} aristas`;

          cBfs.render({
            start: STATE.inicio,
            destinations: bDests,
            blockedList: STATE.bloqueados,
            visited: fb.visited,
            visitedColor: KF.PALETA.ALGORITMO_CLARO.bfs,
            frontier: idx >= 23 ? null : fb.frontier,
            path: fb.path,
            pathColor: KF.PALETA.ALGORITMO.bfs,
          });
          cBf.render({
            start: STATE.inicio,
            destinations: fDests,
            blockedList: STATE.bloqueados,
            visited: ff.visited,
            visitedColor: KF.PALETA.ALGORITMO_CLARO.bellman_ford,
            frontier: idx >= searchPhaseFrames - 1 ? null : ff.frontier,
            path: ff.path,
            pathColor: KF.PALETA.ALGORITMO.bellman_ford,
          });
        } else {
          // Fase 2: Carrera en tiempo real de caminata de ambos operarios sobre las rutas calculadas
          const walkStep = idx - searchPhaseFrames;
          const tSec = (walkStep / Math.max(1, walkPhaseFrames - 1)) * maxWalkTime;
          const wb = walkStateAtTime(tlBfs, tSec);
          const wf = walkStateAtTime(tlBf, tSec);

          workChip.textContent = `Fase 2 · Caminata en vivo: ${tSec.toFixed(1)} s / ${maxWalkTime.toFixed(1)} s`;
          bfsSt.textContent = wb.done ? `llegó en ${tlBfs.totalTime.toFixed(1)} s ✓` : `caminando · ${wb.timeNow.toFixed(1)} s`;
          bfSt.textContent = wf.done ? `¡llegó en ${tlBf.totalTime.toFixed(1)} s! ✓` : `caminando · ${wf.timeNow.toFixed(1)} s`;

          cBfs.render({
            start: STATE.inicio,
            destinations: bDests,
            blockedList: STATE.bloqueados,
            secondaryPath: b.r.path,
            secondaryColor: "rgba(51, 101, 160, 0.32)",
            path: wb.walked,
            pathColor: KF.PALETA.ALGORITMO.bfs,
            workers: [{ node: wb.worker, color: KF.PALETA.ALGORITMO.bfs, radius: 6.4 }],
          });
          cBf.render({
            start: STATE.inicio,
            destinations: fDests,
            blockedList: STATE.bloqueados,
            secondaryPath: f.r.path,
            secondaryColor: "rgba(0, 41, 107, 0.25)",
            path: wf.walked,
            pathColor: KF.PALETA.ALGORITMO.bellman_ford,
            workers: [{ node: wf.worker, color: KF.PALETA.ALGORITMO.bellman_ford, radius: 6.4 }],
          });
        }
      },
      75
    );
    // Reproducir automáticamente al entrar o cambiar puntos para que ambos mapas cobren vida de inmediato
    ctrl.play(1);

    registerCleanup(() => {
      ctrl.destroy();
      cBfs.destroy();
      cBf.destroy();
    });
  }

  /* =======================================================
     Sub-modo Turno completo (Individual o Comparativa A vs B)
     ======================================================= */
  function renderTurnoInner(main, data) {
    const s = STATE.sim;
    s.modo = s.modo || "comparar";
    s.algA = s.algA || "bfs";
    s.algB = s.algB || "bellman_ford";
    s.vistaCmp = s.vistaCmp || "calor";
    const destOpts = KF.ZONAS.filter((z) => z !== s.zOrigen);
    if (!destOpts.includes(s.zDestino)) s.zDestino = destOpts[destOpts.length - 1];

    const modelos = KF.MODELOS_SIM || {
      bfs: "BFS (Menos pasillos)",
      bellman_ford: "Bellman-Ford (Menor tiempo)",
      edmonds_karp: "Edmonds-Karp + B-F (Anti-cuellos)",
    };
    const usaBf =
      (s.modo === "individual" && s.alg !== "bfs") ||
      (s.modo === "comparar" && (s.algA !== "bfs" || s.algB !== "bfs"));
    const maxOpsPermitidos = usaBf ? 15 : 45;
    if (s.nOps > maxOpsPermitidos) s.nOps = 10;

    main.innerHTML = `
      <div class="stack">
        <div class="card stack">
          <div class="row-between" style="padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div class="control-group">
              <span class="control-label">Modo de simulación</span>
              <div class="segmented" id="sim-modo">
                <button type="button" data-val="individual" class="${s.modo === "individual" ? "active" : ""}">Un solo modelo</button>
                <button type="button" data-val="comparar" class="${s.modo === "comparar" ? "active" : ""}">Comparar 2 modelos (a elección)</button>
              </div>
            </div>

            ${s.modo === "individual"
        ? `
              <div class="control-group" style="min-width:260px">
                <span class="control-label">Modelo que usan los operarios</span>
                <select id="sim-alg-select" class="select">
                  ${Object.entries(modelos)
          .map(([k, lbl]) => `<option value="${k}" ${s.alg === k ? "selected" : ""}>${lbl}</option>`)
          .join("")}
                </select>
              </div>`
        : `
              <div class="row" style="gap:12px">
                <div class="control-group" style="min-width:230px">
                  <span class="control-label">Modelo A (Izquierda)</span>
                  <select id="sim-alga" class="select">
                    ${Object.entries(modelos)
          .map(([k, lbl]) => `<option value="${k}" ${s.algA === k ? "selected" : ""}>${lbl}</option>`)
          .join("")}
                  </select>
                </div>
                <div class="control-group" style="min-width:230px">
                  <span class="control-label">Modelo B (Derecha)</span>
                  <select id="sim-algb" class="select">
                    ${Object.entries(modelos)
          .filter(([k]) => k !== s.algA)
          .map(([k, lbl]) => `<option value="${k}" ${s.algB === k ? "selected" : ""}>${lbl}</option>`)
          .join("")}
                  </select>
                </div>
              </div>`
      }
          </div>

          <div class="grid-3">
            <div class="control-group">
              <span class="control-label">Operarios: <strong id="sim-nops-val">${s.nOps}</strong> (máx. ${maxOpsPermitidos})</span>
              <input type="range" id="sim-nops" class="range-slider" min="5" max="${maxOpsPermitidos}" value="${s.nOps}" />
            </div>

            <div class="control-group">
              <span class="control-label">Productos máx./pedido: <strong id="sim-maxp-val">${s.maxProd}</strong></span>
              <input type="range" id="sim-maxp" class="range-slider" min="1" max="5" value="${s.maxProd}" />
            </div>

            <div class="control-group">
              <span class="control-label">Escenario horario</span>
              <div class="segmented" id="sim-hora">
                <button type="button" data-val="punta" class="${s.hora === "punta" ? "active" : ""}">Hora punta</button>
                <button type="button" data-val="valle" class="${s.hora === "valle" ? "active" : ""}">Hora valle</button>
              </div>
            </div>
          </div>

          <div class="row-between">
            <div class="row" style="flex:1">
              <div class="control-group" style="min-width:210px;flex:1">
                <span class="control-label">Flujo Edmonds-Karp desde</span>
                <select id="sim-zo" class="select">
                  ${KF.ZONAS.map((z) => `<option value="${z}" ${z === s.zOrigen ? "selected" : ""}>${z}</option>`).join("")}
                </select>
              </div>
              <div class="control-group" style="min-width:210px;flex:1">
                <span class="control-label">hasta</span>
                <select id="sim-zd" class="select">
                  ${destOpts.map((z) => `<option value="${z}" ${z === s.zDestino ? "selected" : ""}>${z}</option>`).join("")}
                </select>
              </div>
              <div class="control-group" style="width:96px">
                <span class="control-label">Semilla</span>
                <input type="number" id="sim-seed" class="input" min="0" max="9999" value="${s.semilla}" />
              </div>
            </div>
            <div class="control-group">
              <span class="control-label">&nbsp;</span>
              <button type="button" id="sim-run" class="btn btn-primary">Simular turno</button>
            </div>
          </div>
        </div>

        <div id="sim-output"></div>
      </div>
    `;

    main.querySelectorAll("#sim-modo button").forEach((b) => {
      b.addEventListener("click", () => {
        s.modo = b.dataset.val;
        s.result = null;
        s.resultCmp = null;
        navigate("simular");
      });
    });

    const algSel = main.querySelector("#sim-alg-select");
    if (algSel) {
      algSel.addEventListener("change", (ev) => {
        s.alg = ev.target.value;
        s.result = null;
        navigate("simular");
      });
    }

    const algASel = main.querySelector("#sim-alga");
    const algBSel = main.querySelector("#sim-algb");
    if (algASel && algBSel) {
      algASel.addEventListener("change", (ev) => {
        s.algA = ev.target.value;
        if (s.algB === s.algA) {
          s.algB = Object.keys(modelos).find((k) => k !== s.algA) || "bellman_ford";
        }
        s.resultCmp = null;
        navigate("simular");
      });
      algBSel.addEventListener("change", (ev) => {
        s.algB = ev.target.value;
        s.resultCmp = null;
        navigate("simular");
      });
    }

    main.querySelectorAll("#sim-hora button").forEach((b) => {
      b.addEventListener("click", () => {
        s.hora = b.dataset.val;
        main.querySelectorAll("#sim-hora button").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
    main.querySelector("#sim-nops").addEventListener("input", (ev) => {
      s.nOps = parseInt(ev.target.value, 10);
      main.querySelector("#sim-nops-val").textContent = s.nOps;
    });
    main.querySelector("#sim-maxp").addEventListener("input", (ev) => {
      s.maxProd = parseInt(ev.target.value, 10);
      main.querySelector("#sim-maxp-val").textContent = s.maxProd;
    });
    main.querySelector("#sim-zo").addEventListener("change", (ev) => {
      s.zOrigen = ev.target.value;
      s.result = null;
      s.resultCmp = null;
      navigate("simular");
    });
    main.querySelector("#sim-zd").addEventListener("change", (ev) => {
      s.zDestino = ev.target.value;
    });
    main.querySelector("#sim-seed").addEventListener("change", (ev) => {
      s.semilla = parseInt(ev.target.value, 10) || 1;
    });

    const outEl = main.querySelector("#sim-output");

    function runAndShow() {
      outEl.innerHTML = renderSkeletonBlock(4, false);
      setTimeout(() => {
        if (s.modo === "comparar") {
          if (s.algB === s.algA) {
            s.algB = Object.keys(modelos).find((k) => k !== s.algA) || "bellman_ford";
          }
          const rA = KF.simularTurno(data, {
            alg: s.algA,
            nOps: s.nOps,
            maxProd: s.maxProd,
            hora: s.hora,
            zonaOrigen: s.zOrigen,
            zonaDestino: s.zDestino,
            semilla: s.semilla,
          });
          const rB = KF.simularTurno(data, {
            alg: s.algB,
            nOps: s.nOps,
            maxProd: s.maxProd,
            hora: s.hora,
            zonaOrigen: s.zOrigen,
            zonaDestino: s.zDestino,
            semilla: s.semilla,
          });
          s.resultCmp = { rA, rB };
          renderSimCompareResult(outEl, data, s, modelos);
        } else {
          s.result = KF.simularTurno(data, {
            alg: s.alg,
            nOps: s.nOps,
            maxProd: s.maxProd,
            hora: s.hora,
            zonaOrigen: s.zOrigen,
            zonaDestino: s.zDestino,
            semilla: s.semilla,
          });
          renderSimResult(outEl, data, s);
        }
      }, 60);
    }

    main.querySelector("#sim-run").addEventListener("click", runAndShow);

    if (s.modo === "comparar" && s.resultCmp) {
      renderSimCompareResult(outEl, data, s, modelos);
    } else if (s.modo === "individual" && s.result) {
      renderSimResult(outEl, data, s);
    } else {
      runAndShow();
    }
  }

  function renderSimCompareResult(outEl, data, s, modelos) {
    const { rA, rB } = s.resultCmp;
    const nameA = modelos[s.algA] || KF.NOMBRE[s.algA];
    const nameB = modelos[s.algB] || KF.NOMBRE[s.algB];
    const colorA = KF.PALETA.ALGORITMO[s.algA] || KF.PALETA.TINTA;
    const colorB = KF.PALETA.ALGORITMO[s.algB] || KF.PALETA.ALGORITMO.bellman_ford;

    const diffTime = rA.avgTimeS - rB.avgTimeS;
    const fasterName = diffTime > 0.1 ? nameB : diffTime < -0.1 ? nameA : "Ambos";
    const betterFlowName =
      rB.flowRes.maxFlow > rA.flowRes.maxFlow
        ? `${nameB} conserva mayor capacidad (${rB.flowRes.maxFlow} vs. ${rA.flowRes.maxFlow} unidades de flujo)`
        : rA.flowRes.maxFlow > rB.flowRes.maxFlow
        ? `${nameA} conserva mayor capacidad (${rA.flowRes.maxFlow} vs. ${rB.flowRes.maxFlow} unidades de flujo)`
        : `ambos mantienen un flujo máximo de ${rA.flowRes.maxFlow} unidades de flujo`;

    const conclusion = `Sobre los mismos <strong>${rA.operators.length} pedidos</strong> (semilla #${s.semilla}): <strong>${fasterName}</strong> logra menor tiempo medio de caminata por operario (<strong>${rA.avgTimeS} s</strong> en ${KF.NOMBRE[s.algA]} vs. <strong>${rB.avgTimeS} s</strong> en ${KF.NOMBRE[s.algB]}), mientras que tras la congestión del turno <strong>${betterFlowName}</strong> entre <em>${s.zOrigen}</em> y <em>${s.zDestino}</em>.`;

    outEl.innerHTML = `
      <div class="stack">
        <div class="grid-4">
          <div class="card kpi-1">
            <div class="card-label">Caminata media / operario</div>
            <div class="card-num">${rA.avgTimeS}s<small>vs ${rB.avgTimeS}s</small></div>
            <div class="card-note">${KF.NOMBRE[s.algA]} vs. ${KF.NOMBRE[s.algB]}</div>
          </div>
          <div class="card kpi-2">
            <div class="card-label">Pasillos usados</div>
            <div class="card-num">${rA.usage.size}<small>vs ${rB.usage.size}</small></div>
            <div class="card-note">dispersión de rutas en el almacén</div>
          </div>
          <div class="card kpi-3">
            <div class="card-label">Pasillo más saturado</div>
            <div class="card-num">${rA.maxUsage}<small>vs ${rB.maxUsage}</small></div>
            <div class="card-note">cruces máximos en un solo pasillo</div>
          </div>
          <div class="card kpi-4">
            <div class="card-label">Flujo máx. (Edmonds-Karp)</div>
            <div class="card-num">${rA.flowRes.maxFlow}<small>vs ${rB.flowRes.maxFlow} u. flujo</small></div>
            <div class="card-note">capacidad base sin turno: ${rA.baseFlow} unidades de flujo</div>
          </div>
        </div>

        <div class="canvas-card" style="padding:22px 24px">
          <div class="row-between" style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div>
              <div class="canvas-title" style="font-size:1.35rem">Comparación de turno en vivo: ${KF.NOMBRE[s.algA]} vs. ${KF.NOMBRE[s.algB]}</div>
              <div class="canvas-subtitle" style="margin-bottom:0">
                Los mismos ${rA.operators.length} operarios y pedidos ejecutados con dos modelos distintos. Alterna entre el mapa de calor y el corte mínimo resultante.
              </div>
            </div>
            <div class="row">
              <div class="segmented" id="sim-cmp-view">
                <button type="button" data-v="calor" class="${s.vistaCmp === "calor" ? "active" : ""}">Mapa de calor y operarios</button>
                <button type="button" data-v="corte" class="${s.vistaCmp === "corte" ? "active" : ""}">Corte mínimo (Edmonds-Karp)</button>
              </div>
              <span class="chip chip-dark" id="sim-cmp-step" style="font-size:13px;padding:5px 12px">Paso 1</span>
            </div>
          </div>

          <div class="grid-2" style="gap:22px">
            <div class="stack" style="gap:12px">
              <div class="row-between">
                <div class="row">
                  <h3 style="color:${colorA}">Modelo A · ${nameA}</h3>
                </div>
                <span class="chip" id="sim-st-a">en curso</span>
              </div>
              <div class="mini-metrics">
                <div class="mini-metric"><div class="card-label">Caminata med.</div><div class="card-num">${rA.avgTimeS} s</div></div>
                <div class="mini-metric"><div class="card-label">Pasillos</div><div class="card-num">${rA.usage.size}</div></div>
                <div class="mini-metric"><div class="card-label">Cruces máx.</div><div class="card-num">${rA.maxUsage}</div></div>
                <div class="mini-metric"><div class="card-label">Flujo E-K</div><div class="card-num">${rA.flowRes.maxFlow}</div></div>
              </div>
              <div class="canvas-wrap"><canvas id="sim-cmp-ca"></canvas></div>
            </div>

            <div class="stack" style="gap:12px">
              <div class="row-between">
                <div class="row">
                  <h3 style="color:${colorB}">Modelo B · ${nameB}</h3>
                </div>
                <span class="chip" id="sim-st-b">en curso</span>
              </div>
              <div class="mini-metrics">
                <div class="mini-metric"><div class="card-label">Caminata med.</div><div class="card-num">${rB.avgTimeS} s</div></div>
                <div class="mini-metric"><div class="card-label">Pasillos</div><div class="card-num">${rB.usage.size}</div></div>
                <div class="mini-metric"><div class="card-label">Cruces máx.</div><div class="card-num">${rB.maxUsage}</div></div>
                <div class="mini-metric"><div class="card-label">Flujo E-K</div><div class="card-num">${rB.flowRes.maxFlow}</div></div>
              </div>
              <div class="canvas-wrap"><canvas id="sim-cmp-cb"></canvas></div>
            </div>
          </div>

          <div id="sim-cmp-ctrl" style="margin-top:6px"></div>
        </div>

        <div class="card stack" style="gap:14px">
          <div class="conclusion-box">${conclusion}</div>
        </div>
      </div>
    `;

    const cA = new KF.WarehouseCanvas(outEl.querySelector("#sim-cmp-ca"), data, {
      width: 640,
      height: 440,
      customLevels: s.vistaCmp === "corte" ? rA.dynamicLevels : null,
      strongCongestion: s.vistaCmp === "corte",
    });
    const cB = new KF.WarehouseCanvas(outEl.querySelector("#sim-cmp-cb"), data, {
      width: 640,
      height: 440,
      customLevels: s.vistaCmp === "corte" ? rB.dynamicLevels : null,
      strongCongestion: s.vistaCmp === "corte",
    });

    const stepChip = outEl.querySelector("#sim-cmp-step");
    const stA = outEl.querySelector("#sim-st-a");
    const stB = outEl.querySelector("#sim-st-b");
    const totalSteps = Math.max(2, rA.maxStep, rB.maxStep);
    const globalMaxUsage = Math.max(1, rA.maxUsage, rB.maxUsage);

    function partialTurnState(res, t, col) {
      const partialUsage = new Map();
      const workers = [];
      let active = 0;
      for (const op of res.operators) {
        const lim = Math.min(t, op.path.length - 1);
        if (t < op.path.length - 1) active++;
        workers.push({ node: op.path[lim], color: col, radius: 4.8 });
        for (let i = 0; i < lim; i++) {
          const k = KF.edgeKey(op.path[i], op.path[i + 1]);
          partialUsage.set(k, (partialUsage.get(k) || 0) + 1);
        }
      }
      return { partialUsage, workers, active };
    }

    const ctrl = new KF.PlaybackController(
      outEl.querySelector("#sim-cmp-ctrl"),
      totalSteps,
      (t) => {
        stepChip.textContent = `Paso ${t + 1} / ${totalSteps}`;
        if (s.vistaCmp === "corte") {
          stA.textContent = `corte mínimo: ${rA.flowRes.minCut.length} pasillos (${rA.flowRes.maxFlow} unidades de flujo)`;
          stB.textContent = `corte mínimo: ${rB.flowRes.minCut.length} pasillos (${rB.flowRes.maxFlow} unidades de flujo)`;
          cA.render({ minCut: rA.flowRes.minCut });
          cB.render({ minCut: rB.flowRes.minCut });
          return;
        }
        const pA = partialTurnState(rA, t, colorA);
        const pB = partialTurnState(rB, t, colorB);
        stA.textContent = pA.active === 0 ? `completado ✓ (${pA.partialUsage.size} pasillos)` : `${pA.active} en ruta · ${pA.partialUsage.size} pasillos`;
        stB.textContent = pB.active === 0 ? `completado ✓ (${pB.partialUsage.size} pasillos)` : `${pB.active} en ruta · ${pB.partialUsage.size} pasillos`;
        cA.render({ usageMap: pA.partialUsage, maxUsage: globalMaxUsage, workers: pA.workers });
        cB.render({ usageMap: pB.partialUsage, maxUsage: globalMaxUsage, workers: pB.workers });
      },
      70
    );
    ctrl.play(1);

    outEl.querySelectorAll("#sim-cmp-view button").forEach((btn) => {
      btn.addEventListener("click", () => {
        s.vistaCmp = btn.dataset.v;
        outEl.querySelectorAll("#sim-cmp-view button").forEach((b) => b.classList.toggle("active", b === btn));
        const isCut = s.vistaCmp === "corte";
        cA.updateCustomLevels(isCut ? rA.dynamicLevels : null, isCut);
        cB.updateCustomLevels(isCut ? rB.dynamicLevels : null, isCut);
        ctrl.pause();
        ctrl.goTo(ctrl.index);
      });
    });

    registerCleanup(() => {
      ctrl.destroy();
      cA.destroy();
      cB.destroy();
    });
  }

  function renderSimResult(outEl, data, s) {
    const r = s.result;
    const ekSteps = r.ekSteps || [];

    // Precalcular cuadros acumulativos de Edmonds-Karp para sincronizarlos con el reloj del turno
    const ekFrames = [{ edges: new Map(), aug: [], cut: [], flow: 0, paths: 0 }];
    const accEdges = new Map();
    let accFlow = 0;
    for (let i = 0; i < ekSteps.length; i++) {
      const st = ekSteps[i];
      accFlow += st.delta;
      for (let j = 0; j < st.path.length - 1; j++) {
        const k = KF.edgeKey(st.path[j], st.path[j + 1]);
        accEdges.set(k, (accEdges.get(k) || 0) + st.delta);
      }
      ekFrames.push({
        edges: new Map(accEdges),
        aug: st.path,
        cut: [],
        flow: accFlow,
        paths: i + 1,
      });
    }
    ekFrames.push({
      edges: new Map(accEdges),
      aug: [],
      cut: r.flowRes.minCut,
      flow: r.flowRes.maxFlow,
      paths: ekSteps.length,
    });

    // Conteo de niveles de congestión resultantes tras el turno
    const lvlCounts = { Baja: 0, Media: 0, Alta: 0 };
    for (const lvl of r.dynamicLevels.values()) {
      lvlCounts[lvl] = (lvlCounts[lvl] || 0) + 1;
    }
    const flowDiff = r.baseFlow - r.flowRes.maxFlow;
    const simConclusion =
      flowDiff > 0
        ? `El tráfico simultáneo de <strong>${r.operators.length} operarios</strong> (${KF.NOMBRE[s.alg]}) elevó a <strong>${KF.formatNum(lvlCounts.Alta)} pasillos</strong> en congestión Alta, reduciendo la capacidad máxima entre <em>${s.zOrigen}</em> y <em>${s.zDestino}</em> de <strong>${r.baseFlow}</strong> a <strong>${r.flowRes.maxFlow} unidades de flujo</strong> (−${flowDiff} unidades de flujo) con un corte mínimo de <strong>${r.flowRes.minCut.length} pasillos</strong>.`
        : `Con <strong>${r.operators.length} operarios</strong> (${KF.NOMBRE[s.alg]}), los cruces adicionales se distribuyeron sin reducir el cuello principal entre <em>${s.zOrigen}</em> y <em>${s.zDestino}</em>, manteniendo un flujo máximo de <strong>${r.flowRes.maxFlow} unidades de flujo</strong> (${r.flowRes.minCut.length} pasillos en el corte mínimo).`;

    outEl.innerHTML = `
      <div class="stack">
        <div class="grid-4">
          <div class="card kpi-1">
            <div class="card-label">Operarios en turno</div>
            <div class="card-num">${r.operators.length}</div>
            <div class="card-note">un pedido cada uno (${KF.NOMBRE[s.alg]} · hora ${s.hora})</div>
          </div>
          <div class="card kpi-2">
            <div class="card-label">Pasillos transitados</div>
            <div class="card-num">${KF.formatNum(r.usage.size)}</div>
            <div class="card-note">de ${KF.formatNum(data.aristas.length)} pasillos totales</div>
          </div>
          <div class="card kpi-3">
            <div class="card-label">Pasillo más cruzado</div>
            <div class="card-num">${r.maxUsage}</div>
            <div class="card-note">cruces acumulados en el turno</div>
          </div>
          <div class="card kpi-4">
            <div class="card-label">Flujo máximo resultante</div>
            <div class="card-num">${r.flowRes.maxFlow}<small>u. flujo</small></div>
            <div class="card-note">capacidad base del dataset: ${r.baseFlow} unidades de flujo</div>
          </div>
        </div>

        <div class="canvas-card" style="padding:22px 24px">
          <div class="row-between" style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <div>
              <div class="canvas-title" style="font-size:1.35rem">Cadena operativa en vivo: Tráfico del turno → Flujo y Corte Mínimo</div>
              <div class="canvas-subtitle" style="margin-bottom:0">
                A la izquierda los operarios recorren el almacén formando el mapa de calor; a la derecha Edmonds-Karp empuja caminos de aumento y revela los cuellos de botella.
              </div>
            </div>
            <span class="chip chip-dark" id="sim-step-chip" style="font-size:13px;padding:5px 12px">Paso 1</span>
          </div>

          <div class="grid-2" style="gap:22px">
            <div class="stack" style="gap:12px">
              <div class="row-between">
                <div class="row">
                  <h3 style="color:${KF.PALETA.ALGORITMO[s.alg]}">1. Movimiento y Mapa de Calor</h3>
                  <span class="chip">${KF.NOMBRE[s.alg]}</span>
                </div>
                <span class="chip" id="sim-turn-st">en curso</span>
              </div>
              <div class="mini-metrics">
                <div class="mini-metric"><div class="card-label">Operarios</div><div class="card-num">${r.operators.length}</div></div>
                <div class="mini-metric"><div class="card-label">Pasillos usados</div><div class="card-num">${KF.formatNum(r.usage.size)}</div></div>
                <div class="mini-metric"><div class="card-label">Cruces máx.</div><div class="card-num">${r.maxUsage}</div></div>
                <div class="mini-metric"><div class="card-label">Duración</div><div class="card-num">${r.maxStep} p.</div></div>
              </div>
              <div class="canvas-wrap"><canvas id="sim-turn-canvas"></canvas></div>
              ${renderLegend([
      { dot: true, color: KF.PALETA.TINTA, label: "Operario activo" },
      { color: KF.PALETA.ALGORITMO.bfs, label: "Tráfico bajo" },
      { color: KF.PALETA.CONGESTION.Alta, label: "Tráfico medio" },
      { color: KF.PALETA.ALGORITMO.edmonds_karp, label: "Tráfico alto" },
    ])}
            </div>

            <div class="stack" style="gap:12px">
              <div class="row-between">
                <div class="row">
                  <h3 style="color:${KF.PALETA.ALGORITMO[s.alg]}">2. Edmonds-Karp · Corte Mínimo</h3>
                  <span class="chip">O(V · E²)</span>
                </div>
                <span class="chip" id="sim-flow-st">calculando</span>
              </div>
              <div class="mini-metrics">
                <div class="mini-metric"><div class="card-label">Flujo turno</div><div class="card-num">${r.flowRes.maxFlow}</div></div>
                <div class="mini-metric"><div class="card-label">Flujo base</div><div class="card-num">${r.baseFlow}</div></div>
                <div class="mini-metric"><div class="card-label">Caminos aum.</div><div class="card-num">${ekSteps.length}</div></div>
                <div class="mini-metric"><div class="card-label">Corte mín.</div><div class="card-num">${r.flowRes.minCut.length}</div></div>
              </div>
              <div class="canvas-wrap"><canvas id="sim-flow-canvas"></canvas></div>
              ${renderLegend([
      { color: KF.PALETA.ALGORITMO.edmonds_karp, label: "Corte mínimo (cuellos de botella)" },
      { color: KF.PALETA.FRENTE, label: "Camino de aumento activo" },
      { color: KF.PALETA.CONGESTION.Alta, label: "Congestión alta del turno" },
    ])}
            </div>
          </div>

          <div id="sim-turn-ctrl" style="margin-top:6px"></div>
        </div>

        <div class="card stack" style="gap:14px">
          <div class="row-between">
            <strong>Impacto del turno sobre la congestión y capacidad entre zonas (${s.zOrigen} → ${s.zDestino})</strong>
            <span class="card-note">Pasillos tras el turno: ${KF.formatNum(lvlCounts.Baja)} Baja (cap. 3) · ${KF.formatNum(lvlCounts.Media)} Media (cap. 2) · ${KF.formatNum(lvlCounts.Alta)} Alta (cap. 1)</span>
          </div>
          <div class="conclusion-box">${simConclusion}</div>
        </div>
      </div>
    `;

    const cTurn = new KF.WarehouseCanvas(outEl.querySelector("#sim-turn-canvas"), data, {
      width: 640,
      height: 440,
    });
    const cFlow = new KF.WarehouseCanvas(outEl.querySelector("#sim-flow-canvas"), data, {
      width: 640,
      height: 440,
      customLevels: r.dynamicLevels,
      strongCongestion: true,
    });

    const stepChip = outEl.querySelector("#sim-step-chip");
    const turnSt = outEl.querySelector("#sim-turn-st");
    const flowSt = outEl.querySelector("#sim-flow-st");

    const totalSteps = Math.max(2, r.maxStep);
    const ctrl = new KF.PlaybackController(
      outEl.querySelector("#sim-turn-ctrl"),
      totalSteps,
      (t) => {
        const partialUsage = new Map();
        const workers = [];
        let activeCount = 0;
        for (const op of r.operators) {
          const lim = Math.min(t, op.path.length - 1);
          if (t < op.path.length - 1) activeCount++;
          workers.push({ node: op.path[lim], color: KF.PALETA.TINTA, radius: 4.6 });
          for (let i = 0; i < lim; i++) {
            const k = KF.edgeKey(op.path[i], op.path[i + 1]);
            partialUsage.set(k, (partialUsage.get(k) || 0) + 1);
          }
        }

        // Sincronizar cuadro de Edmonds-Karp con el avance del turno
        const ekIdx = Math.min(
          ekFrames.length - 1,
          Math.round((t / Math.max(1, totalSteps - 1)) * (ekFrames.length - 1))
        );
        const ef = ekFrames[ekIdx];

        stepChip.textContent = `Paso ${t + 1} / ${totalSteps}`;
        turnSt.textContent =
          activeCount === 0
            ? `turno completado ✓ (${partialUsage.size} pasillos)`
            : `${activeCount} operarios en ruta · ${partialUsage.size} pasillos`;
        flowSt.textContent =
          ekIdx === ekFrames.length - 1
            ? `corte mínimo: ${ef.cut.length} pasillos (${ef.flow} unidades de flujo) ✓`
            : `flujo: ${ef.flow} unidades de flujo (camino #${ef.paths})`;

        cTurn.render({
          usageMap: partialUsage,
          maxUsage: Math.max(1, r.maxUsage),
          workers,
        });
        cFlow.render({
          flowEdges: ef.edges,
          augmentingPath: ef.aug,
          minCut: ef.cut,
        });
      },
      70
    );
    ctrl.play(1);

    registerCleanup(() => {
      ctrl.destroy();
      cTurn.destroy();
      cFlow.destroy();
    });
  }

  /* =======================================================
     5. RESULTADOS DE EXPERIMENTOS (Interactivo)
     ======================================================= */
  function renderResultados(main, data) {
    STATE.expConfig = STATE.expConfig || { perScenario: 10, seed: 42, selectedRow: 3 };
    const cfg = STATE.expConfig;

    main.innerHTML = `
      ${pageHeader(
      "Resultados",
      "del experimento",
      "Ejecuta baterías de pedidos controladas, compara escenarios de congestión y haz clic en cualquier fila de la tabla para inspeccionar sus rutas en el mapa."
    )}
      <div class="stack">
        <div class="card row-between">
          <div class="row" style="gap:18px">
            <div class="control-group">
              <span class="control-label">Muestra por escenario (6 escenarios)</span>
              <div class="segmented" id="exp-size-seg">
                <button type="button" data-n="5" class="${cfg.perScenario === 5 ? "active" : ""}">30 pedidos (5×6)</button>
                <button type="button" data-n="10" class="${cfg.perScenario === 10 ? "active" : ""}">60 pedidos (10×6)</button>
                <button type="button" data-n="20" class="${cfg.perScenario === 20 ? "active" : ""}">120 pedidos (20×6)</button>
              </div>
            </div>

            <div class="control-group">
              <span class="control-label">Semilla reproducible</span>
              <div class="row" style="gap:6px">
                <input type="number" id="exp-seed-input" class="input" min="1" max="9999" value="${cfg.seed}" style="width:88px" />
                <button type="button" id="exp-random-btn" class="btn" title="Generar otra muestra aleatoria de pedidos">Otra muestra al azar</button>
              </div>
            </div>
          </div>

          <div class="control-group">
            <span class="control-label">&nbsp;</span>
            <button type="button" id="exp-run-btn" class="btn btn-primary">Ejecutar experimento</button>
          </div>
        </div>
        <div id="exp-progress-wrap" hidden>
          <div class="progress-bar"><div class="progress-fill" id="exp-progress-fill"></div></div>
        </div>
        <div id="exp-body"></div>
      </div>
    `;

    const bodyEl = main.querySelector("#exp-body");
    const progWrap = main.querySelector("#exp-progress-wrap");
    const progFill = main.querySelector("#exp-progress-fill");
    const runBtn = main.querySelector("#exp-run-btn");
    const seedInput = main.querySelector("#exp-seed-input");

    main.querySelectorAll("#exp-size-seg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        cfg.perScenario = parseInt(btn.dataset.n, 10);
        main.querySelectorAll("#exp-size-seg button").forEach((b) => b.classList.toggle("active", b === btn));
        runBtn.textContent = `Ejecutar experimento (${cfg.perScenario * 6} pedidos)`;
        runExperiments(cfg.perScenario, cfg.seed);
      });
    });

    seedInput.addEventListener("change", () => {
      cfg.seed = Math.max(1, parseInt(seedInput.value, 10) || 42);
    });

    main.querySelector("#exp-random-btn").addEventListener("click", () => {
      cfg.seed = Math.floor(1 + Math.random() * 9000);
      seedInput.value = String(cfg.seed);
      runExperiments(cfg.perScenario, cfg.seed);
    });

    async function runExperiments(perScenario = cfg.perScenario, seed = cfg.seed) {
      runBtn.disabled = true;
      progWrap.hidden = false;
      progFill.style.width = "5%";
      bodyEl.innerHTML = renderSkeletonBlock(3, true);

      const scenarios = [
        { hora: "valle", prod: 1 },
        { hora: "valle", prod: 5 },
        { hora: "valle", prod: 10 },
        { hora: "punta", prod: 1 },
        { hora: "punta", prod: 5 },
        { hora: "punta", prod: 10 },
      ];

      const rng = KF.mulberry32(seed);
      const muelles = data.estacionesDespacho && data.estacionesDespacho.length ? data.estacionesDespacho : data.estaciones;
      const racksPool = data.racksPicking && data.racksPicking.length ? data.racksPicking : data.racks;
      const rows = [];

      for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
        const sc = scenarios[sIdx];
        let sumPasBfs = 0,
          sumPasBf = 0,
          sumDistAdjBfs = 0,
          sumDistAdjBf = 0,
          sumTBfs = 0,
          sumTBf = 0,
          sumVisBfs = 0,
          sumRelBf = 0,
          sumMsBfs = 0,
          sumMsBf = 0;
        let bestSample = null;

        for (let k = 0; k < perScenario; k++) {
          const start = muelles[Math.floor(rng() * muelles.length)];
          const picks = [];
          const seen = new Set([start]);
          while (picks.length < sc.prod) {
            const cand = racksPool[Math.floor(rng() * racksPool.length)];
            if (!seen.has(cand)) {
              seen.add(cand);
              picks.push(cand);
            }
          }

          const t0 = performance.now();
          const rb = KF.rutaPedido(data, sc.hora, start, picks, "bfs", false, true);
          sumMsBfs += performance.now() - t0;
          const mb = KF.medirRuta(rb.path, data.edgeMap, sc.hora);
          sumPasBfs += mb.pasillos;
          sumDistAdjBfs += mb.distAjustada;
          sumTBfs += mb.tiempoS;
          sumVisBfs += rb.stats.visited;

          const t1 = performance.now();
          const rf = KF.rutaPedido(data, sc.hora, start, picks, "bellman_ford", false, true);
          sumMsBf += performance.now() - t1;
          const mf = KF.medirRuta(rf.path, data.edgeMap, sc.hora);
          sumPasBf += mf.pasillos;
          sumDistAdjBf += mf.distAjustada;
          sumTBf += mf.tiempoS;
          sumRelBf += rf.stats.relaxations;

          const diff = mb.tiempoS - mf.tiempoS;
          if (!bestSample || diff > bestSample.diff) {
            bestSample = {
              start,
              picks: picks.slice(),
              bfsPath: rb.path,
              bfPath: rf.path,
              bfOrder: rf.order,
              mb,
              mf,
              diff,
            };
          }
        }

        const avgTBfs = sumTBfs / perScenario;
        const avgTBf = sumTBf / perScenario;
        rows.push({
          idx: sIdx,
          hora: sc.hora,
          prod: sc.prod,
          pasBfs: sumPasBfs / perScenario,
          pasBf: sumPasBf / perScenario,
          distAdjBfs: sumDistAdjBfs / perScenario,
          distAdjBf: sumDistAdjBf / perScenario,
          tBfs: avgTBfs,
          tBf: avgTBf,
          ahorro: ((avgTBfs - avgTBf) / avgTBfs) * 100,
          visBfs: sumVisBfs / perScenario,
          relBf: sumRelBf / perScenario,
          msBfs: sumMsBfs / perScenario,
          msBf: sumMsBf / perScenario,
          sample: bestSample,
        });

        progFill.style.width = `${Math.round(((sIdx + 1) / (scenarios.length + 1)) * 100)}%`;
        await new Promise((res) => setTimeout(res, 15));
      }

      const tEk = performance.now();
      const ekRes = KF.edmondsKarpBetweenZones(
        data.buildCapacities(null),
        data.nodos,
        "Recepción y Almacenamiento",
        "Empaque y Despacho"
      );
      const ekMs = performance.now() - tEk;

      const cutFreq = { Alta: 0, Media: 0, Baja: 0 };
      for (const c of ekRes.minCut) {
        const e = data.edgeMap.get(KF.edgeKey(c.u, c.v));
        if (e) cutFreq[e.frec] = (cutFreq[e.frec] || 0) + 1;
      }

      STATE.expCache = { rows, ekRes, ekMs, cutFreq, perScenario, seed };
      progFill.style.width = "100%";
      setTimeout(() => {
        progWrap.hidden = true;
        runBtn.disabled = false;
      }, 250);
      drawExpResults(bodyEl, data, STATE.expCache);
    }

    runBtn.addEventListener("click", () => runExperiments(cfg.perScenario, cfg.seed));

    if (STATE.expCache && STATE.expCache.perScenario === cfg.perScenario && STATE.expCache.seed === cfg.seed) {
      drawExpResults(bodyEl, data, STATE.expCache);
    } else {
      runExperiments(cfg.perScenario, cfg.seed);
    }
  }

  function drawExpResults(bodyEl, data, exp) {
    const cfg = (STATE.expConfig = STATE.expConfig || { perScenario: 10, seed: 42, selectedRow: 3 });
    const avgPuntaSave =
      exp.rows
        .filter((r) => r.hora === "punta")
        .reduce((a, r) => a + r.ahorro, 0) / 3;
    const avgValleSave =
      exp.rows
        .filter((r) => r.hora === "valle")
        .reduce((a, r) => a + r.ahorro, 0) / 3;

    bodyEl.innerHTML = `
      <div class="stack">
        <div class="grid-3">
          <div class="card kpi-1">
            <div class="card-label">Ahorro medio en hora punta</div>
            <div class="card-num">${avgPuntaSave.toFixed(1)}<small>%</small></div>
            <div class="card-note">menos tiempo de caminata con Bellman-Ford (${exp.perScenario * 6} pedidos · semilla #${exp.seed})</div>
          </div>
          <div class="card kpi-3">
            <div class="card-label">Flujo máximo (Recepción → Despacho)</div>
            <div class="card-num">${exp.ekRes.maxFlow}<small>u. flujo</small></div>
            <div class="card-note">${exp.ekRes.augmentingPaths} caminos de aumento (${exp.ekMs.toFixed(1)} ms)</div>
          </div>
          <div class="card kpi-4">
            <div class="card-label">Corte mínimo (cuellos de botella)</div>
            <div class="card-num">${exp.ekRes.minCut.length}<small>pasillos</small></div>
            <div class="card-note">Alta: ${exp.cutFreq.Alta} · Media: ${exp.cutFreq.Media} · Baja: ${exp.cutFreq.Baja}</div>
          </div>
        </div>

        <div class="row-between" style="margin-top:6px">
          <div>
            <h3>Rutas de picking: BFS vs. Bellman-Ford (promedios por pedido)</h3>
            <span class="card-note">Haz clic en cualquier fila para visualizar y comparar un pedido real de ese escenario en el mapa inferior.</span>
          </div>
          <button type="button" id="exp-csv-btn" class="btn">Exportar CSV</button>
        </div>
        <div class="table-wrap">
          <table class="data-table" id="exp-table">
            <thead>
              <tr>
                <th>Escenario</th>
                <th class="num">Productos</th>
                <th class="num">Pasillos BFS</th>
                <th class="num">Pasillos B-F</th>
                <th class="num">Dist. Aj. BFS (m)</th>
                <th class="num">Dist. Aj. B-F (m)</th>
                <th class="num">Tiempo BFS (s)</th>
                <th class="num">Tiempo B-F (s)</th>
                <th class="num">Ahorro B-F</th>
                <th class="num">Visitados BFS</th>
                <th class="num">Relajaciones B-F</th>
                <th class="num">ms BFS</th>
                <th class="num">ms B-F</th>
              </tr>
            </thead>
            <tbody>
              ${exp.rows
        .map(
          (r) => `
                <tr class="exp-row ${r.idx === cfg.selectedRow ? "active" : ""}" data-row="${r.idx}" title="Clic para inspeccionar un pedido de este escenario">
                  <td>${r.hora === "punta" ? "Dataset (punta)" : "Sensibilidad (valle)"}</td>
                  <td class="num">${r.prod}</td>
                  <td class="num">${r.pasBfs.toFixed(1)}</td>
                  <td class="num">${r.pasBf.toFixed(1)}</td>
                  <td class="num">${r.distAdjBfs.toFixed(1)}</td>
                  <td class="num">${r.distAdjBf.toFixed(1)}</td>
                  <td class="num">${r.tBfs.toFixed(1)}</td>
                  <td class="num">${r.tBf.toFixed(1)}</td>
                  <td class="num"><span class="badge-ok">${r.ahorro.toFixed(1)} %</span></td>
                  <td class="num">${KF.formatNum(r.visBfs)}</td>
                  <td class="num">${KF.formatNum(r.relBf)}</td>
                  <td class="num">${r.msBfs.toFixed(2)}</td>
                  <td class="num">${r.msBf.toFixed(1)}</td>
                </tr>`
        )
        .join("")}
            </tbody>
          </table>
        </div>

        <div class="conclusion-box">
          <strong>Interpretación de resultados (TB2):</strong> en el escenario base del dataset (<em>hora punta</em>),
          <strong>Bellman-Ford</strong> reduce el tiempo de caminata en <strong>${avgPuntaSave.toFixed(1)} %</strong> en promedio
          (y <strong>${avgValleSave.toFixed(1)} %</strong> en <em>hora valle</em>) recorriendo casi la misma cantidad de pasillos que BFS,
          ya que desvía al operario hacia pasillos de congestión Baja/Media. A cambio, BFS se ejecuta en ~1 ms porque detiene la búsqueda al tocar el primer rack, mientras Bellman-Ford relaja globalmente la red.
        </div>

        <div class="grid-2">
          <div class="canvas-card">
            <div class="row-between" style="margin-bottom:6px">
              <div>
                <div class="canvas-title" id="exp-sample-title">Inspector del escenario seleccionado</div>
                <div class="canvas-subtitle" id="exp-sample-sub"></div>
              </div>
              <button type="button" id="exp-open-cmp" class="btn btn-sm">Abrir en Simular →</button>
            </div>
            <div class="canvas-wrap"><canvas id="res-sample-canvas"></canvas></div>
            ${renderLegend([
          { color: KF.PALETA.ALGORITMO.bellman_ford, label: "Ruta Bellman-Ford (óptima en tiempo)" },
          { color: KF.PALETA.ALGORITMO.bfs, label: "Ruta BFS (punteada, menos pasillos)" },
          { dot: true, color: KF.PALETA.TINTA, label: "Estación de despacho" },
          { dot: true, color: "#FFFFFF", border: KF.PALETA.TINTA, label: "Racks del pedido (1..k)" },
        ])}
          </div>

          <div class="canvas-card">
            <div class="canvas-title">Corte mínimo (Edmonds-Karp) · Recepción → Despacho</div>
            <div class="canvas-subtitle">Los ${exp.ekRes.minCut.length} pasillos resaltados en rojo carmesí saturan la capacidad máxima de ${exp.ekRes.maxFlow} unidades de flujo.</div>
            <div class="canvas-wrap"><canvas id="res-cut-canvas"></canvas></div>
            ${renderLegend([
          { color: KF.PALETA.ALGORITMO.edmonds_karp, label: "Corte mínimo (45 pasillos cuello de botella)" },
          { color: KF.PALETA.CONGESTION.Alta, label: "Congestión alta" },
          { color: KF.PALETA.CONGESTION.Media, label: "Congestión media" },
        ])}
          </div>
        </div>
      </div>
    `;

    const cSample = new KF.WarehouseCanvas(bodyEl.querySelector("#res-sample-canvas"), data, {
      width: 620,
      height: 410,
    });
    const cCut = new KF.WarehouseCanvas(bodyEl.querySelector("#res-cut-canvas"), data, {
      width: 620,
      height: 410,
      strongCongestion: true,
    });
    cCut.render({ minCut: exp.ekRes.minCut });
    registerCleanup(() => {
      cSample.destroy();
      cCut.destroy();
    });

    const sampleTitle = bodyEl.querySelector("#exp-sample-title");
    const sampleSub = bodyEl.querySelector("#exp-sample-sub");
    const openCmpBtn = bodyEl.querySelector("#exp-open-cmp");

    function selectScenarioRow(idx) {
      cfg.selectedRow = idx;
      const row = exp.rows[idx] || exp.rows[0];
      bodyEl.querySelectorAll("#exp-table tbody tr.exp-row").forEach((tr) => {
        tr.classList.toggle("active", parseInt(tr.dataset.row, 10) === row.idx);
      });
      const smp = row.sample;
      const escLabel = row.hora === "punta" ? "Dataset (punta)" : "Sensibilidad (valle)";
      sampleTitle.textContent = `Pedido del escenario: ${escLabel} · ${row.prod} ${row.prod === 1 ? "producto" : "productos"}`;
      sampleSub.innerHTML = `Salida y retorno en <strong>${smp.start}</strong> · BFS: <strong>${smp.mb.tiempoS} s</strong> vs. Bellman-Ford: <strong>${smp.mf.tiempoS} s</strong> (ahorra <strong>${smp.diff.toFixed(1)} s</strong>).`;
      cSample.render({
        start: smp.start,
        destinations: smp.bfOrder && smp.bfOrder.length ? smp.bfOrder : smp.picks,
        secondaryPath: smp.bfsPath,
        secondaryColor: KF.PALETA.ALGORITMO.bfs,
        path: smp.bfPath,
        pathColor: KF.PALETA.ALGORITMO.bellman_ford,
      });
    }

    bodyEl.querySelectorAll("#exp-table tbody tr.exp-row").forEach((tr) => {
      tr.addEventListener("click", () => {
        selectScenarioRow(parseInt(tr.dataset.row, 10));
      });
    });

    openCmpBtn.addEventListener("click", () => {
      const row = exp.rows[cfg.selectedRow] || exp.rows[0];
      const smp = row.sample;
      STATE.inicio = smp.start;
      STATE.destinos = smp.picks.slice();
      STATE.perfil = row.hora;
      STATE.regresar = true;
      STATE.bloqueados = [];
      saveSessionState();
      navigate("comparar");
    });

    selectScenarioRow(cfg.selectedRow);

    bodyEl.querySelector("#exp-csv-btn").addEventListener("click", () => {
      const headers = [
        "Escenario", "Productos", "Pasillos_BFS", "Pasillos_BF",
        "Distancia_Ajustada_BFS_m", "Distancia_Ajustada_BF_m",
        "Tiempo_BFS_s", "Tiempo_BF_s", "Ahorro_BF_pct",
        "Visitados_BFS", "Relajaciones_BF", "ms_BFS", "ms_BF",
      ];
      const csvLines = [headers.join(",")].concat(
        exp.rows.map((r) => [
          r.hora, r.prod, r.pasBfs.toFixed(2), r.pasBf.toFixed(2),
          r.distAdjBfs.toFixed(2), r.distAdjBf.toFixed(2),
          r.tBfs.toFixed(2), r.tBf.toFixed(2), r.ahorro.toFixed(2),
          Math.round(r.visBfs), Math.round(r.relBf), r.msBfs.toFixed(3), r.msBf.toFixed(2),
        ].join(","))
      );
      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kivaflow_resultados_tb2.csv";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  /* =======================================================
     6. VERIFICACIÓN EN VIVO
     ======================================================= */
  function renderVerificar(main, data) {
    main.innerHTML = `
      ${pageHeader(
      "Resultados de",
      "la verificación",
      "Comprobación automática de integridad del grafo y corrección de BFS, Bellman-Ford y Edmonds-Karp mediante certificados matemáticos de optimalidad y el teorema flujo máximo–corte mínimo."
    )}
      <div class="stack">
        <div class="card row-between">
          <div>
            <strong>Suite de pruebas en vivo (Certificado de optimalidad)</strong>
            <div class="card-note">Valida conectividad del grafo, 60 consultas BFS, 24 certificados duales/primales de Bellman-Ford (dist[v] ≤ dist[u] + w) y los 6 pares ordenados de zonas en Edmonds-Karp.</div>
          </div>
          <button type="button" id="verif-run" class="btn btn-primary">Ejecutar verificación ahora</button>
        </div>
        <div id="verif-prog" hidden><div class="progress-bar"><div class="progress-fill" id="verif-fill"></div></div></div>
        <div id="verif-body"></div>
      </div>
    `;

    const bodyEl = main.querySelector("#verif-body");
    const prog = main.querySelector("#verif-prog");
    const fill = main.querySelector("#verif-fill");
    const btn = main.querySelector("#verif-run");

    async function runVerification() {
      btn.disabled = true;
      prog.hidden = false;
      fill.style.width = "10%";
      bodyEl.innerHTML = renderSkeletonBlock(4, true);
      const t0 = performance.now();

      // 1. Integridad del grafo
      const bfsConn = KF.bfs(data.graphs.punta.adj, data.ids[0], "__NONE__");
      const conexo = bfsConn.visited === data.ids.length;
      const sinAislados = data.ids.every((id) => data.graphs.punta.adj[id].length > 0);
      const pesosPos = data.aristas.every((e) => e.dist > 0 && e.tiempoPunta > 0 && e.tiempoValle > 0);
      fill.style.width = "25%";
      await new Promise((r) => setTimeout(r, 15));

      // 2. BFS (60 consultas con semilla reproducible)
      const rng = KF.mulberry32(42);
      let bfsOk = 0;
      const bfsN = 60;
      for (let i = 0; i < bfsN; i++) {
        const s = data.ids[Math.floor(rng() * data.ids.length)];
        const t = data.ids[Math.floor(rng() * data.ids.length)];
        const r = KF.bfs(data.graphs.punta.adj, s, t);
        const manhattan =
          Math.abs(data.nodos[s].fila - data.nodos[t].fila) +
          Math.abs(data.nodos[s].col - data.nodos[t].col);
        let legal = r.path.length - 1 === manhattan && r.path[0] === s && r.path[r.path.length - 1] === t;
        for (let j = 0; legal && j < r.path.length - 1; j++) {
          if (!data.edgeMap.has(KF.edgeKey(r.path[j], r.path[j + 1]))) legal = false;
        }
        if (legal) bfsOk++;
      }
      fill.style.width = "55%";
      await new Promise((r) => setTimeout(r, 15));

      // 3. Bellman-Ford con Certificado de Optimalidad (24 consultas) + detección de ciclos negativos
      let bfOk = 0;
      let bfMaxErr = 0;
      let ciclosNeg = 0;
      const bfN = 24;
      for (let i = 0; i < bfN; i++) {
        const prof = i % 2 === 0 ? "punta" : "valle";
        const s = data.ids[Math.floor(rng() * data.ids.length)];
        const t = data.ids[Math.floor(rng() * data.ids.length)];
        try {
          const resBf = KF.bellmanFord(data.ids, data.graphs[prof].directed, s);
          const cert = KF.certificarBellmanFord(
            resBf.dist,
            resBf.parent,
            data.graphs[prof].directed,
            data.edgeMap,
            s,
            t,
            prof
          );
          if (cert.maxError > bfMaxErr) bfMaxErr = cert.maxError;
          if (cert.ok) bfOk++;
        } catch (_) {
          ciclosNeg++;
        }
      }
      fill.style.width = "85%";
      await new Promise((r) => setTimeout(r, 15));

      // 4. Edmonds-Karp en los 6 pares ordenados de zonas (Max-Flow === Min-Cut)
      const caps = data.buildCapacities(null);
      let ekOk = 0;
      const ekPairs = [];
      for (const z1 of KF.ZONAS) {
        for (const z2 of KF.ZONAS) {
          if (z1 === z2) continue;
          const r = KF.edmondsKarpBetweenZones(caps, data.nodos, z1, z2);
          const cutCap = r.minCut.reduce((a, c) => a + c.cap, 0);
          const ok = cutCap === r.maxFlow && r.maxFlow > 0;
          if (ok) ekOk++;
          ekPairs.push({ z1, z2, maxFlow: r.maxFlow, cutCap, cutEdges: r.minCut.length, ok });
        }
      }

      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      STATE.verifCache = {
        conexo,
        sinAislados,
        pesosPos,
        bfsOk,
        bfsN,
        bfOk,
        bfN,
        bfMaxErr,
        ciclosNeg,
        ekOk,
        ekN: 6,
        ekPairs,
        elapsed,
      };
      fill.style.width = "100%";
      setTimeout(() => {
        prog.hidden = true;
        btn.disabled = false;
      }, 200);
      drawVerification(bodyEl, STATE.verifCache);
    }

    btn.addEventListener("click", runVerification);
    if (STATE.verifCache) drawVerification(bodyEl, STATE.verifCache);
    else runVerification();
  }

  function drawVerification(bodyEl, v) {
    bodyEl.innerHTML = `
      <div class="stack">
        <div class="grid-4">
          <div class="card kpi-1">
            <div class="card-label">BFS</div>
            <div class="card-num">${v.bfsOk}<small>/ ${v.bfsN}</small></div>
            <div class="card-note">longitud exacta (= distancia Manhattan en cuadrícula) y ruta legal</div>
          </div>
          <div class="card kpi-2">
            <div class="card-label">Bellman-Ford</div>
            <div class="card-num">${v.bfOk}<small>/ ${v.bfN}</small></div>
            <div class="card-note">certificado dist[v] ≤ dist[u]+w · error máx. ${v.bfMaxErr.toExponential(1)} · ${v.ciclosNeg} ciclos neg.</div>
          </div>
          <div class="card kpi-3">
            <div class="card-label">Edmonds-Karp</div>
            <div class="card-num">${v.ekOk}<small>/ ${v.ekN}</small></div>
            <div class="card-note">teorema flujo máximo = capacidad del corte mínimo en los 6 pares de zonas</div>
          </div>
          <div class="card kpi-4">
            <div class="card-label">Integridad del grafo</div>
            <div class="card-num">${v.conexo && v.sinAislados && v.pesosPos && v.ciclosNeg === 0 ? "100 %" : "Error"}</div>
            <div class="card-note">conexo, 0 aislados, pesos positivos, 0 ciclos negativos · ${v.elapsed} s</div>
          </div>
        </div>

        <div class="conclusion-box">
          <strong>Nota metodológica (TB2 — Certificado de optimalidad):</strong> conforme a los lineamientos del curso, los tres algoritmos implementados son
          <strong>BFS</strong>, <strong>Bellman-Ford</strong> y <strong>Edmonds-Karp</strong>. Para verificar la optimalidad de Bellman-Ford sin emplear ningún otro algoritmo de caminos mínimos,
          se comprueba directamente el <em>certificado de optimalidad</em> en cada consulta: (1) factibilidad dual <code>dist[v] ≤ dist[u] + w(u,v)</code> en las 7 030 aristas dirigidas del almacén y
          (2) factibilidad primal donde la suma exacta de los pesos del camino reconstruido coincide con <code>dist[destino]</code>.
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Par de zonas (Edmonds-Karp)</th>
                <th class="num">Flujo máximo</th>
                <th class="num">Capacidad corte mínimo</th>
                <th class="num">Pasillos en el corte</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              ${v.ekPairs
        .map(
          (p) => `
                <tr>
                  <td>${p.z1} → ${p.z2}</td>
                  <td class="num">${p.maxFlow} unidades de flujo</td>
                  <td class="num">${p.cutCap} unidades de flujo</td>
                  <td class="num">${p.cutEdges}</td>
                  <td><span class="${p.ok ? "badge-ok" : "badge-warn"}">${p.ok ? "Verificado ✓" : "Revisar"}</span></td>
                </tr>`
        )
        .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /* =======================================================
     7. ACERCA (Información académica del Informe TB1)
     ======================================================= */
  function renderAcerca(main, data) {
    const algs = [
      {
        id: "bfs",
        tag: "No considera pesos",
        tec: "Recorridos y búsquedas en grafos",
        ref: "Cormen et al. (2022); Russell y Norvig (2021)",
        desc: "Línea base: calcula la ruta con el menor número de pasillos desde el operario hasta el producto.",
      },
      {
        id: "bellman_ford",
        tag: "Óptimo con pesos",
        tec: "Caminos mínimos (Bellman-Ford)",
        ref: "Bellman (1958); Cormen et al. (2022)",
        desc: "Calcula la ruta de menor tiempo considerando distancias físicas y penalizaciones por congestión.",
      },
      {
        id: "edmonds_karp",
        tag: "Óptimo en redes",
        tec: "Flujo máximo (Ford-Fulkerson / Edmonds-Karp)",
        ref: "Edmonds y Karp (1972); Ahuja et al. (1993)",
        desc: "Determina la capacidad máxima simultánea entre zonas e identifica los pasillos cuello de botella.",
      },
    ];

    main.innerHTML = `
      ${pageHeader(
      "Un laboratorio para",
      "ver pensar a los algoritmos",
      "Universidad Peruana de Ciencias Aplicadas (UPC) · Ciencias de la Computación · 1ACC0184 Complejidad Algorítmica · Sección 4834."
    )}

      <div class="stack">
        <div class="grid-3">
          ${algs
        .map(
          (a) => `
            <div class="card" style="border-top:4px solid ${KF.PALETA.ALGORITMO[a.id]}">
              <h3>${KF.NOMBRE[a.id]}</h3>
              <span class="chip chip-sans" style="margin-top:6px">${a.tag}</span>
              <p class="card-note" style="margin:10px 0 12px">${a.desc}</p>
              <div class="card-label">Técnica del curso</div>
              <div style="margin-bottom:8px">${a.tec}</div>
              <div class="card-label">Complejidad</div>
              <div style="font-family:var(--mono);font-size:13px;margin-bottom:8px">${KF.COMPLEJIDAD[a.id].tiempo} tiempo · ${KF.COMPLEJIDAD[a.id].espacio} espacio</div>
              <div class="card-label">Referencia</div>
              <div class="card-note">${a.ref}</div>
            </div>`
        )
        .join("")}
        </div>

        <div class="grid-2">
          <div class="card">
            <h3>Dataset y reglas del modelo</h3>
            <p style="margin:8px 0">
              Almacén sintético inspirado en los sistemas robóticos Kiva de Amazon (Wurman, D'Andrea y Mountz, 2008),
              modelado como una cuadrícula de <strong>45 filas × 40 columnas</strong> (<strong>1 800 nodos</strong> y
              <strong>3 515 aristas</strong>), dividida en tres zonas funcionales:
            </p>
            <ul style="margin:8px 0 12px;padding-left:20px;color:var(--muted)">
              <li><strong>Recepción y Almacenamiento</strong>: 585 nodos (columnas 0–12)</li>
              <li><strong>Picking</strong>: 630 nodos (columnas 13–26)</li>
              <li><strong>Empaque y Despacho</strong>: 585 nodos (columnas 27–39)</li>
            </ul>
            <p class="card-note" style="margin:0">
              Pasillos horizontales: <strong>1.5 m</strong> (<code>PHxx</code>); verticales: <strong>2.5 m</strong> (<code>PVxx</code>).
              Velocidad promedio: <strong>1.1 m/s</strong>. Penalizaciones de congestión en hora punta: Baja ×1.0, Media ×1.5, Alta ×2.0
              (${data.freqCounts.Baja} Baja · ${data.freqCounts.Media} Media · ${data.freqCounts.Alta} Alta).
              Capacidades para flujo máximo: 3, 2 y 1 unidades de flujo respectivamente.
            </p>
          </div>

          <div class="card" style="display:flex;flex-direction:column;justify-content:center">
            <h3>Pregunta de investigación</h3>
            <p style="margin:12px 0 0;font-family:var(--serif);font-size:1.22rem;line-height:1.5;color:var(--ink)">
              «¿Cómo podemos modelar la infraestructura de un almacén inteligente tipo Amazon como un grafo que permita
              encontrar la ruta de picking más conveniente entre múltiples ubicaciones, considerando la distancia recorrida
              y las condiciones de congestión del entorno?»
            </p>
          </div>
        </div>

        <div class="canvas-card">
          <div class="row-between" style="margin-bottom:10px">
            <div>
              <div class="canvas-title">Visualización del grafo completo y subgrafos por zona (TB2 · Sección 3)</div>
              <div class="canvas-subtitle" id="subgrafo-desc">Mostrando las 1 800 ubicaciones y 3 515 pasillos del almacén completo.</div>
            </div>
            <div class="segmented" id="subgrafo-seg">
              <button type="button" data-z="" class="active">Completo</button>
              <button type="button" data-z="Recepción y Almacenamiento">Recepción (585)</button>
              <button type="button" data-z="Picking">Picking (630)</button>
              <button type="button" data-z="Empaque y Despacho">Empaque (585)</button>
            </div>
          </div>
          <div class="canvas-wrap"><canvas id="subgrafo-canvas"></canvas></div>
        </div>
      </div>
    `;

    const subCanvas = new KF.WarehouseCanvas(main.querySelector("#subgrafo-canvas"), data, {
      width: 820,
      height: 390,
      strongCongestion: true,
    });
    subCanvas.render();
    registerCleanup(() => subCanvas.destroy());

    const subDesc = main.querySelector("#subgrafo-desc");
    main.querySelectorAll("#subgrafo-seg button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const z = btn.dataset.z || null;
        main.querySelectorAll("#subgrafo-seg button").forEach((b) => b.classList.toggle("active", b === btn));
        subCanvas.setFocusZone(z);
        subCanvas.render();
        if (!z) {
          subDesc.textContent = "Mostrando las 1 800 ubicaciones y 3 515 pasillos del almacén completo.";
        } else {
          const nZone = data.zoneCounts[z] || 0;
          const eZone = data.aristas.filter((e) => e.zonaOrigen === z && e.zonaDestino === z).length;
          subDesc.textContent = `Subgrafo ${z}: ${nZone} nodos y ${KF.formatNum(eZone)} pasillos internos.`;
        }
      });
    });
  }

  /* =======================================================
     Router y Bootstrap
     ======================================================= */
  const ROUTES = {
    inicio: renderInicio,
    explorar: renderExplorar,
    comparar: renderUnifiedSimular,
    simular: renderUnifiedSimular,
    editar: (main, data) => KF.renderEditar(main, data, { pageHeader, registerCleanup }),
    resultados: renderResultados,
    verificar: renderVerificar,
    acerca: renderAcerca,
  };

  function navigate(page) {
    if (page === "comparar") {
      STATE.sim.escala = "pedido";
      page = "simular";
    }
    if (!ROUTES[page]) page = "inicio";
    STATE.page = page;
    if (location.hash !== `#${page}`) {
      history.replaceState(null, "", `#${page}`);
    }

    runCleanups();
    saveSessionState();
    document.querySelectorAll(".nav-link").forEach((a) => {
      const isActive = a.dataset.nav === page;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    closeMobileMenu();

    const main = document.getElementById("app-main");
    main.classList.remove("view-enter");
    ROUTES[page](main, KF.DATA);
    void main.offsetWidth;
    main.classList.add("view-enter");
    main.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function closeMobileMenu() {
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("sidebar-backdrop");
    const btn = document.getElementById("mobile-menu-btn");
    if (sb) sb.classList.remove("open");
    if (bd) bd.hidden = true;
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  async function init() {
    const mobileBtn = document.getElementById("mobile-menu-btn");
    const collapseBtn = document.getElementById("sidebar-collapse-btn");
    const sb = document.getElementById("sidebar");
    const bd = document.getElementById("sidebar-backdrop");

    if (collapseBtn && sb) {
      const labelEl = collapseBtn.querySelector(".collapse-label");
      const applyCollapsed = (collapsed) => {
        sb.classList.toggle("collapsed", collapsed);
        collapseBtn.setAttribute("aria-expanded", String(!collapsed));
        collapseBtn.setAttribute("aria-label", collapsed ? "Expandir barra lateral" : "Retraer barra lateral");
        collapseBtn.title = collapsed ? "Expandir menú" : "Retraer menú";
        if (labelEl) labelEl.textContent = collapsed ? "Expandir menú" : "Retraer menú";
      };
      try {
        if (localStorage.getItem("kf_sidebar_collapsed") === "1") applyCollapsed(true);
      } catch (_) { }
      collapseBtn.addEventListener("click", () => {
        const next = !sb.classList.contains("collapsed");
        applyCollapsed(next);
        try {
          localStorage.setItem("kf_sidebar_collapsed", next ? "1" : "0");
        } catch (_) { }
      });
    }

    if (mobileBtn) {
      mobileBtn.addEventListener("click", () => {
        const open = !sb.classList.contains("open");
        sb.classList.toggle("open", open);
        bd.hidden = !open;
        mobileBtn.setAttribute("aria-expanded", String(open));
      });
    }
    if (bd) bd.addEventListener("click", closeMobileMenu);

    document.addEventListener("click", (ev) => {
      const link = ev.target.closest("[data-nav]");
      if (link) {
        ev.preventDefault();
        if (link.dataset.nav === "comparar") {
          STATE.sim.escala = "pedido";
          navigate("simular");
        } else if (link.dataset.nav === "simular" && link.textContent.toLowerCase().includes("turno")) {
          STATE.sim.escala = "turno";
          navigate("simular");
        } else {
          navigate(link.dataset.nav);
        }
      }
    });

    window.addEventListener("hashchange", () => {
      const target = (location.hash || "#inicio").replace("#", "");
      if (ROUTES[target] && target !== STATE.page) navigate(target);
    });

    try {
      await KF.loadDataset();
      restoreSessionState(KF.DATA);
      const initial = (location.hash || "#inicio").replace("#", "");
      navigate(ROUTES[initial] ? initial : "inicio");

      // Si se sirve desde `python app.py`, conectar con /api/estado y reflejarlo en la barra lateral
      if (location.protocol === "http:" || location.protocol === "https:") {
        fetch("/api/estado")
          .then((r) => (r.ok ? r.json() : null))
          .then((st) => {
            if (st && st.ok) {
              STATE.pythonApi = true;
              const statusStrong = document.querySelector(".sidebar-footer .status-row strong");
              if (statusStrong) statusStrong.textContent = "Motor Python (/api)";
            }
          })
          .catch(() => {});
      }
    } catch (err) {
      const main = document.getElementById("app-main");
      main.innerHTML = `<div class="card"><h2>Error al cargar el dataset</h2><p class="card-note" id="kf-err-msg"></p></div>`;
      main.querySelector("#kf-err-msg").textContent = err && err.message ? err.message : "Error desconocido";
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})(window);
