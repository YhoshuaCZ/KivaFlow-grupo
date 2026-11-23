/* =========================================================
   KivaFlow · Edición incremental del grafo
   Agregar una ubicación o un pasillo cuesta O(1): se suma a las
   listas que ya existen (adyacencia, aristas dirigidas de punta y
   valle, índice espacial) en vez de reconstruir las 3 515 aristas.
   Se usa igual en la página y en el Web Worker (motor-worker.js),
   que aplican la misma lista de cambios y quedan sincronizados.
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  const DIST_H = 1.5; // metros entre columnas vecinas
  const DIST_V = 2.5; // metros entre filas vecinas

  // Estimación de memoria en V8 (64 bits). Son órdenes de magnitud, no mediciones exactas.
  const B = { ENTRADA: 56, REF: 8, OBJ: 120, NUM: 8 };
  KF.BYTES = B;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  KF.zonaPorColumna = function (col) {
    if (col <= 12.5) return "Recepción y Almacenamiento";
    if (col <= 26.5) return "Picking";
    return "Empaque y Despacho";
  };

  KF.hacerEditable = function (data) {
    data.baseV = data.nodeList.length;
    data.baseE = data.aristas.length;
    data.nuevos = 0;
    data.pasillosNuevos = 0;
    data.version = 0;
    data._celdas = new Map();
    for (const n of data.nodeList) indexar(data, n);

    data.agregarNodo = function (fila, col, opts = {}) {
      const id = opts.id || `N${String(++data.nuevos).padStart(4, "0")}`;
      if (data.nodos[id]) return null;
      const n = {
        id,
        fila,
        col,
        zona: opts.zona || KF.zonaPorColumna(col),
        tipo: opts.tipo || "Ubicación agregada",
        esEstacion: false,
        sku: "",
        nuevo: true,
        ampliacion: !!opts.ampliacion,
      };
      data.nodos[id] = n;
      data.nodeList.push(n);
      data.ids.push(id);
      data.racks.push(id);
      if (n.zona === "Picking") data.racksPicking.push(id);
      data.zoneCounts[n.zona] = (data.zoneCounts[n.zona] || 0) + 1;
      data.graphs.punta.adj[id] = [];
      data.graphs.valle.adj[id] = [];
      indexar(data, n);
      data.version++;
      return n;
    };

    data.agregarArista = function (u, v, frec = "Baja", dist = null, opts = {}) {
      if (u === v || !data.nodos[u] || !data.nodos[v]) return null;
      const key = KF.edgeKey(u, v);
      if (data.edgeMap.has(key)) return null;
      if (!KF.PENALIZACION.punta[frec]) frec = "Baja";
      const a = data.nodos[u];
      const b = data.nodos[v];
      const d = dist != null ? dist : +Math.hypot((a.col - b.col) * DIST_H, (a.fila - b.fila) * DIST_V).toFixed(3);
      const dP = +(d * KF.PENALIZACION.punta[frec]).toFixed(3);
      const dV = +(d * KF.PENALIZACION.valle[frec]).toFixed(3);
      const e = {
        u,
        v,
        pasillo: `PN${String(++data.pasillosNuevos).padStart(4, "0")}`,
        dist: d,
        frec,
        distAdjPunta: dP,
        tiempoPunta: +(dP / KF.VELOCIDAD_MS).toFixed(3),
        distAdjValle: dV,
        tiempoValle: +(dV / KF.VELOCIDAD_MS).toFixed(3),
        zonaOrigen: a.zona,
        zonaDestino: b.zona,
        key,
        nuevo: true,
        ampliacion: !!opts.ampliacion,
      };
      data.aristas.push(e);
      data.edgeMap.set(key, e);
      for (const perfil of ["punta", "valle"]) {
        const w = perfil === "valle" ? e.tiempoValle : e.tiempoPunta;
        const g = data.graphs[perfil];
        g.adj[u].push({ to: v, w, edge: e });
        g.adj[v].push({ to: u, w, edge: e });
        g.directed.push([u, v, w], [v, u, w]);
      }
      data.freqCounts[frec] = (data.freqCounts[frec] || 0) + 1;
      data.version++;
      return e;
    };

    /** Ubicación más cercana a (fila, col) dentro de `radio` celdas. Solo mira las celdas vecinas: O(1) en promedio. */
    data.masCercano = function (fila, col, radio = 0.75, excluir = null) {
      let best = null;
      let bestD = radio * radio;
      const r = Math.ceil(radio);
      const f0 = Math.round(fila);
      const c0 = Math.round(col);
      for (let df = -r; df <= r; df++) {
        for (let dc = -r; dc <= r; dc++) {
          const lista = data._celdas.get(`${f0 + df}|${c0 + dc}`);
          if (!lista) continue;
          for (const id of lista) {
            if (id === excluir) continue;
            const n = data.nodos[id];
            const d = (n.fila - fila) ** 2 + (n.col - col) ** 2;
            if (d <= bestD) {
              bestD = d;
              best = n;
            }
          }
        }
      }
      return best;
    };

    /** Agrega una fila de 40 ubicaciones debajo de la última, con sus pasillos. O(columnas). */
    data.agregarFila = function (rng) {
      const f = data.rows;
      const rand = rng || Math.random;
      const nivel = () => {
        const x = rand();
        return x < 0.55 ? "Baja" : x < 0.85 ? "Media" : "Alta";
      };
      for (let c = 0; c < data.cols; c++) {
        data.agregarNodo(f, c, { id: `F${pad2(f)}_C${pad2(c)}`, tipo: "Rack (ampliación)", ampliacion: true });
      }
      for (let c = 0; c < data.cols; c++) {
        const id = `F${pad2(f)}_C${pad2(c)}`;
        if (c > 0) data.agregarArista(`F${pad2(f)}_C${pad2(c - 1)}`, id, nivel(), DIST_H, { ampliacion: true });
        const arriba = `F${pad2(f - 1)}_C${pad2(c)}`;
        if (data.nodos[arriba]) data.agregarArista(arriba, id, nivel(), DIST_V, { ampliacion: true });
      }
      data.rows = f + 1;
    };

    return data;
  };

  function indexar(data, n) {
    const k = `${Math.round(n.fila)}|${Math.round(n.col)}`;
    if (!data._celdas.has(k)) data._celdas.set(k, []);
    data._celdas.get(k).push(n.id);
  }

  /**
   * Aplica un cambio del registro. El registro es lo único que se guarda y se envía
   * al Worker, así ambos grafos quedan idénticos.
   *   {t:"n", id, fila, col, unir, frec}  ubicación (y pasillo hacia `unir`, si hay)
   *   {t:"e", u, v, frec}                 pasillo entre dos ubicaciones
   *   {t:"f", semilla, desde, k}          k filas de ampliación
   */
  KF.aplicarCambio = function (data, op, k0, k1) {
    if (op.t === "n") {
      const n = data.agregarNodo(op.fila, op.col, { id: op.id });
      const num = /^N(\d+)$/.exec(op.id);
      if (num) data.nuevos = Math.max(data.nuevos, parseInt(num[1], 10));
      if (n && op.unir) data.agregarArista(op.id, op.unir, op.frec);
    } else if (op.t === "e") {
      data.agregarArista(op.u, op.v, op.frec);
    } else if (op.t === "f") {
      // Cada fila usa su propia semilla para poder aplicarlas por partes sin perder el determinismo.
      const desde = k0 != null ? k0 : 0;
      const hasta = k1 != null ? k1 : op.k;
      for (let i = desde; i < hasta; i++) data.agregarFila(KF.mulberry32(op.semilla * 1000 + i));
    }
  };

  /** Memoria estimada del grafo cargado (nodos, aristas, adyacencia y aristas dirigidas de los 2 perfiles). */
  KF.memoriaGrafo = function (data) {
    const V = data.nodeList.length;
    const E = data.aristas.length;
    return (
      V * (B.OBJ + B.ENTRADA + B.REF) +
      E * (B.OBJ + B.ENTRADA + B.REF) +
      2 * (V * B.ENTRADA + 2 * E * (B.OBJ / 2 + B.REF)) +
      2 * (2 * E * (3 * B.NUM + 32))
    );
  };

  KF.formatBytes = function (b) {
    if (b == null || !Number.isFinite(b)) return "—";
    if (b < 1024) return `${Math.round(b)} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
  };

  KF.formatMs = function (ms) {
    if (ms == null || !Number.isFinite(ms)) return "—";
    if (ms < 1) return `${ms.toFixed(2)} ms`;
    if (ms < 100) return `${ms.toFixed(1)} ms`;
    return `${Math.round(ms)} ms`;
  };
})(typeof window !== "undefined" ? window : self);
