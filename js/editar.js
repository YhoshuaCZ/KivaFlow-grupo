/* =========================================================
   KivaFlow · Vista «Editar grafo»
   Agregar nodos y aristas sin que la página se cuelgue:
   1. El grafo se actualiza de forma incremental (O(1) por cambio).
   2. El mapa dibuja solo lo nuevo, sin redibujar los 3 515 pasillos.
   3. Las ampliaciones grandes se hacen por tandas entre cuadros.
   4. Los algoritmos corren en un Web Worker (js/motor-worker.js).
   5. Se mide tiempo, memoria y almacenamiento de cada cambio y ejecución.
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});
  const CLAVE_LS = "kf_editar_cambios_v1";
  const VERSION = "20261123";

  /* ---------- Formatos ---------- */
  function fmtBytes(b) {
    if (b < 1024) return `${Math.round(b)} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  }

  function fmtMs(ms) {
    if (ms < 1) return `${ms.toFixed(2)} ms`;
    if (ms < 1000) return `${ms.toFixed(1)} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  }

  /* ---------- Mapa editable ---------- */
  class EditableCanvas extends KF.WarehouseCanvas {
    /** Convierte la posición del mouse a (fila, col) fraccionarias del plano. */
    aCoordenadas(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * this.opts.width;
      const y = ((clientY - rect.top) / rect.height) * this.opts.height;
      const col = (x - this.opts.padLeft) / this.cellW;
      const fila = (y - this.opts.padTop) / this.cellH;
      if (fila < -0.5 || fila > this.data.rows - 0.5 || col < -0.5 || col > this.data.cols - 0.5) return null;
      return { fila, col };
    }

    // El mapa original busca por id de cuadrícula (F00_C00); aquí hay nodos en cualquier punto.
    _nearestNode(clientX, clientY) {
      const p = this.aCoordenadas(clientX, clientY);
      return p ? this.data.masCercano(p.fila, p.col, 0.6) : null;
    }

    _buildBaseLayer() {
      super._buildBaseLayer();
      for (const e of this.data.aristas) if (e.nuevo && !e.ampliacion) this.dibujarArista(e, false);
      for (const n of this.data.nodeList) if (n.nuevo && !n.ampliacion) this.dibujarNodo(n, false);
    }

    _posDe(n) {
      return { x: this.opts.padLeft + n.col * this.cellW, y: this.opts.padTop + n.fila * this.cellH };
    }

    /** Dibuja una arista nueva sobre la capa base: O(1), sin redibujar el resto. */
    dibujarArista(e, refrescar = true) {
      const ctx = this._baseCanvas.getContext("2d");
      ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
      const p1 = this.pos[e.u] || (this.pos[e.u] = this._posDe(this.data.nodos[e.u]));
      const p2 = this.pos[e.v] || (this.pos[e.v] = this._posDe(this.data.nodos[e.v]));
      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.strokeStyle = KF.PALETA.CONGESTION[e.frec] || KF.PALETA.CONGESTION.Baja;
      ctx.lineWidth = e.frec === "Alta" ? 2 : 1.5;
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      if (refrescar) this.render(this._lastOverlay);
    }

    /** Dibuja un nodo nuevo sobre la capa base: O(1). */
    dibujarNodo(n, refrescar = true) {
      const ctx = this._baseCanvas.getContext("2d");
      ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
      const p = (this.pos[n.id] = this._posDe(n));
      ctx.beginPath();
      ctx.fillStyle = "#FFFFFF";
      ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "#D49B00";
      ctx.stroke();
      if (refrescar) this.render(this._lastOverlay);
    }

    /** Cuando cambia el número de filas hay que reescalar todo el plano (una sola vez por tanda). */
    reescalar() {
      // El plano crece en alto con las filas nuevas (hasta el doble) para que no quede aplastado.
      const alto = Math.round(56 + (454 * Math.min(this.data.rows, 90)) / 45);
      if (alto !== this.opts.height) {
        this.opts.height = alto;
        this.aspect = this.opts.width / alto;
        this.canvas.style.aspectRatio = `${this.opts.width} / ${alto}`;
      }
      this._resizeAndBuild();
      this.render(this._lastOverlay);
    }
  }

  /* ---------- Motor: Web Worker con respaldo en el hilo principal ---------- */
  class Motor {
    constructor(grafo, alCambiarEstado) {
      this.grafo = grafo;
      this.alCambiarEstado = alCambiarEstado || (() => {});
      this.pendientes = new Map();
      this.sig = 1;
      this.worker = null;
      this.modo = "principal";
      this._crear();
    }

    _crear() {
      try {
        this.worker = new Worker(`js/motor-worker.js?v=${VERSION}`);
        this.modo = "worker";
        this.worker.onmessage = (ev) => this._recibir(ev.data);
        this.worker.onerror = (ev) => {
          ev.preventDefault();
          this._pasarAPrincipal(ev.message || "el Worker no pudo cargarse");
        };
        this.worker.postMessage({ tipo: "iniciar", instantanea: this.grafo.instantanea() });
      } catch (err) {
        this._pasarAPrincipal(err && err.message);
      }
      this.alCambiarEstado(this.modo);
    }

    _pasarAPrincipal(motivo) {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.modo = "principal";
      this.motivo = motivo || "";
      for (const [id, p] of this.pendientes) {
        this.pendientes.delete(id);
        this._ejecutarAqui(p.msg).then(p.resolve, p.reject);
      }
      this.alCambiarEstado(this.modo);
    }

    _recibir(msg) {
      if (msg.tipo === "resultado" || msg.tipo === "error") {
        const p = this.pendientes.get(msg.id);
        if (!p) return;
        this.pendientes.delete(msg.id);
        if (msg.tipo === "error") p.reject(new Error(msg.mensaje));
        else p.resolve(Object.assign(msg, { hilo: "Web Worker" }));
      }
    }

    /** Solo se envía lo nuevo: el Worker aplica los mismos cambios O(1) a su copia. */
    enviarCambios(cambios) {
      if (this.worker && cambios.length) this.worker.postMessage({ tipo: "cambios", cambios });
    }

    _ejecutarAqui(msg) {
      return new Promise((resolve, reject) => {
        // Se cede un cuadro antes de calcular para que la interfaz alcance a pintar el estado «calculando».
        setTimeout(() => {
          try {
            resolve(Object.assign(KF.ejecutarEnGrafo(this.grafo, msg), { hilo: "hilo principal" }));
          } catch (err) {
            reject(err);
          }
        }, 30);
      });
    }

    ejecutar(params) {
      const msg = Object.assign({ tipo: "ejecutar", id: this.sig++ }, params);
      if (!this.worker) return this._ejecutarAqui(msg);
      return new Promise((resolve, reject) => {
        this.pendientes.set(msg.id, { resolve, reject, msg });
        this.worker.postMessage(msg);
      });
    }

    /** Detiene un cálculo largo: se descarta el Worker y se crea otro con el grafo actual. */
    cancelar() {
      if (!this.worker) return false;
      this.worker.terminate();
      for (const [, p] of this.pendientes) p.reject(new Error("cancelado"));
      this.pendientes.clear();
      this._crear();
      return true;
    }

    destruir() {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.pendientes.clear();
    }
  }

  /* ---------- Medidor de fluidez de la interfaz (cuadros por segundo) ---------- */
  function crearMedidorFPS(el) {
    let cuadros = 0;
    let t0 = performance.now();
    let minimo = Infinity;
    let midiendoMin = false;
    let activo = true;
    function bucle(t) {
      if (!activo) return;
      cuadros++;
      if (t - t0 >= 500) {
        const fps = (cuadros * 1000) / (t - t0);
        if (midiendoMin) minimo = Math.min(minimo, fps);
        el.textContent = `${Math.round(fps)} fps`;
        el.style.color = fps >= 45 ? "#0F7B3F" : fps >= 20 ? "#B7791F" : "#C1121F";
        cuadros = 0;
        t0 = t;
      }
      requestAnimationFrame(bucle);
    }
    requestAnimationFrame(bucle);
    return {
      empezar() {
        minimo = Infinity;
        midiendoMin = true;
      },
      terminar() {
        midiendoMin = false;
        return minimo;
      },
      detener() {
        activo = false;
      },
    };
  }

  /* ---------- Vista ---------- */
  KF.renderEditar = function (main, data, ui) {
    const NIVELES = ["Baja", "Media", "Alta"];
    const estado = {
      modo: "nodo",
      frec: "Baja",
      conectar: true,
      inicio: "F22_C39",
      destino: "F05_C05",
      perfil: "punta",
      zonaS: "Recepción y Almacenamiento",
      zonaT: "Empaque y Despacho",
      seleccion: null, // primer extremo al agregar una arista
      ocupado: false,
      overlay: {},
      resultados: [],
    };

    // Registro de cambios: lo único que se guarda en el navegador (no el grafo entero).
    let cambios = [];
    try {
      const raw = localStorage.getItem(CLAVE_LS);
      if (raw) cambios = JSON.parse(raw) || [];
    } catch (_) {
      cambios = [];
    }

    let grafo = KF.GrafoEditable.desdeDataset(data);
    let bytesCSV = 0;
    let ultimaOperacion = null;

    main.innerHTML = `
      ${ui.pageHeader(
        "Editar",
        "grafo",
        "Agrega ubicaciones (nodos) y pasillos (aristas) al almacén y vuelve a calcular rutas y flujo. Cada cambio cuesta O(1) y los algoritmos corren en un Web Worker, así la página no se congela aunque el grafo crezca."
      )}
      <div class="stack">
        <div class="card">
          <div class="row-between">
            <div class="segmented" id="ed-modo" role="group" aria-label="Qué hace un clic en el mapa">
              <button type="button" data-modo="nodo" class="active">+ Nodo</button>
              <button type="button" data-modo="arista">+ Arista</button>
              <button type="button" data-modo="inicio">Inicio</button>
              <button type="button" data-modo="destino">Destino</button>
            </div>
            <div class="row">
              <label class="control-label" for="ed-frec">Congestión del pasillo nuevo</label>
              <select id="ed-frec" class="select">
                ${NIVELES.map((n) => `<option value="${n}">${n}</option>`).join("")}
              </select>
              <label class="control-label" style="display:flex;align-items:center;gap:6px">
                <input type="checkbox" id="ed-conectar" checked /> Conectar el nodo nuevo al más cercano
              </label>
            </div>
          </div>
          <p class="card-note" id="ed-ayuda" style="margin-top:10px"></p>
          <div class="row" style="margin-top:12px">
            <label class="control-label" for="ed-filas">Ampliar el almacén</label>
            <select id="ed-filas" class="select">
              <option value="5">+5 filas (200 nodos)</option>
              <option value="25" selected>+25 filas (1 000 nodos)</option>
              <option value="125">+125 filas (5 000 nodos)</option>
            </select>
            <button type="button" id="ed-ampliar" class="btn">Ampliar</button>
            <button type="button" id="ed-exportar" class="btn">Exportar CSV</button>
            <button type="button" id="ed-reset" class="btn">Restablecer dataset original</button>
          </div>
          <div id="ed-prog" hidden style="margin-top:12px">
            <div class="progress-bar"><div class="progress-fill" id="ed-prog-fill"></div></div>
            <div class="card-note" id="ed-prog-txt"></div>
          </div>
          <p class="card-note" id="ed-msg" aria-live="polite" style="margin-top:10px"></p>
        </div>

        <div class="grid-4" id="ed-kpis"></div>

        <div class="grid-explore">
          <div class="canvas-card">
            <div class="canvas-title" id="ed-titulo">Mapa editable</div>
            <div class="canvas-wrap"><canvas id="ed-canvas"></canvas></div>
            <div class="card-note" style="margin-top:8px">
              <span style="color:#D49B00">●</span> nodos agregados ·
              pasillos nuevos en color fuerte según congestión ·
              <span style="color:${KF.PALETA.ALGORITMO.bfs}">━</span> BFS ·
              <span style="color:${KF.PALETA.ALGORITMO.bellman_ford}">━</span> Bellman-Ford ·
              <span style="color:${KF.PALETA.ALGORITMO.edmonds_karp}">━</span> corte mínimo
            </div>
          </div>

          <div class="card stack" style="gap:14px">
            <div>
              <strong>Calcular sobre el grafo editado</strong>
              <div class="card-note" id="ed-puntos"></div>
            </div>
            <div class="row">
              <label class="control-label" for="ed-perfil">Perfil</label>
              <select id="ed-perfil" class="select">
                <option value="punta">Hora punta</option>
                <option value="valle">Hora valle</option>
              </select>
            </div>
            <button type="button" id="ed-ruta" class="btn btn-primary">Ruta: BFS y Bellman-Ford</button>
            <div class="row">
              <select id="ed-zs" class="select" aria-label="Zona de origen">${KF.ZONAS.map((z) => `<option ${z === estado.zonaS ? "selected" : ""}>${z}</option>`).join("")}</select>
              <span>→</span>
              <select id="ed-zt" class="select" aria-label="Zona de destino">${KF.ZONAS.map((z) => `<option ${z === estado.zonaT ? "selected" : ""}>${z}</option>`).join("")}</select>
            </div>
            <button type="button" id="ed-flujo" class="btn">Flujo máximo (Edmonds-Karp)</button>
            <button type="button" id="ed-cancelar" class="btn" disabled>Cancelar cálculo</button>
            <div class="card" style="padding:12px">
              <div class="row-between">
                <span class="control-label">Fluidez de la interfaz</span>
                <strong id="ed-fps">— fps</strong>
              </div>
              <div class="row-between" style="margin-top:6px">
                <span class="control-label">Dónde se calcula</span>
                <strong id="ed-hilo">—</strong>
              </div>
              <div class="card-note" id="ed-estado" style="margin-top:6px"></div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="row-between">
            <strong>Mediciones de cada ejecución</strong>
            <span class="card-note">Tiempo: <code>performance.now()</code> dentro del motor · Memoria: estimada a partir de las estructuras que crea cada algoritmo</span>
          </div>
          <div class="table-wrap" style="margin-top:10px">
            <table class="data-table">
              <thead><tr>
                <th>Algoritmo</th><th>Grafo</th><th>Tiempo</th><th>Memoria auxiliar</th>
                <th>Operaciones</th><th>Resultado</th><th>Complejidad</th><th>Hilo</th>
              </tr></thead>
              <tbody id="ed-tabla"><tr><td colspan="8" class="card-note">Aún no hay ejecuciones. Agrega nodos o aristas y pulsa «Ruta» o «Flujo máximo».</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const $ = (sel) => main.querySelector(sel);
    const msgEl = $("#ed-msg");
    const avisar = (txt) => {
      msgEl.textContent = txt;
    };

    /* ----- Aplicar un cambio al grafo (y anotar lo que hay que mandar al Worker) ----- */
    function aplicar(op, salida) {
      if (op.t === "n") {
        const n = grafo.agregarNodo(op.fila, op.col, { id: op.id });
        const num = /^N(\d+)$/.exec(n.id);
        if (num) grafo.nuevos = Math.max(grafo.nuevos, parseInt(num[1], 10));
        salida.nodos.push(n);
        salida.delta.push({ t: "n", id: n.id, fila: n.fila, col: n.col, zona: n.zona });
        if (op.unir) {
          const e = grafo.agregarArista(n.id, op.unir, op.frec);
          if (e) {
            salida.aristas.push(e);
            salida.delta.push({ t: "e", u: e.u, v: e.v, frec: e.frec, dist: e.dist });
          }
        }
      } else if (op.t === "e") {
        const e = grafo.agregarArista(op.u, op.v, op.frec);
        if (e) {
          salida.aristas.push(e);
          salida.delta.push({ t: "e", u: e.u, v: e.v, frec: e.frec, dist: e.dist });
        }
      } else if (op.t === "f") {
        const rng = KF.mulberry32Editable(op.semilla);
        for (let i = 0; i < op.k; i++) {
          const r = grafo.agregarFila(rng);
          for (const n of r.nodos) salida.delta.push({ t: "n", id: n.id, fila: n.fila, col: n.col, zona: n.zona });
          for (const e of r.aristas) salida.delta.push({ t: "e", u: e.u, v: e.v, frec: e.frec, dist: e.dist });
          salida.nodos.push(...r.nodos);
          salida.aristas.push(...r.aristas);
        }
        salida.delta.push({ t: "filas", rows: grafo.rows });
        salida.filas = true;
      }
      for (const n of salida.nodos.slice(salida._n || 0)) bytesCSV += KF.bytesUTF8(KF.GrafoEditable.lineaNodo(n));
      for (const e of salida.aristas.slice(salida._e || 0)) bytesCSV += KF.bytesUTF8(KF.GrafoEditable.lineaArista(e));
      salida._n = salida.nodos.length;
      salida._e = salida.aristas.length;
    }

    function nuevaSalida() {
      return { nodos: [], aristas: [], delta: [], filas: false };
    }

    // Reproducir los cambios guardados de una sesión anterior.
    const inicial = nuevaSalida();
    const csv0 = grafo.aCSV();
    bytesCSV = KF.bytesUTF8(csv0.nodos) + KF.bytesUTF8(csv0.aristas);
    for (const op of cambios) {
      try {
        aplicar(op, inicial);
      } catch (_) { }
    }
    // (al Worker se le manda después la instantánea completa, que ya incluye estos cambios)

    /* ----- Mapa ----- */
    let canvas = new EditableCanvas($("#ed-canvas"), grafo, { interactive: false });
    if (grafo.rows !== 45) canvas.reescalar();

    function pintar() {
      const ov = Object.assign({}, estado.overlay, {
        start: estado.inicio,
        destinations: estado.destino ? [estado.destino] : [],
        workers: estado.seleccion ? [{ node: estado.seleccion, color: "#D49B00", radius: 6.5 }] : [],
      });
      canvas.render(ov);
    }

    /* ----- Motor ----- */
    const hiloEl = $("#ed-hilo");
    const estadoEl = $("#ed-estado");
    let motor = new Motor(grafo, (modo) => {
      hiloEl.textContent = modo === "worker" ? "Web Worker (hilo aparte)" : "Hilo principal";
      estadoEl.textContent =
        modo === "worker"
          ? "La página solo dibuja; BFS, Bellman-Ford y Edmonds-Karp corren en otro hilo."
          : "Este navegador no permite Workers aquí (p. ej. al abrir index.html con file://). Sirve la app con «python app.py» para calcular sin congelar la página.";
    });

    const fps = crearMedidorFPS($("#ed-fps"));

    /* ----- Métricas: tamaño, memoria y almacenamiento ----- */
    function guardar() {
      try {
        localStorage.setItem(CLAVE_LS, JSON.stringify(cambios));
      } catch (err) {
        avisar("No se pudo guardar en el navegador (espacio lleno o bloqueado). Los cambios siguen en la página.");
      }
    }

    function kpis() {
      const mem = grafo.memoriaEstimada();
      const bytesCambios = KF.bytesUTF8(JSON.stringify(cambios));
      const nuevosV = grafo.V - grafo.baseV;
      const nuevosE = grafo.E - grafo.baseE;
      $("#ed-kpis").innerHTML = `
        <div class="card kpi-1"><div class="card-label">Nodos (V)</div>
          <div class="card-num">${KF.formatNum(grafo.V)}</div>
          <div class="card-note">${KF.formatNum(grafo.baseV)} del dataset + ${KF.formatNum(nuevosV)} agregados</div></div>
        <div class="card kpi-2"><div class="card-label">Aristas (E)</div>
          <div class="card-num">${KF.formatNum(grafo.E)}</div>
          <div class="card-note">${KF.formatNum(grafo.baseE)} del dataset + ${KF.formatNum(nuevosE)} agregadas</div></div>
        <div class="card kpi-3"><div class="card-label">Memoria del grafo</div>
          <div class="card-num">${fmtBytes(mem.total)}</div>
          <div class="card-note">estimada, crece O(V + E): adyacencia, aristas dirigidas y capacidades${ultimaOperacion ? ` · último cambio: ${fmtMs(ultimaOperacion)}` : ""}</div></div>
        <div class="card kpi-4"><div class="card-label">Almacenamiento</div>
          <div class="card-num">${fmtBytes(bytesCSV)}</div>
          <div class="card-note">CSV exportable (nodos + aristas) · en el navegador solo se guardan los cambios: ${fmtBytes(bytesCambios)}</div></div>
      `;
      $("#ed-puntos").innerHTML = `Inicio <strong>${KF.escapeHtml(estado.inicio || "—")}</strong> → destino <strong>${KF.escapeHtml(estado.destino || "—")}</strong>. Cámbialos con los modos «Inicio» y «Destino».`;
    }

    const AYUDA = {
      nodo: "Haz clic en un punto vacío del mapa para crear una ubicación. Si está marcada la casilla, se une con un pasillo a la ubicación más cercana.",
      arista: "Haz clic en dos ubicaciones para unirlas con un pasillo. La distancia sale de la posición (1,5 m por columna y 2,5 m por fila).",
      inicio: "Haz clic en una ubicación para usarla como inicio de la ruta.",
      destino: "Haz clic en una ubicación para usarla como destino de la ruta.",
    };

    function cambiarModo(modo) {
      estado.modo = modo;
      estado.seleccion = null;
      main.querySelectorAll("#ed-modo button").forEach((b) => b.classList.toggle("active", b.dataset.modo === modo));
      $("#ed-ayuda").textContent = AYUDA[modo];
      pintar();
    }

    /** Registra el cambio, lo aplica, avisa al Worker y dibuja solo lo nuevo. */
    function hacer(op) {
      const t0 = performance.now();
      const s = nuevaSalida();
      aplicar(op, s);
      if (!s.nodos.length && !s.aristas.length) return s;
      cambios.push(op);
      motor.enviarCambios(s.delta);
      ultimaOperacion = performance.now() - t0;
      for (const e of s.aristas) canvas.dibujarArista(e, false);
      for (const n of s.nodos) canvas.dibujarNodo(n, false);
      pintar();
      guardar();
      kpis();
      return s;
    }

    /* ----- Clics en el mapa ----- */
    const canvasEl = $("#ed-canvas");
    const alClic = (ev) => {
      // Se puede editar mientras el Worker calcula: el cambio le llega en cuanto termine.
      const p = canvas.aCoordenadas(ev.clientX, ev.clientY);
      if (!p) return;
      const cerca = grafo.masCercano(p.fila, p.col, 0.6);

      if (estado.modo === "nodo") {
        if (grafo.masCercano(p.fila, p.col, 0.3)) {
          avisar("Ya hay una ubicación en ese punto. Haz clic en un espacio libre entre pasillos.");
          return;
        }
        const fila = +p.fila.toFixed(2);
        const col = +p.col.toFixed(2);
        const vecino = estado.conectar ? grafo.masCercano(fila, col, 3) : null;
        const id = `N${String(grafo.nuevos + 1).padStart(4, "0")}`;
        const s = hacer({ t: "n", id, fila, col, unir: vecino ? vecino.id : null, frec: estado.frec });
        const n = s.nodos[0];
        avisar(
          vecino
            ? `Nodo ${n.id} agregado en ${n.zona} y unido a ${vecino.id} (${s.aristas[0].dist} m, congestión ${estado.frec}) en ${fmtMs(ultimaOperacion)}.`
            : `Nodo ${n.id} agregado en ${fmtMs(ultimaOperacion)}. Está aislado: únelo con «+ Arista» para que las rutas lo alcancen.`
        );
        return;
      }

      if (!cerca) {
        avisar("Haz clic sobre una ubicación (punto del mapa).");
        return;
      }

      if (estado.modo === "arista") {
        if (!estado.seleccion) {
          estado.seleccion = cerca.id;
          avisar(`Extremo 1: ${cerca.id}. Ahora haz clic en el otro extremo del pasillo.`);
          pintar();
          return;
        }
        const u = estado.seleccion;
        estado.seleccion = null;
        if (u === cerca.id) {
          avisar("Elige dos ubicaciones distintas.");
          pintar();
          return;
        }
        const s = hacer({ t: "e", u, v: cerca.id, frec: estado.frec });
        if (!s.aristas.length) avisar(`Ya existe un pasillo entre ${u} y ${cerca.id}.`);
        else avisar(`Pasillo ${u} – ${cerca.id} agregado (${s.aristas[0].dist} m, congestión ${estado.frec}) en ${fmtMs(ultimaOperacion)}.`);
        pintar();
        return;
      }

      if (estado.modo === "inicio") estado.inicio = cerca.id;
      if (estado.modo === "destino") estado.destino = cerca.id;
      estado.overlay = {};
      kpis();
      pintar();
    };
    canvasEl.addEventListener("click", alClic);

    /* ----- Ampliar por tandas: la página sigue respondiendo ----- */
    async function ampliar(k) {
      if (estado.ocupado) return;
      estado.ocupado = true;
      const prog = $("#ed-prog");
      const fill = $("#ed-prog-fill");
      const txt = $("#ed-prog-txt");
      prog.hidden = false;
      fps.empezar();
      const t0 = performance.now();
      const semilla = (Date.now() & 0x7fffffff) >>> 0;
      const rng = KF.mulberry32Editable(semilla);
      let hechas = 0;
      const antesV = grafo.V;
      // Se reparte el trabajo en tandas de ~8 ms por cuadro (60 fps ≈ 16 ms por cuadro).
      while (hechas < k) {
        const tTanda = performance.now();
        const delta = [];
        while (hechas < k && performance.now() - tTanda < 8) {
          const r = grafo.agregarFila(rng);
          for (const n of r.nodos) {
            delta.push({ t: "n", id: n.id, fila: n.fila, col: n.col, zona: n.zona });
            bytesCSV += KF.bytesUTF8(KF.GrafoEditable.lineaNodo(n));
          }
          for (const e of r.aristas) {
            delta.push({ t: "e", u: e.u, v: e.v, frec: e.frec, dist: e.dist });
            bytesCSV += KF.bytesUTF8(KF.GrafoEditable.lineaArista(e));
          }
          hechas++;
        }
        delta.push({ t: "filas", rows: grafo.rows });
        motor.enviarCambios(delta);
        fill.style.width = `${(100 * hechas) / k}%`;
        txt.textContent = `${hechas} de ${k} filas · ${KF.formatNum(grafo.V - antesV)} nodos nuevos`;
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
      const ms = performance.now() - t0;
      canvas.reescalar();
      // Una sola entrada en el registro: semilla + filas (se reproduce idéntico al recargar).
      cambios.push({ t: "f", semilla, k });
      guardar();
      ultimaOperacion = ms / Math.max(1, grafo.V - antesV);
      const minFps = fps.terminar();
      prog.hidden = true;
      estado.ocupado = false;
      kpis();
      pintar();
      avisar(
        `Se agregaron ${KF.formatNum(grafo.V - antesV)} nodos en ${fmtMs(ms)} (${fmtMs(ultimaOperacion)} por nodo), repartidos en tandas para no congelar la página` +
          (Number.isFinite(minFps) ? `; la interfaz no bajó de ${Math.round(minFps)} fps.` : ".")
      );
    }

    /* ----- Ejecutar algoritmos en el motor ----- */
    function filaTabla(r) {
      const ops = Object.entries(r.operaciones)
        .map(([k, v]) => `${KF.formatNum(v)} ${k}`)
        .join("<br>");
      return `<tr>
        <td><strong style="color:${KF.PALETA.ALGORITMO[r.alg]}">${KF.NOMBRE[r.alg]}</strong></td>
        <td>${KF.formatNum(r.V)} nodos<br>${KF.formatNum(r.E)} aristas</td>
        <td>${fmtMs(r.ms)}</td>
        <td>${fmtBytes(r.memoriaAux)}</td>
        <td>${ops}</td>
        <td>${KF.escapeHtml(r.resultado)}</td>
        <td><code>${KF.COMPLEJIDAD[r.alg].tiempo}</code><br><code>${KF.COMPLEJIDAD[r.alg].espacio}</code> espacio</td>
        <td>${r.hilo}${r.fpsMin != null ? `<br><span class="card-note">interfaz ≥ ${r.fpsMin} fps</span>` : ""}</td>
      </tr>`;
    }

    function pintarTabla() {
      $("#ed-tabla").innerHTML = estado.resultados.length
        ? estado.resultados.map(filaTabla).join("")
        : `<tr><td colspan="8" class="card-note">Aún no hay ejecuciones.</td></tr>`;
    }

    function botones(ocupado) {
      estado.ocupado = ocupado;
      $("#ed-ruta").disabled = ocupado;
      $("#ed-flujo").disabled = ocupado;
      $("#ed-ampliar").disabled = ocupado;
      $("#ed-reset").disabled = ocupado;
      $("#ed-cancelar").disabled = !ocupado || motor.modo !== "worker";
    }

    async function correr(lista) {
      if (estado.ocupado) return;
      botones(true);
      const tInicio = performance.now();
      const reloj = setInterval(() => {
        avisar(`Calculando… ${fmtMs(performance.now() - tInicio)} (puedes seguir moviendo el mouse sobre el mapa: la página no se congela).`);
      }, 100);
      const nuevos = [];
      try {
        for (const params of lista) {
          fps.empezar();
          const r = await motor.ejecutar(params);
          const m = fps.terminar();
          r.fpsMin = Number.isFinite(m) ? Math.round(m) : null;
          nuevos.push(r);
        }
        estado.resultados = nuevos.concat(estado.resultados).slice(0, 12);
        const ov = {};
        for (const r of nuevos) {
          if (r.alg === "bfs") {
            ov.secondaryPath = r.ruta;
            ov.secondaryColor = KF.PALETA.ALGORITMO.bfs;
          }
          if (r.alg === "bellman_ford") {
            ov.path = r.ruta;
            ov.pathColor = KF.PALETA.ALGORITMO.bellman_ford;
          }
          if (r.alg === "edmonds_karp") ov.minCut = r.corte.map(([u, v]) => ({ u, v }));
        }
        estado.overlay = ov;
        pintarTabla();
        pintar();
        avisar(`Listo en ${fmtMs(performance.now() - tInicio)}: ${nuevos.map((r) => `${KF.NOMBRE[r.alg]} ${fmtMs(r.ms)}`).join(" · ")}.`);
      } catch (err) {
        avisar(err.message === "cancelado" ? "Cálculo cancelado. El motor se reinició con el grafo actual." : `Error: ${err.message}`);
      } finally {
        clearInterval(reloj);
        botones(false);
      }
    }

    /* ----- Controles ----- */
    main.querySelectorAll("#ed-modo button").forEach((b) => b.addEventListener("click", () => cambiarModo(b.dataset.modo)));
    $("#ed-frec").addEventListener("change", (ev) => (estado.frec = ev.target.value));
    $("#ed-conectar").addEventListener("change", (ev) => (estado.conectar = ev.target.checked));
    $("#ed-perfil").addEventListener("change", (ev) => (estado.perfil = ev.target.value));
    $("#ed-zs").addEventListener("change", (ev) => (estado.zonaS = ev.target.value));
    $("#ed-zt").addEventListener("change", (ev) => (estado.zonaT = ev.target.value));
    $("#ed-ampliar").addEventListener("click", () => ampliar(parseInt($("#ed-filas").value, 10)));
    $("#ed-ruta").addEventListener("click", () => {
      if (!grafo.nodos[estado.inicio] || !grafo.nodos[estado.destino]) {
        avisar("Elige un inicio y un destino con los modos «Inicio» y «Destino».");
        return;
      }
      const base = { perfil: estado.perfil, inicio: estado.inicio, destino: estado.destino };
      correr([Object.assign({ alg: "bfs" }, base), Object.assign({ alg: "bellman_ford" }, base)]);
    });
    $("#ed-flujo").addEventListener("click", () => {
      if (estado.zonaS === estado.zonaT) {
        avisar("Elige dos zonas distintas.");
        return;
      }
      correr([{ alg: "edmonds_karp", zonaS: estado.zonaS, zonaT: estado.zonaT }]);
    });
    $("#ed-cancelar").addEventListener("click", () => {
      if (motor.cancelar()) botones(false);
    });
    $("#ed-exportar").addEventListener("click", () => {
      const csv = grafo.aCSV();
      for (const [nombre, texto] of [
        ["nodos_editado.csv", csv.nodos],
        ["aristas_editado.csv", csv.aristas],
      ]) {
        const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      avisar(`Exportados nodos_editado.csv y aristas_editado.csv (${fmtBytes(bytesCSV)}), con las mismas columnas que el dataset: el motor Python los puede leer.`);
    });
    $("#ed-reset").addEventListener("click", () => {
      if (estado.ocupado) return;
      cambios = [];
      try {
        localStorage.removeItem(CLAVE_LS);
      } catch (_) { }
      grafo = KF.GrafoEditable.desdeDataset(data);
      const c = grafo.aCSV();
      bytesCSV = KF.bytesUTF8(c.nodos) + KF.bytesUTF8(c.aristas);
      ultimaOperacion = null;
      canvas.destroy();
      canvas = new EditableCanvas($("#ed-canvas"), grafo, { interactive: false });
      motor.destruir();
      motor = new Motor(grafo, motor.alCambiarEstado);
      estado.overlay = {};
      estado.resultados = [];
      estado.inicio = "F22_C39";
      estado.destino = "F05_C05";
      pintarTabla();
      kpis();
      pintar();
      avisar("Se restableció el dataset original (1 800 nodos y 3 515 aristas).");
    });

    cambiarModo("nodo");
    kpis();
    pintar();
    if (cambios.length) avisar(`Se recuperaron ${cambios.length} cambios guardados en este navegador. «Restablecer» vuelve al dataset original.`);

    ui.registerCleanup(() => {
      canvasEl.removeEventListener("click", alClic);
      fps.detener();
      motor.destruir();
      canvas.destroy();
    });
  };
})(window);
