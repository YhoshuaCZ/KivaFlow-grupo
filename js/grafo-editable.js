/* =========================================================
   KivaFlow · Grafo editable (modelo incremental)
   Agregar un nodo o una arista cuesta O(1): se agrega a las
   listas existentes en vez de reconstruir las 3 515 aristas.
   Se usa igual en la página y en el Web Worker (motor-worker.js).
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  const DIST_H = 1.5; // metros entre columnas vecinas (pasillo horizontal)
  const DIST_V = 2.5; // metros entre filas vecinas (pasillo vertical)
  const VEL = 1.1; // m/s
  const PEN = {
    punta: { Baja: 1.0, Media: 1.5, Alta: 2.0 },
    valle: { Baja: 1.0, Media: 1.2, Alta: 1.4 },
  };
  const CAP = { Baja: 3, Media: 2, Alta: 1 };

  // Estimación de memoria (V8, 64 bits). Son órdenes de magnitud, no mediciones exactas:
  // una entrada de Map u objeto ≈ 56 B, una referencia en un arreglo ≈ 8 B,
  // un objeto pequeño (nodo, arista) ≈ 120 B y un número en arreglo ≈ 8 B.
  const B_ENTRADA = 56;
  const B_REF = 8;
  const B_OBJ = 120;

  function edgeKey(u, v) {
    return u < v ? `${u}|${v}` : `${v}|${u}`;
  }

  function zonaPorColumna(col) {
    if (col <= 12.5) return "Recepción y Almacenamiento";
    if (col <= 26.5) return "Picking";
    return "Empaque y Despacho";
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class GrafoEditable {
    constructor() {
      this.nodos = {}; // id -> nodo
      this.nodeList = [];
      this.ids = [];
      this.aristas = [];
      this.edgeMap = new Map();
      this.adj = {}; // id -> [{to, edge}] (sirve para BFS en ambos perfiles)
      this.directed = { punta: [], valle: [] }; // [u, v, w] por perfil, para Bellman-Ford
      this.cap = {}; // id -> {vecino: capacidad}, para Edmonds-Karp
      this.rows = 45;
      this.cols = 40;
      this.baseV = 0;
      this.baseE = 0;
      this.nuevos = 0; // contador para los ids N0001, N0002…
      this.pasillosNuevos = 0;
      this._celdas = new Map(); // índice espacial: "fila|col" -> [ids], para hallar el nodo más cercano
    }

    /* ---------- Construcción ---------- */

    static desdeDataset(data) {
      const g = new GrafoEditable();
      g.rows = data.rows;
      g.cols = data.cols;
      for (const n of data.nodeList) {
        g._ponerNodo({
          id: n.id,
          fila: n.fila,
          col: n.col,
          zona: n.zona,
          tipo: n.tipo,
          esEstacion: n.esEstacion,
          sku: n.sku,
          nuevo: false,
        });
      }
      for (const e of data.aristas) {
        g._ponerArista({
          u: e.u,
          v: e.v,
          pasillo: e.pasillo,
          dist: e.dist,
          frec: e.frec,
          distAdjPunta: e.distAdjPunta,
          tiempoPunta: e.tiempoPunta,
          distAdjValle: e.distAdjValle,
          tiempoValle: e.tiempoValle,
          zonaOrigen: e.zonaOrigen,
          zonaDestino: e.zonaDestino,
          key: e.key,
          nuevo: false,
        });
      }
      g.baseV = g.nodeList.length;
      g.baseE = g.aristas.length;
      return g;
    }

    /** Versión compacta para enviar al Worker (structured clone). */
    instantanea() {
      return {
        rows: this.rows,
        cols: this.cols,
        nodos: this.nodeList.map((n) => [n.id, n.fila, n.col, n.zona]),
        aristas: this.aristas.map((e) => [e.u, e.v, e.frec, e.dist]),
      };
    }

    static desdeInstantanea(s) {
      const g = new GrafoEditable();
      g.rows = s.rows;
      g.cols = s.cols;
      for (const [id, fila, col, zona] of s.nodos) g._ponerNodo({ id, fila, col, zona, tipo: "", esEstacion: false, sku: "", nuevo: false });
      for (const [u, v, frec, dist] of s.aristas) g._ponerArista(g._armarArista(u, v, frec, dist, false));
      return g;
    }

    /* ---------- Operaciones O(1) ---------- */

    _ponerNodo(n) {
      this.nodos[n.id] = n;
      this.nodeList.push(n);
      this.ids.push(n.id);
      this.adj[n.id] = [];
      this.cap[n.id] = {};
      const k = `${Math.round(n.fila)}|${Math.round(n.col)}`;
      if (!this._celdas.has(k)) this._celdas.set(k, []);
      this._celdas.get(k).push(n.id);
      return n;
    }

    _armarArista(u, v, frec, dist, nuevo) {
      const a = this.nodos[u];
      const b = this.nodos[v];
      const d = dist != null ? dist : +Math.hypot((a.col - b.col) * DIST_H, (a.fila - b.fila) * DIST_V).toFixed(3);
      const dP = +(d * PEN.punta[frec]).toFixed(3);
      const dV = +(d * PEN.valle[frec]).toFixed(3);
      return {
        u,
        v,
        pasillo: nuevo ? `PN${String(++this.pasillosNuevos).padStart(4, "0")}` : "",
        dist: d,
        frec,
        distAdjPunta: dP,
        tiempoPunta: +(dP / VEL).toFixed(3),
        distAdjValle: dV,
        tiempoValle: +(dV / VEL).toFixed(3),
        zonaOrigen: a.zona,
        zonaDestino: b.zona,
        key: edgeKey(u, v),
        nuevo,
      };
    }

    _ponerArista(e) {
      this.aristas.push(e);
      this.edgeMap.set(e.key, e);
      this.adj[e.u].push({ to: e.v, edge: e });
      this.adj[e.v].push({ to: e.u, edge: e });
      this.directed.punta.push([e.u, e.v, e.tiempoPunta], [e.v, e.u, e.tiempoPunta]);
      this.directed.valle.push([e.u, e.v, e.tiempoValle], [e.v, e.u, e.tiempoValle]);
      const c = CAP[e.frec] || 2;
      this.cap[e.u][e.v] = c;
      this.cap[e.v][e.u] = c;
      return e;
    }

    /** Agrega una ubicación en (fila, col). Devuelve el nodo nuevo. O(1). */
    agregarNodo(fila, col, opts = {}) {
      const id = opts.id || `N${String(++this.nuevos).padStart(4, "0")}`;
      if (this.nodos[id]) throw new Error(`El nodo ${id} ya existe`);
      const zona = opts.zona || zonaPorColumna(col);
      return this._ponerNodo({
        id,
        fila,
        col,
        zona,
        tipo: opts.tipo || "Rack (agregado)",
        esEstacion: false,
        sku: "",
        nuevo: true,
      });
    }

    /** Agrega un pasillo entre u y v. Devuelve la arista o null si no es válida. O(1). */
    agregarArista(u, v, frec = "Baja", dist = null) {
      if (u === v || !this.nodos[u] || !this.nodos[v]) return null;
      if (!PEN.punta[frec]) frec = "Baja";
      if (this.edgeMap.has(edgeKey(u, v))) return null;
      return this._ponerArista(this._armarArista(u, v, frec, dist, true));
    }

    /** Nodo más cercano a (fila, col) dentro de `radio` celdas. Revisa solo las celdas vecinas: O(1) en promedio. */
    masCercano(fila, col, radio = 0.75, excluir = null) {
      let best = null;
      let bestD = radio * radio;
      const r = Math.ceil(radio);
      const f0 = Math.round(fila);
      const c0 = Math.round(col);
      for (let df = -r; df <= r; df++) {
        for (let dc = -r; dc <= r; dc++) {
          const lista = this._celdas.get(`${f0 + df}|${c0 + dc}`);
          if (!lista) continue;
          for (const id of lista) {
            if (id === excluir) continue;
            const n = this.nodos[id];
            const d = (n.fila - fila) ** 2 + (n.col - col) ** 2;
            if (d <= bestD) {
              bestD = d;
              best = n;
            }
          }
        }
      }
      return best;
    }

    /**
     * Amplía el almacén con una fila nueva debajo de la última (40 ubicaciones),
     * con pasillos horizontales entre ellas y verticales hacia la fila de arriba.
     * Devuelve { nodos, aristas } agregados. Costo O(columnas).
     */
    agregarFila(rng) {
      const f = this.rows;
      const rand = rng || Math.random;
      const nodos = [];
      const aristas = [];
      const nivel = () => {
        const x = rand();
        return x < 0.55 ? "Baja" : x < 0.85 ? "Media" : "Alta";
      };
      for (let c = 0; c < this.cols; c++) {
        nodos.push(this.agregarNodo(f, c, { id: `F${pad2(f)}_C${pad2(c)}`, tipo: "Rack (ampliación)" }));
      }
      for (let c = 0; c < this.cols; c++) {
        const id = `F${pad2(f)}_C${pad2(c)}`;
        if (c > 0) aristas.push(this.agregarArista(`F${pad2(f)}_C${pad2(c - 1)}`, id, nivel(), DIST_H));
        const arriba = `F${pad2(f - 1)}_C${pad2(c)}`;
        if (this.nodos[arriba]) aristas.push(this.agregarArista(arriba, id, nivel(), DIST_V));
      }
      // Las filas de ampliación siguen la cuadrícula: se dibujan como el resto del almacén.
      for (const n of nodos) n.ampliacion = true;
      for (const e of aristas) if (e) e.ampliacion = true;
      this.rows = f + 1;
      return { nodos, aristas: aristas.filter(Boolean) };
    }

    /* ---------- Métricas: memoria y almacenamiento ---------- */

    get V() {
      return this.nodeList.length;
    }

    get E() {
      return this.aristas.length;
    }

    /**
     * Memoria estimada del grafo en la página (bytes): objetos nodo y arista,
     * lista de adyacencia (2 entradas por arista), aristas dirigidas de los
     * dos perfiles (4 por arista) y capacidades (2 por arista). Crece O(V + E).
     */
    memoriaEstimada() {
      const V = this.V;
      const E = this.E;
      const nodos = V * (B_OBJ + B_ENTRADA + B_REF);
      const aristas = E * (B_OBJ + B_ENTRADA + B_REF);
      const adyacencia = V * B_ENTRADA + 2 * E * (B_OBJ / 2 + B_REF);
      const dirigidas = 4 * E * (3 * B_REF + 32);
      const capacidades = V * B_ENTRADA + 2 * E * B_ENTRADA;
      return { total: nodos + aristas + adyacencia + dirigidas + capacidades, nodos, aristas, adyacencia, dirigidas, capacidades };
    }

    static lineaNodo(n) {
      return `${n.id},${+n.fila.toFixed(3)},${+n.col.toFixed(3)},${n.zona},${n.tipo || "Rack de almacenamiento"},${n.sku || ""}\n`;
    }

    static lineaArista(e) {
      return `${e.u},${e.v},${e.pasillo},${e.dist},${e.frec},${e.distAdjPunta},${e.tiempoPunta},${e.zonaOrigen},${e.zonaDestino}\n`;
    }

    /** CSV con las mismas columnas que data/nodos.csv y data/aristas.csv. */
    aCSV() {
      let nodos = "Nodo,Fila,Columna,Zona,Tipo_Ubicacion,SKU_Principal\n";
      for (const n of this.nodeList) nodos += GrafoEditable.lineaNodo(n);
      let aristas = "Nodo_Origen,Nodo_Destino,Pasillo,Distancia_m,Frecuencia_Pedidos,Distancia_Ajustada_m,Tiempo_Estimado_s,Zona_Origen,Zona_Destino\n";
      for (const e of this.aristas) aristas += GrafoEditable.lineaArista(e);
      return { nodos, aristas };
    }
  }

  /**
   * Ejecuta un algoritmo sobre el grafo y mide tiempo, operaciones y memoria auxiliar.
   * La usa el Worker y, si el navegador no permite Workers (p. ej. al abrir el
   * archivo con file://), también la página.
   */
  function ejecutarEnGrafo(grafo, msg) {
    const { alg, perfil, inicio, destino, zonaS, zonaT } = msg;
    const V = grafo.V;
    const E = grafo.E;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const t0 = now();
    let salida;

    if (alg === "bfs") {
      const r = KF.bfs(grafo.adj, inicio, destino);
      const ms = now() - t0;
      let metros = 0;
      let segundos = 0;
      for (let i = 0; i + 1 < r.path.length; i++) {
        const e = grafo.edgeMap.get(edgeKey(r.path[i], r.path[i + 1]));
        metros += e.dist;
        segundos += perfil === "valle" ? e.tiempoValle : e.tiempoPunta;
      }
      salida = {
        ms,
        ruta: r.path,
        operaciones: { "nodos visitados": r.visited, "aristas revisadas": r.edgesChecked },
        resultado: r.path.length ? `${r.path.length - 1} pasillos · ${metros.toFixed(1)} m · ${segundos.toFixed(1)} s` : "sin ruta",
        memoriaAux: memoriaAuxiliar("bfs", { visitados: r.visited, V }),
      };
    } else if (alg === "bellman_ford") {
      const r = KF.bellmanFordPath(grafo.ids, grafo.directed[perfil], inicio, destino);
      const ms = now() - t0;
      let metros = 0;
      for (let i = 0; i + 1 < r.path.length; i++) {
        metros += grafo.edgeMap.get(edgeKey(r.path[i], r.path[i + 1])).dist;
      }
      salida = {
        ms,
        ruta: r.path,
        operaciones: { rondas: r.stats.rounds, relajaciones: r.stats.relaxations, "aristas revisadas": r.stats.edgesChecked },
        resultado: r.path.length ? `${r.path.length - 1} pasillos · ${metros.toFixed(1)} m · ${r.cost.toFixed(1)} s` : "sin ruta",
        memoriaAux: memoriaAuxiliar("bellman_ford", { V }),
      };
    } else if (alg === "edmonds_karp") {
      let entradas = 0;
      for (const u in grafo.cap) entradas += Object.keys(grafo.cap[u]).length;
      let extremos = 0;
      for (const n of grafo.nodeList) if (n.zona === zonaS || n.zona === zonaT) extremos++;
      const r = KF.edmondsKarpBetweenZones(grafo.cap, grafo.nodos, zonaS, zonaT);
      const ms = now() - t0;
      const corte = r.minCut.map((c) => [c.u, c.v]);
      salida = {
        ms,
        ruta: [],
        corte,
        operaciones: { "caminos de aumento": r.augmentingPaths },
        resultado: `flujo máximo ${r.maxFlow} u. · corte mínimo ${corte.length} pasillos`,
        memoriaAux: memoriaAuxiliar("edmonds_karp", { V, entradasResidual: entradas + extremos }),
      };
    } else {
      throw new Error(`Algoritmo desconocido: ${alg}`);
    }
    return Object.assign({ tipo: "resultado", id: msg.id, alg, V, E }, salida);
  }

  /** Bytes que ocupa un texto en UTF-8. */
  function bytesUTF8(texto) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(texto).length;
    return unescape(encodeURIComponent(texto)).length;
  }

  /** Memoria auxiliar estimada que reserva cada algoritmo durante una ejecución (bytes). */
  function memoriaAuxiliar(alg, stats) {
    if (alg === "bfs") {
      // padre + nivel (Map) y la cola (arreglo) solo para los nodos alcanzados
      return stats.visitados * (2 * B_ENTRADA + B_REF);
    }
    if (alg === "bellman_ford") {
      // dist + padre (Map) para los V nodos
      return stats.V * 2 * B_ENTRADA;
    }
    // Edmonds-Karp: copia residual de las capacidades + padre del BFS de aumento
    return (stats.entradasResidual || 0) * B_ENTRADA + stats.V * (B_ENTRADA + B_REF);
  }

  KF.GrafoEditable = GrafoEditable;
  KF.ejecutarEnGrafo = ejecutarEnGrafo;
  KF.bytesUTF8 = bytesUTF8;
  KF.memoriaAuxiliar = memoriaAuxiliar;
  KF.zonaPorColumna = zonaPorColumna;
  KF.mulberry32Editable = mulberry32;
})(typeof window !== "undefined" ? window : self);
