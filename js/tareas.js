/* =========================================================
   KivaFlow · Tareas de cálculo + mediciones
   Cada tarea corre el algoritmo y mide tres cosas por algoritmo:
     · Tiempo: performance.now() alrededor del algoritmo.
     · Memoria: RAM de trabajo estimada a partir de las estructuras
       auxiliares que crea (cola, padres, distancias, red residual…).
     · Almacenamiento: bytes que ocupa guardar como texto la estructura
       de entrada que usa el algoritmo más el resultado que entrega.
   Corren en el Web Worker (motor-worker.js) o, si el navegador no
   permite Workers, en la página.
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});
  const B = KF.BYTES || { ENTRADA: 56, REF: 8, OBJ: 120, NUM: 8 };

  const ahora = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

  /* ---------- Almacenamiento de la estructura de entrada (se cachea por versión del grafo) ---------- */
  function almEntrada(data, alg, perfil) {
    const clave = `${data.version}|${data.nodeList.length}|${data.aristas.length}|${alg}|${perfil}`;
    data._almCache = data._almCache || new Map();
    if (data._almCache.has(clave)) return data._almCache.get(clave);
    let bytes = 0;
    if (alg === "bfs") {
      // Lista de adyacencia sin pesos: "id:vecino,vecino,…\n"
      const adj = data.graphs.punta.adj;
      for (const id of data.ids) {
        bytes += id.length + 2;
        for (const nb of adj[id] || []) bytes += nb.to.length + 1;
      }
    } else if (alg === "bellman_ford") {
      // Lista de aristas dirigidas con peso: "u,v,w\n"
      for (const [u, v, w] of data.graphs[perfil].directed) bytes += u.length + v.length + String(w).length + 3;
    } else {
      // Capacidades en ambos sentidos: "u,v,c\n"
      for (const e of data.aristas) bytes += 2 * (e.u.length + e.v.length + 4);
    }
    data._almCache.set(clave, bytes);
    return bytes;
  }

  const bytesJSON = (x) => JSON.stringify(x).length;

  function medicion(o) {
    return Object.assign(
      {
        hilo: typeof window === "undefined" || global.document === undefined ? "Web Worker" : "hilo principal",
      },
      o,
      { V: o.V, E: o.E }
    );
  }

  /* ---------- Cuadros compactos: un solo arreglo de visitados por tramo en vez de un Set por cuadro ---------- */
  function compactarCuadros(frames) {
    const orden = [];
    let prev = null;
    let ini = 0;
    const out = frames.map((f) => {
      const mismoTramo = prev && prev.counters.tramo === f.counters.tramo && f.visited.size >= prev.visited.size;
      if (!mismoTramo) {
        ini = orden.length;
        for (const id of f.visited) orden.push(id);
      } else {
        let i = 0;
        for (const id of f.visited) {
          if (i++ >= prev.visited.size) orden.push(id);
        }
      }
      prev = f;
      return {
        work: f.work,
        path: f.path,
        line: f.line,
        narration: f.narration,
        counters: f.counters,
        frontier: Array.from(f.frontier),
        vIni: ini,
        vFin: orden.length,
      };
    });
    return { orden, cuadros: out };
  }

  /** En la página: vuelve a dar a cada cuadro sus Set `visited` y `frontier`, creados solo cuando se dibujan. */
  KF.hidratarCuadros = function (pack) {
    const { orden, cuadros } = pack;
    let cacheIdx = -1;
    let cacheSet = null;
    return cuadros.map((c, idx) => {
      const f = Object.assign({}, c);
      const frontier = new Set(c.frontier);
      Object.defineProperty(f, "frontier", { value: frontier, enumerable: true });
      Object.defineProperty(f, "visited", {
        enumerable: true,
        get() {
          if (cacheIdx !== idx) {
            cacheSet = new Set(orden.slice(c.vIni, c.vFin));
            cacheIdx = idx;
          }
          return cacheSet;
        },
      });
      return f;
    });
  };

  function memoriaRuta(alg, r, data) {
    const V = data.nodeList.length;
    if (alg === "bfs") {
      // padre + nivel (Map) y la cola, para los nodos del tramo más grande
      let pico = 0;
      for (const s of r.segments || []) pico = Math.max(pico, (s.steps || []).length);
      if (!pico) pico = r.stats.visited;
      return pico * (2 * B.ENTRADA + B.REF);
    }
    // dist + padre (Map) para los V nodos
    return V * 2 * B.ENTRADA;
  }

  const TAREAS = {};

  /** Pedido individual: BFS y/o Bellman-Ford con cuadros para la animación. */
  TAREAS.pedido = function (data, a) {
    const bloqueados = new Set(a.bloqueados || []);
    const salida = {};
    for (const alg of a.algs) {
      const t0 = ahora();
      const r = KF.rutaPedido(data, a.perfil, a.inicio, a.destinos, alg, true, a.regresar, bloqueados);
      const ms = ahora() - t0;
      const m = KF.medirRuta(r.path, data.edgeMap, a.perfil);
      const frames = KF.buildSearchFrames(r.segments, alg, data, a.maxFrames || 180);
      const memoria = memoriaRuta(alg, r, data);
      const ruta = { path: r.path, order: r.order, unreachable: r.unreachable, stats: r.stats };
      salida[alg] = {
        r: ruta,
        m,
        ms,
        frames: compactarCuadros(frames),
        work: frames[frames.length - 1].work,
        medicion: medicion({
          alg,
          etiqueta: KF.NOMBRE[alg],
          ms,
          memoria,
          almacenamiento: almEntrada(data, alg, a.perfil) + bytesJSON(r.path),
          operaciones:
            alg === "bfs"
              ? `${KF.formatNum(r.stats.visited)} nodos visitados · ${KF.formatNum(r.stats.edgesChecked)} aristas`
              : `${KF.formatNum(r.stats.rounds)} rondas · ${KF.formatNum(r.stats.relaxations)} relajaciones`,
          complejidad: KF.COMPLEJIDAD[alg].tiempo,
          V: data.nodeList.length,
          E: data.aristas.length,
        }),
      };
    }
    return salida;
  };

  function memoriaEK(caps, V) {
    let entradas = 0;
    for (const u in caps) entradas += Object.keys(caps[u]).length;
    // red residual (ida y vuelta) + padre y cola del BFS de aumento
    return 2 * entradas * B.ENTRADA + V * (B.ENTRADA + B.REF);
  }

  /** Edmonds-Karp entre dos zonas, con los caminos de aumento para animarlo. */
  TAREAS.flujo = function (data, a) {
    const caps = data.buildCapacities(null);
    const pasos = [];
    const t0 = ahora();
    const res = KF.edmondsKarpBetweenZones(caps, data.nodos, a.origen, a.destino, pasos);
    const ms = ahora() - t0;
    const memoria = memoriaEK(caps, data.nodeList.length);
    return {
      maxFlow: res.maxFlow,
      minCut: res.minCut,
      augmentingPaths: res.augmentingPaths,
      pasos,
      medicion: medicion({
        alg: "edmonds_karp",
        etiqueta: "Edmonds-Karp",
        ms,
        memoria,
        almacenamiento: almEntrada(data, "edmonds_karp") + bytesJSON(res.minCut),
        operaciones: `${res.augmentingPaths} caminos de aumento · flujo ${res.maxFlow}`,
        complejidad: KF.COMPLEJIDAD.edmonds_karp.tiempo,
        V: data.nodeList.length,
        E: data.aristas.length,
      }),
    };
  };

  /**
   * Evita que dos operarios ocupen la misma ubicación en el mismo paso.
   * Planificación por prioridades con una tabla de reservas (nodo, paso) → operario:
   * el operario i respeta lo que ya reservaron los anteriores. En cada paso:
   *   1. si la siguiente ubicación está libre (y nadie viene de frente), avanza;
   *   2. si no, espera en su sitio;
   *   3. si alguien viene justo hacia su sitio, se hace a un lado a una ubicación
   *      vecina libre y luego vuelve a su ruta (cede el paso).
   * Las estaciones de trabajo son áreas amplias: ahí sí pueden coincidir.
   * Cada consulta y reserva cuesta O(1) (Map), así que todo es O(pasos totales · grado).
   */
  KF.evitarColisiones = function (data, operarios) {
    const reservas = new Map();
    const compartido = (id) => !!(data.nodos[id] && data.nodos[id].esEstacion);
    const ocupante = (id, t) => (compartido(id) ? undefined : reservas.get(`${id}@${t}`));
    const reservar = (id, t, op) => {
      if (!compartido(id)) reservas.set(`${id}@${t}`, op);
    };
    const adj = data.graphs.punta.adj;
    const eventos = [];
    let esperas = 0;
    let cesiones = 0;
    let sinResolver = 0;
    let consultas = 0;

    for (const op of operarios) {
      const plan = op.path.slice();
      let idx = 0;
      let t = 0;
      let pos = plan[0];
      const timed = [pos];
      reservar(pos, 0, op.id);
      op.esperas = 0;
      op.cesiones = 0;
      let guardia = 0;
      const tope = plan.length * 8 + 400;
      while (idx < plan.length - 1 && guardia++ < tope) {
        const sig = plan[idx + 1];
        consultas += 3;
        const enSig = ocupante(sig, t + 1);
        const deFrente = ocupante(sig, t);
        const choqueFrontal = deFrente !== undefined && deFrente === ocupante(pos, t + 1);
        if (enSig === undefined && !choqueFrontal) {
          idx++;
          pos = sig;
          t++;
          timed.push(pos);
          reservar(pos, t, op.id);
          continue;
        }
        const otro = enSig !== undefined ? enSig : deFrente;
        if (ocupante(pos, t + 1) === undefined) {
          t++;
          timed.push(pos);
          reservar(pos, t, op.id);
          esperas++;
          op.esperas++;
          eventos.push({ t, op: op.id, tipo: "espera", nodo: pos, hacia: sig, otro });
          continue;
        }
        // Alguien llega a mi ubicación en el siguiente paso: buscar una vecina libre.
        const llega = ocupante(pos, t + 1);
        let lado = null;
        for (const nb of adj[pos] || []) {
          const m = nb.to;
          consultas += 2;
          if (m === sig) continue;
          if (ocupante(m, t + 1) !== undefined) continue;
          const vieneDeM = ocupante(m, t);
          if (vieneDeM !== undefined && vieneDeM === llega) continue;
          lado = m;
          break;
        }
        if (lado) {
          plan.splice(idx + 1, 0, lado, pos);
          idx++;
          const desde = pos;
          pos = lado;
          t++;
          timed.push(pos);
          reservar(pos, t, op.id);
          cesiones++;
          op.cesiones++;
          eventos.push({ t, op: op.id, tipo: "cede", nodo: lado, desde, otro: llega });
        } else {
          idx++;
          pos = sig;
          t++;
          timed.push(pos);
          reservar(pos, t, op.id);
          sinResolver++;
          eventos.push({ t, op: op.id, tipo: "conflicto", nodo: pos, otro });
        }
      }
      op.timed = timed;
      op.pasosExtra = timed.length - op.path.length;
    }
    eventos.sort((x, y) => x.t - y.t || x.op - y.op);
    return { eventos, esperas, cesiones, sinResolver, reservas: reservas.size, consultas };
  };

  /** Turno completo: ruteo de N operarios + choques evitados + Edmonds-Karp sobre la congestión resultante. */
  TAREAS.turno = function (data, opts) {
    const V = data.nodeList.length;
    const E = data.aristas.length;
    const r = KF.simularTurno(data, opts);

    const t0 = ahora();
    const col = KF.evitarColisiones(data, r.operators);
    const msCol = ahora() - t0;
    let maxStep = 0;
    for (const op of r.operators) maxStep = Math.max(maxStep, op.timed.length);
    r.maxStep = maxStep;
    r.colisiones = col;

    const algRuteo = opts.alg === "bfs" ? "bfs" : "bellman_ford";
    let memRuteo =
      algRuteo === "bfs" ? r.stats.pico * (2 * B.ENTRADA + B.REF) : V * 2 * B.ENTRADA + 2 * E * (3 * B.NUM + 32);
    memRuteo += r.stats.usoEntradas * B.ENTRADA; // conteo de cruces por pasillo
    const caps = data.buildCapacities(r.dynamicLevels);
    const rutas = r.operators.map((o) => o.path);

    r.mediciones = [
      medicion({
        alg: opts.alg,
        etiqueta: `Ruteo de ${r.operators.length} operarios · ${KF.MODELOS_SIM[opts.alg]}`,
        ms: r.tiempos.ruteo,
        memoria: memRuteo,
        almacenamiento: almEntrada(data, algRuteo, opts.hora) + bytesJSON(rutas),
        operaciones:
          algRuteo === "bfs"
            ? `${KF.formatNum(r.stats.visitados)} nodos visitados`
            : `${KF.formatNum(r.stats.rondas)} rondas · ${KF.formatNum(r.stats.relajaciones)} relajaciones`,
        complejidad: algRuteo === "bfs" ? "N · O(V + E)" : "N · O(V · E)",
        V,
        E,
      }),
      medicion({
        alg: "reservas",
        etiqueta: "Evitar choques · tabla de reservas",
        ms: msCol,
        memoria: col.reservas * B.ENTRADA + r.operators.length * maxStep * B.REF,
        almacenamiento: bytesJSON(r.operators.map((o) => o.timed)),
        operaciones: `${KF.formatNum(col.reservas)} reservas · ${KF.formatNum(col.consultas)} consultas O(1)`,
        complejidad: "O(pasos · grado)",
        V,
        E,
      }),
      medicion({
        alg: "edmonds_karp",
        etiqueta: "Edmonds-Karp · corte del turno",
        ms: r.tiempos.flujo,
        memoria: memoriaEK(caps, V),
        almacenamiento: almEntrada(data, "edmonds_karp") + bytesJSON(r.flowRes.minCut),
        operaciones: `${r.flowRes.augmentingPaths} caminos de aumento · flujo ${r.flowRes.maxFlow}`,
        complejidad: KF.COMPLEJIDAD.edmonds_karp.tiempo,
        V,
        E,
      }),
    ];
    // La red residual y el conjunto del lado fuente no se usan en la página: no se envían.
    delete r.flowRes.residual;
    delete r.flowRes.sourceSide;
    return r;
  };

  KF.TAREAS = TAREAS;
})(typeof window !== "undefined" ? window : self);
