/* =========================================================
   KivaFlow · Carga y modelado del grafo (Dataset TB1)
   45 filas × 40 columnas = 1 800 nodos · 3 515 aristas
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  KF.PALETA = {
    PAPEL: "#F3F4F6",
    TARJETA: "#FFFFFF",
    BORDE: "#DFE6EF",
    TINTA: "#00296B",
    SUAVE: "#516682",
    REJILLA: "#E3E9F1",
    ALGORITMO: {
      bfs: "#3365A0",
      bellman_ford: "#00296B",
      edmonds_karp: "#C1121F",
    },
    ALGORITMO_CLARO: {
      bfs: "#CDE0F5",
      bellman_ford: "#BCCFE8",
      edmonds_karp: "#F7CFD2",
    },
    FRENTE: "#FDC500",
    NUEVO: "#7C3AED",
    AVERIA: "#C1121F",
    CONGESTION: { Baja: "#DCE4EE", Media: "#EAB308", Alta: "#E05A2B" },
    CONGESTION_SUAVE: { Baja: "#E3EAF2", Media: "#E8C65A", Alta: "#E67E53" },
    ZONA: {
      "Recepción y Almacenamiento": "#00296B",
      Picking: "#3365A0",
      "Empaque y Despacho": "#D49B00",
    },
  };

  KF.ZONAS = [
    "Recepción y Almacenamiento",
    "Picking",
    "Empaque y Despacho",
  ];

  KF.NOMBRE = {
    bfs: "BFS",
    bellman_ford: "Bellman-Ford",
    edmonds_karp: "Edmonds-Karp",
  };

  KF.MODELOS_SIM = {
    bfs: "BFS (Menos pasillos)",
    bellman_ford: "Bellman-Ford (Menor tiempo)",
    edmonds_karp: "Edmonds-Karp + B-F (Anti-cuellos)",
  };

  KF.COMPLEJIDAD = {
    bfs: { tiempo: "O(V + E)", espacio: "O(V)" },
    bellman_ford: { tiempo: "O(V · E)", espacio: "O(V)" },
    edmonds_karp: { tiempo: "O(V · E²)", espacio: "O(V + E)" },
  };

  // Reglas del dataset TB1:
  // Distancia horizontal = 1.5 m, vertical = 2.5 m, velocidad = 1.1 m/s.
  // En hora punta (dataset base): Baja ×1.0, Media ×1.5, Alta ×2.0.
  // En hora valle (menor congestión): Baja ×1.0, Media ×1.2, Alta ×1.4.
  KF.VELOCIDAD_MS = 1.1;
  KF.PENALIZACION = {
    punta: { Baja: 1.0, Media: 1.5, Alta: 2.0 },
    valle: { Baja: 1.0, Media: 1.2, Alta: 1.4 },
  };
  KF.CAPACIDAD = { Baja: 3, Media: 2, Alta: 1 };

  KF.mulberry32 = function (seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  KF.edgeKey = function (u, v) {
    return u < v ? `${u}|${v}` : `${v}|${u}`;
  };

  KF.formatNum = function (n, dec = 0) {
    if (dec > 0) return n.toFixed(dec);
    return Math.round(n)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  };

  KF.escapeHtml = function (str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  function parseCSV(text) {
    const clean = text.replace(/^\uFEFF/, "").trim();
    const lines = clean.split(/\r?\n/);
    const headers = lines[0].split(",").map((h) => h.replace(/^\uFEFF/, "").trim());
    const rows = new Array(lines.length - 1);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = (cols[j] || "").trim();
      }
      rows[i - 1] = obj;
    }
    return rows;
  }

  KF.loadDataset = async function () {
    let nodosText, aristasText;
    if (global.KIVAFLOW_CSV && global.KIVAFLOW_CSV.nodos && global.KIVAFLOW_CSV.aristas) {
      nodosText = global.KIVAFLOW_CSV.nodos;
      aristasText = global.KIVAFLOW_CSV.aristas;
    } else {
      const [rn, ra] = await Promise.all([
        fetch("data/nodos.csv"),
        fetch("data/aristas.csv"),
      ]);
      nodosText = await rn.text();
      aristasText = await ra.text();
    }
    const data = KF.construirDataset(nodosText, aristasText);
    KF.DATA = data;
    return data;
  };

  /** Arma el grafo desde el texto de los CSV. Lo usan la página y el Web Worker. */
  KF.construirDataset = function (nodosText, aristasText) {
    const rawNodos = parseCSV(nodosText);
    const rawAristas = parseCSV(aristasText);

    const nodos = {};
    const nodeList = [];
    const estaciones = [];
    const estacionesDespacho = [];
    const racks = [];
    const racksPicking = [];
    const skuMap = new Map();
    const zoneCounts = {};

    for (const r of rawNodos) {
      const fila = parseInt(r.Fila, 10);
      const col = parseInt(r.Columna, 10);
      const nodo = {
        id: r.Nodo,
        fila,
        col,
        zona: r.Zona,
        tipo: r.Tipo_Ubicacion,
        esEstacion: r.Tipo_Ubicacion === "Estación de trabajo",
        sku: r.SKU_Principal || "",
      };
      nodos[nodo.id] = nodo;
      nodeList.push(nodo);
      zoneCounts[nodo.zona] = (zoneCounts[nodo.zona] || 0) + 1;
      if (nodo.esEstacion) {
        estaciones.push(nodo.id);
        if (nodo.zona === "Empaque y Despacho") estacionesDespacho.push(nodo.id);
      } else {
        racks.push(nodo.id);
        if (nodo.zona === "Picking") racksPicking.push(nodo.id);
      }
      if (nodo.sku) {
        if (!skuMap.has(nodo.sku)) skuMap.set(nodo.sku, []);
        skuMap.get(nodo.sku).push(nodo.id);
      }
    }

    const aristas = [];
    const edgeMap = new Map();
    const freqCounts = { Baja: 0, Media: 0, Alta: 0 };

    for (const r of rawAristas) {
      const dist = parseFloat(r.Distancia_m);
      const distAdj = parseFloat(r.Distancia_Ajustada_m);
      const tiempoPunta = parseFloat(r.Tiempo_Estimado_s);
      const frec = r.Frecuencia_Pedidos;
      const penValle = KF.PENALIZACION.valle[frec] || 1.0;
      const distValle = +(dist * penValle).toFixed(3);
      const tiempoValle = +(distValle / KF.VELOCIDAD_MS).toFixed(3);

      const e = {
        u: r.Nodo_Origen,
        v: r.Nodo_Destino,
        pasillo: r.Pasillo,
        dist,
        frec,
        distAdjPunta: distAdj,
        tiempoPunta,
        distAdjValle: distValle,
        tiempoValle,
        zonaOrigen: r.Zona_Origen,
        zonaDestino: r.Zona_Destino,
        key: KF.edgeKey(r.Nodo_Origen, r.Nodo_Destino),
      };
      aristas.push(e);
      edgeMap.set(e.key, e);
      freqCounts[frec] = (freqCounts[frec] || 0) + 1;
    }

    function buildGraph(profile) {
      const adj = {};
      const directed = [];
      for (const n of nodeList) adj[n.id] = [];
      for (const e of aristas) {
        const w = profile === "valle" ? e.tiempoValle : e.tiempoPunta;
        adj[e.u].push({ to: e.v, w, edge: e });
        adj[e.v].push({ to: e.u, w, edge: e });
        directed.push([e.u, e.v, w]);
        directed.push([e.v, e.u, w]);
      }
      return { adj, directed };
    }

    const graphs = {
      punta: buildGraph("punta"),
      valle: buildGraph("valle"),
    };

    function buildCapacities(customLevels) {
      const cap = {};
      for (const n of nodeList) cap[n.id] = {};
      for (const e of aristas) {
        const lvl = customLevels ? customLevels.get(e.key) || "Baja" : e.frec;
        const c = KF.CAPACIDAD[lvl] || 2;
        cap[e.u][e.v] = c;
        cap[e.v][e.u] = c;
      }
      return cap;
    }

    function nearestRackForSku(sku, fromNodeId, excludedSet) {
      const candidates = skuMap.get((sku || "").trim().toUpperCase());
      if (!candidates || candidates.length === 0) return null;
      const excl = excludedSet || new Set();
      const avail = candidates.filter((id) => !excl.has(id));
      const pool = avail.length > 0 ? avail : candidates;
      const ref = nodos[fromNodeId];
      if (!ref) return pool[0];
      let bestId = pool[0];
      let bestDist = Infinity;
      for (const id of pool) {
        const n = nodos[id];
        const d = Math.abs(n.fila - ref.fila) + Math.abs(n.col - ref.col);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }
      return bestId;
    }

    const data = {
      nodos,
      nodeList,
      ids: nodeList.map((n) => n.id),
      aristas,
      edgeMap,
      estaciones,
      estacionesDespacho,
      racks,
      racksPicking,
      skuMap,
      nearestRackForSku,
      zoneCounts,
      freqCounts,
      graphs,
      buildCapacities,
      rows: 45,
      cols: 40,
      _csv: { nodos: nodosText, aristas: aristasText },
    };
    if (KF.hacerEditable) KF.hacerEditable(data);
    return data;
  };
})(typeof window !== "undefined" ? window : self);
