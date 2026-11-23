/* =========================================================
   KivaFlow · Algoritmos de grafos
   1. BFS (Búsqueda en Anchura)             — O(V + E)
   2. Bellman-Ford (con salida anticipada)  — O(V · E)
   3. Edmonds-Karp (Flujo Máximo / Min-Cut) — O(V · E²)
   + Certificado de optimalidad de caminos mínimos (sin algoritmos externos)
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  KF.PSEUDO = {
    bfs: [
      "visto = {inicio}; cola = [inicio]",
      "mientras la cola no esté vacía:",
      "    u = sacar el primero de la cola",
      "    si u es un destino: devolver la ruta",
      "    para cada vecino v de u:",
      "        si v no está en visto:",
      "            visto += v; padre[v] = u",
      "            meter v al final de la cola",
      "devolver SIN_RUTA",
    ],
    bellman_ford: [
      "dist[*] = ∞; dist[inicio] = 0",
      "repetir (como máximo V − 1 rondas):",
      "    cambio = falso",
      "    para cada arista (u, v, w):",
      "        si dist[u] + w < dist[v]:",
      "            dist[v] = dist[u] + w; padre[v] = u",
      "            cambio = verdadero",
      "    si no hubo cambio: terminar",
      "si una ronda extra mejora: ciclo negativo",
      "devolver dist, padre",
    ],
    edmonds_karp: [
      "flujo = 0; residual = capacidades",
      "mientras BFS halle un camino s → t:",
      "    δ = capacidad mínima del camino",
      "    en cada arista (u, v) del camino:",
      "        residual[u][v] −= δ",
      "        residual[v][u] += δ",
      "    flujo += δ",
      "corte = alcanzables desde s en residual",
      "devolver flujo, corte",
    ],
  };

  function reconstruct(parent, target) {
    const path = [];
    let cur = target;
    while (cur !== null && cur !== undefined) {
      path.push(cur);
      cur = parent.get(cur);
    }
    path.reverse();
    return path;
  }

  /* ---------- 1. BFS ---------- */
  KF.bfs = function (adj, start, targetOrSet, recordSteps, blockedSet) {
    const targets =
      targetOrSet instanceof Set ? targetOrSet : new Set([targetOrSet]);
    const parent = new Map([[start, null]]);
    const level = new Map([[start, 0]]);
    const queue = [start];
    let head = 0;
    let visited = 0;
    let edgesChecked = 0;

    while (head < queue.length) {
      const u = queue[head++];
      visited++;
      const lv = level.get(u);
      if (recordSteps) recordSteps.push({ node: u, level: lv });

      if (targets.has(u)) {
        return {
          path: reconstruct(parent, u),
          visited,
          edgesChecked,
          reached: u,
        };
      }

      const neighbors = adj[u] || [];
      for (let i = 0; i < neighbors.length; i++) {
        edgesChecked++;
        const v = neighbors[i].to;
        if (blockedSet && blockedSet.has(v)) continue;
        if (!parent.has(v)) {
          parent.set(v, u);
          level.set(v, lv + 1);
          queue.push(v);
        }
      }
    }
    return { path: [], visited, edgesChecked, reached: null };
  };

  /* ---------- 2. Bellman-Ford ---------- */
  KF.bellmanFord = function (nodeIds, directedEdges, start, recordSteps, blockedEdgeKeys) {
    const dist = new Map();
    const parent = new Map();
    for (let i = 0; i < nodeIds.length; i++) {
      dist.set(nodeIds[i], Infinity);
      parent.set(nodeIds[i], null);
    }
    dist.set(start, 0);

    let rounds = 0;
    let relaxations = 0;
    let edgesChecked = 0;
    const V = nodeIds.length;
    const E = directedEdges.length;

    for (let iter = 0; iter < V - 1; iter++) {
      rounds++;
      let changed = false;
      const improved = recordSteps ? new Set() : null;

      for (let i = 0; i < E; i++) {
        const edge = directedEdges[i];
        const u = edge[0];
        const v = edge[1];
        const w = edge[2];
        edgesChecked++;
        if (blockedEdgeKeys && blockedEdgeKeys.has(KF.edgeKey(u, v))) continue;
        const du = dist.get(u);
        if (du !== Infinity && du + w < dist.get(v) - 1e-12) {
          dist.set(v, du + w);
          parent.set(v, u);
          relaxations++;
          changed = true;
          if (improved) improved.add(v);
        }
      }
      if (recordSteps) recordSteps.push(Array.from(improved));
      if (!changed) break;
    }

    // Verificación de ciclo negativo solo si se agotaron las V - 1 rondas
    if (rounds === V - 1) {
      for (let i = 0; i < E; i++) {
        const [u, v, w] = directedEdges[i];
        if (blockedEdgeKeys && blockedEdgeKeys.has(KF.edgeKey(u, v))) continue;
        if (dist.get(u) + w < dist.get(v) - 1e-12) {
          throw new Error(`Ciclo negativo detectado en ${u} -> ${v}`);
        }
      }
    }

    return {
      dist,
      parent,
      stats: { rounds, relaxations, edgesChecked },
    };
  };

  KF.bellmanFordPath = function (nodeIds, directedEdges, start, target, blockedEdgeKeys) {
    const res = KF.bellmanFord(nodeIds, directedEdges, start, null, blockedEdgeKeys);
    const cost = res.dist.get(target);
    if (!Number.isFinite(cost)) {
      return { path: [], cost: Infinity, stats: res.stats };
    }
    return { path: reconstruct(res.parent, target), cost, stats: res.stats };
  };

  /* ---------- 3. Edmonds-Karp (Flujo Máximo + Corte Mínimo) ---------- */
  const SUPER_S = "__FUENTE__";
  const SUPER_T = "__SUMIDERO__";

  function bfsAugmenting(residual, s, t) {
    const parent = new Map([[s, null]]);
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const adj = residual[u];
      if (!adj) continue;
      for (const v in adj) {
        if (adj[v] > 0 && !parent.has(v)) {
          parent.set(v, u);
          if (v === t) return parent;
          queue.push(v);
        }
      }
    }
    return null;
  }

  function reachableInResidual(residual, s) {
    const seen = new Set([s]);
    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const adj = residual[u];
      if (!adj) continue;
      for (const v in adj) {
        if (adj[v] > 0 && !seen.has(v)) {
          seen.add(v);
          queue.push(v);
        }
      }
    }
    return seen;
  }

  KF.edmondsKarp = function (capacities, s, t, recordSteps) {
    const residual = {};
    for (const u in capacities) {
      residual[u] = Object.assign({}, capacities[u]);
    }
    for (const u in capacities) {
      for (const v in capacities[u]) {
        if (!residual[v]) residual[v] = {};
        if (residual[v][u] === undefined) residual[v][u] = 0;
      }
    }
    if (!residual[s]) residual[s] = {};
    if (!residual[t]) residual[t] = {};

    let maxFlow = 0;
    let augmentingPaths = 0;
    let parent;

    while ((parent = bfsAugmenting(residual, s, t)) !== null) {
      augmentingPaths++;
      let delta = Infinity;
      let v = t;
      while (parent.get(v) !== null) {
        const u = parent.get(v);
        if (residual[u][v] < delta) delta = residual[u][v];
        v = u;
      }

      if (recordSteps) {
        const path = [];
        let x = t;
        while (x !== null) {
          path.push(x);
          x = parent.get(x);
        }
        path.reverse();
        recordSteps.push({
          path: path.filter((n) => n !== SUPER_S && n !== SUPER_T),
          delta,
        });
      }

      v = t;
      while (parent.get(v) !== null) {
        const u = parent.get(v);
        residual[u][v] -= delta;
        residual[v][u] += delta;
        v = u;
      }
      maxFlow += delta;
    }

    const sourceSide = reachableInResidual(residual, s);
    const minCut = [];
    for (const u of sourceSide) {
      const adj = capacities[u];
      if (!adj) continue;
      for (const v in adj) {
        if (!sourceSide.has(v) && u !== SUPER_S && v !== SUPER_T) {
          minCut.push({ u, v, cap: adj[v] });
        }
      }
    }

    return {
      maxFlow,
      augmentingPaths,
      sourceSide,
      minCut,
      residual,
    };
  };

  KF.edmondsKarpBetweenZones = function (capacities, nodos, sourceZone, sinkZone, recordSteps) {
    let inf = 0;
    for (const u in capacities) {
      for (const v in capacities[u]) inf += capacities[u][v];
    }
    const cap = {};
    for (const u in capacities) cap[u] = Object.assign({}, capacities[u]);
    cap[SUPER_S] = {};
    cap[SUPER_T] = {};
    for (const id in nodos) {
      if (nodos[id].zona === sourceZone) cap[SUPER_S][id] = inf;
      if (nodos[id].zona === sinkZone) cap[id][SUPER_T] = inf;
    }
    return KF.edmondsKarp(cap, SUPER_S, SUPER_T, recordSteps);
  };

  /* ---------- Certificado de optimalidad de Bellman-Ford (sin otro algoritmo) ---------- */
  KF.certificarBellmanFord = function (dist, parent, directedEdges, edgeMap, start, target, profile) {
    let maxError = 0;
    // 1. Condición dual de optimalidad en todas las aristas dirigidas: dist[v] <= dist[u] + w
    for (let i = 0; i < directedEdges.length; i++) {
      const [u, v, w] = directedEdges[i];
      const du = dist.get(u);
      const dv = dist.get(v);
      if (du !== Infinity && dv > du + w + 1e-9) {
        const viol = dv - (du + w);
        if (viol > maxError) maxError = viol;
      }
    }
    // 2. Condición primal: el camino reconstruido desde start hasta target existe y suma dist[target]
    const path = reconstruct(parent, target);
    if (!path.length || path[0] !== start || path[path.length - 1] !== target) {
      return { ok: false, maxError: Infinity };
    }
    let sumW = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const e = edgeMap.get(KF.edgeKey(path[i], path[i + 1]));
      if (!e) return { ok: false, maxError: Infinity };
      sumW += profile === "valle" ? e.tiempoValle : e.tiempoPunta;
    }
    const errPrimal = Math.abs(sumW - (dist.get(target) ?? Infinity));
    if (errPrimal > maxError) maxError = errPrimal;
    return { ok: maxError < 1e-6, maxError };
  };

  /* ---------- Ruta de pedido multi-destino (Vecino más cercano) ---------- */
  KF.rutaPedido = function (data, profile, start, destinations, alg, record, returnToStart, blockedNodesSet) {
    const { adj, directed } = data.graphs[profile];
    const blockedNodes = blockedNodesSet && blockedNodesSet.size > 0 ? blockedNodesSet : null;
    let blockedEdgeKeys = null;
    if (blockedNodes) {
      blockedEdgeKeys = new Set();
      for (const nid of blockedNodes) {
        for (const nb of adj[nid] || []) {
          blockedEdgeKeys.add(KF.edgeKey(nid, nb.to));
        }
      }
    }

    const pending = new Set(destinations.filter((d) => d !== start && !(blockedNodes && blockedNodes.has(d))));
    let cur = start;
    const fullPath = [start];
    const order = [];
    let totalVisited = 0;
    let totalRounds = 0;
    let totalRelaxations = 0;
    let totalEdgesChecked = 0;
    const segments = [];

    while (pending.size > 0) {
      let segPath = [];
      let nextNode = null;
      const steps = record ? [] : null;

      if (alg === "bfs") {
        const r = KF.bfs(adj, cur, pending, steps, blockedNodes);
        segPath = r.path;
        nextNode = r.reached;
        totalVisited += r.visited;
        totalEdgesChecked += r.edgesChecked;
      } else {
        const r = KF.bellmanFord(data.ids, directed, cur, steps, blockedEdgeKeys);
        totalRounds += r.stats.rounds;
        totalRelaxations += r.stats.relaxations;
        totalEdgesChecked += r.stats.edgesChecked;
        let bestCost = Infinity;
        for (const p of pending) {
          const c = r.dist.get(p);
          if (c < bestCost) {
            bestCost = c;
            nextNode = p;
          }
        }
        segPath = nextNode ? reconstruct(r.parent, nextNode) : [];
      }

      if (!nextNode || segPath.length === 0) break;
      pending.delete(nextNode);
      order.push(nextNode);
      for (let i = 1; i < segPath.length; i++) fullPath.push(segPath[i]);
      if (record) segments.push({ from: cur, to: nextNode, path: segPath, steps });
      cur = nextNode;
    }

    if (returnToStart && cur !== start) {
      const steps = record ? [] : null;
      let segPath = [];
      if (alg === "bfs") {
        const r = KF.bfs(adj, cur, start, steps, blockedNodes);
        segPath = r.path;
        totalVisited += r.visited;
        totalEdgesChecked += r.edgesChecked;
      } else {
        const r = KF.bellmanFord(data.ids, directed, cur, steps, blockedEdgeKeys);
        totalRounds += r.stats.rounds;
        totalRelaxations += r.stats.relaxations;
        totalEdgesChecked += r.stats.edgesChecked;
        segPath = Number.isFinite(r.dist.get(start)) ? reconstruct(r.parent, start) : [];
      }
      for (let i = 1; i < segPath.length; i++) fullPath.push(segPath[i]);
      if (record && segPath.length > 0) segments.push({ from: cur, to: start, path: segPath, steps });
    }

    return {
      path: fullPath,
      order,
      segments,
      unreachable: pending.size > 0,
      stats: {
        visited: totalVisited,
        rounds: totalRounds,
        relaxations: totalRelaxations,
        edgesChecked: totalEdgesChecked,
      },
    };
  };

  /* ---------- Medición de ruta ---------- */
  KF.medirRuta = function (path, edgeMap, profile) {
    let distFisica = 0;
    let distAjustada = 0;
    let tiempoS = 0;
    let alta = 0;
    let media = 0;
    let baja = 0;

    for (let i = 0; i < path.length - 1; i++) {
      const e = edgeMap.get(KF.edgeKey(path[i], path[i + 1]));
      if (!e) continue;
      distFisica += e.dist;
      distAjustada += profile === "valle" ? e.distAdjValle : e.distAdjPunta;
      tiempoS += profile === "valle" ? e.tiempoValle : e.tiempoPunta;
      if (e.frec === "Alta") alta++;
      else if (e.frec === "Media") media++;
      else baja++;
    }

    return {
      pasillos: Math.max(0, path.length - 1),
      distFisica: +distFisica.toFixed(1),
      distAjustada: +distAjustada.toFixed(1),
      tiempoS: +tiempoS.toFixed(1),
      alta,
      media,
      baja,
    };
  };

  /* ---------- Construcción de estados cuadro a cuadro ---------- */
  KF.buildSearchFrames = function (segments, alg, data, maxFrames = 180) {
    const frames = [];
    const totalDirEdges = data.aristas.length * 2;
    let accWork = 0;
    let accPath = [];

    for (let sIdx = 0; sIdx < segments.length; sIdx++) {
      const seg = segments[sIdx];
      const visited = new Set();
      const rawSteps = seg.steps || [];

      if (alg === "bfs") {
        const stride = Math.max(1, Math.ceil(rawSteps.length / Math.max(20, Math.floor(maxFrames / segments.length))));
        let segEdges = 0;
        for (let i = 0; i < rawSteps.length; i++) {
          const st = rawSteps[i];
          visited.add(st.node);
          segEdges += (data.graphs.punta.adj[st.node] || []).length;
          if (i % stride === 0 || i === rawSteps.length - 1) {
            const isLast = i === rawSteps.length - 1;
            frames.push({
              work: accWork + segEdges,
              visited: new Set(visited),
              frontier: new Set([st.node]),
              path: isLast ? accPath.concat(seg.path) : accPath.slice(),
              line: isLast ? 3 : 4,
              narration: isLast
                ? `Tramo ${sIdx + 1}/${segments.length}: destino ${seg.to} alcanzado en nivel ${st.level} (${seg.path.length - 1} pasillos).`
                : `Tramo ${sIdx + 1}/${segments.length}: explorando ${st.node} (nivel ${st.level}), expandiendo sus vecinos en la cola FIFO.`,
              counters: {
                tramo: `${sIdx + 1} / ${segments.length}`,
                visitados: visited.size,
                nivel: st.level,
                aristas: accWork + segEdges,
              },
            });
          }
        }
        accWork += segEdges;
      } else {
        const stride = Math.max(1, Math.ceil(rawSteps.length / Math.max(15, Math.floor(maxFrames / segments.length))));
        let relaxCount = 0;
        for (let r = 0; r < rawSteps.length; r++) {
          const improved = rawSteps[r];
          for (let k = 0; k < improved.length; k++) visited.add(improved[k]);
          relaxCount += improved.length;
          const workNow = accWork + (r + 1) * totalDirEdges;
          const isLast = r === rawSteps.length - 1;
          if (r % stride === 0 || isLast) {
            frames.push({
              work: workNow,
              visited: new Set(visited),
              frontier: new Set(improved),
              path: isLast ? accPath.concat(seg.path) : accPath.slice(),
              line: isLast ? (improved.length === 0 ? 7 : 9) : 5,
              narration: isLast
                ? `Tramo ${sIdx + 1}/${segments.length}: salida anticipada tras ${r + 1} rondas — ruta óptima de menor tiempo hasta ${seg.to} encontrada.`
                : `Tramo ${sIdx + 1}/${segments.length}: ronda ${r + 1} relajó ${improved.length} ubicaciones buscando evitar pasillos congestionados.`,
              counters: {
                tramo: `${sIdx + 1} / ${segments.length}`,
                ronda: r + 1,
                relajaciones: relaxCount,
                aristas: workNow,
              },
            });
          }
        }
        accWork += rawSteps.length * totalDirEdges;
      }

      accPath = accPath.length === 0 ? seg.path.slice() : accPath.concat(seg.path.slice(1));
    }

    if (frames.length === 0) {
      frames.push({
        work: 0,
        visited: new Set(),
        frontier: new Set(),
        path: [],
        line: 0,
        narration: "Selecciona un inicio y al menos un destino.",
        counters: { tramo: "0 / 0", visitados: 0, aristas: 0 },
      });
    }
    return frames;
  };

  /* ---------- Simulación de un turno ---------- */
  KF.simularTurno = function (data, opts) {
    const tiempos = { base: 0, ruteo: 0, flujo: 0 };
    let tReloj = performance.now();
    const rng = KF.mulberry32(opts.semilla || 1);
    const operators = [];
    const muelles = data.estacionesDespacho.length ? data.estacionesDespacho : data.estaciones;

    const baseCaps = data.buildCapacities(null);
    const baseEk = KF.edmondsKarpBetweenZones(
      baseCaps,
      data.nodos,
      opts.zonaOrigen,
      opts.zonaDestino,
      null
    );
    const baseFlow = baseEk.maxFlow;
    tiempos.base = performance.now() - tReloj;
    tReloj = performance.now();
    let pico = 0; // nodos descubiertos en la búsqueda más grande (para estimar memoria)
    let stats = { visitados: 0, aristas: 0, rondas: 0, relajaciones: 0 };

    const isAntiBottleneck = opts.alg === "edmonds_karp";
    const isDynamicBf = opts.alg === "bellman_ford" || isAntiBottleneck;
    const cutKeys = new Set();
    if (isAntiBottleneck) {
      for (const c of baseEk.minCut) cutKeys.add(KF.edgeKey(c.u, c.v));
    }
    const liveUsage = new Map();
    const baseDir = data.graphs[opts.hora].directed;
    const racksPool = data.racksPicking && data.racksPicking.length ? data.racksPicking : data.racks;

    let sumTimeS = 0;
    let sumDistAdj = 0;

    for (let i = 0; i < opts.nOps; i++) {
      const start = muelles[Math.floor(rng() * muelles.length)];
      const k = 1 + Math.floor(rng() * opts.maxProd);
      const picks = [];
      const chosen = new Set([start]);
      while (picks.length < k) {
        const cand = racksPool[Math.floor(rng() * racksPool.length)];
        if (!chosen.has(cand)) {
          chosen.add(cand);
          picks.push(cand);
        }
      }

      let r;
      if (isDynamicBf) {
        const customDir = new Array(baseDir.length);
        for (let eIdx = 0; eIdx < baseDir.length; eIdx++) {
          const [u, v, w] = baseDir[eIdx];
          const ekKey = KF.edgeKey(u, v);
          const crosses = liveUsage.get(ekKey) || 0;
          if (isAntiBottleneck) {
            const cutPenalty = cutKeys.has(ekKey) ? 1.45 : 1.0;
            customDir[eIdx] = [u, v, w * cutPenalty * (1 + crosses * 0.28)];
          } else {
            customDir[eIdx] = [u, v, w * (1 + crosses * 0.12)];
          }
        }
        const tempData = Object.assign({}, data, {
          graphs: Object.assign({}, data.graphs, {
            [opts.hora]: { adj: data.graphs[opts.hora].adj, directed: customDir },
          }),
        });
        r = KF.rutaPedido(tempData, opts.hora, start, picks, "bellman_ford", false, true);
      } else {
        r = KF.rutaPedido(data, opts.hora, start, picks, opts.alg, false, true);
      }
      stats.visitados += r.stats.visited;
      stats.aristas += r.stats.edgesChecked;
      stats.rondas += r.stats.rounds;
      stats.relajaciones += r.stats.relaxations;
      if (r.stats.visited > pico) pico = r.stats.visited;
      // Pasillos de esta ruta que ya habían planificado los operarios anteriores
      let compartidos = 0;
      for (let j = 0; j < r.path.length - 1; j++) {
        if (liveUsage.has(KF.edgeKey(r.path[j], r.path[j + 1]))) compartidos++;
      }
      for (let j = 0; j < r.path.length - 1; j++) {
        const kEdge = KF.edgeKey(r.path[j], r.path[j + 1]);
        liveUsage.set(kEdge, (liveUsage.get(kEdge) || 0) + 1);
      }

      const met = KF.medirRuta(r.path, data.edgeMap, opts.hora);
      sumTimeS += met.tiempoS;
      sumDistAdj += met.distAjustada;

      operators.push({
        id: i + 1,
        muelle: start,
        racks: picks,
        path: r.path,
        tiempoS: met.tiempoS,
        compartidos,
      });
    }
    tiempos.ruteo = performance.now() - tReloj;

    // Conteo total de cruces por pasillo
    const usage = new Map();
    let maxStep = 0;
    for (const op of operators) {
      if (op.path.length > maxStep) maxStep = op.path.length;
      for (let i = 0; i < op.path.length - 1; i++) {
        const key = KF.edgeKey(op.path[i], op.path[i + 1]);
        usage.set(key, (usage.get(key) || 0) + 1);
      }
    }

    // Terciles sobre los pasillos usados para elevar la congestión base del almacén de forma coherente
    const usedCounts = Array.from(usage.values()).sort((a, b) => a - b);
    const t1 = usedCounts.length ? usedCounts[Math.floor(usedCounts.length / 3)] : 1;
    const t2 = usedCounts.length ? usedCounts[Math.floor((2 * usedCounts.length) / 3)] : 2;
    const rank = { Baja: 0, Media: 1, Alta: 2 };
    const byRank = ["Baja", "Media", "Alta"];

    const dynamicLevels = new Map();
    let maxUsage = 0;
    for (const e of data.aristas) {
      const c = usage.get(e.key) || 0;
      if (c > maxUsage) maxUsage = c;
      let shiftLvl = "Baja";
      if (c > t2 && c >= 2) shiftLvl = "Alta";
      else if (c > t1 && c >= 1) shiftLvl = "Media";
      // El tráfico del turno incrementa o mantiene la congestión base del pasillo
      const combined = byRank[Math.min(2, Math.max(rank[e.frec] || 0, rank[shiftLvl]) + (c > t2 ? 1 : 0))];
      dynamicLevels.set(e.key, combined);
    }

    tReloj = performance.now();
    const dynCaps = data.buildCapacities(dynamicLevels);
    const ekSteps = [];
    const flowRes = KF.edmondsKarpBetweenZones(
      dynCaps,
      data.nodos,
      opts.zonaOrigen,
      opts.zonaDestino,
      ekSteps
    );

    return {
      alg: opts.alg,
      operators,
      usage,
      maxUsage,
      maxStep,
      avgTimeS: +(sumTimeS / Math.max(1, operators.length)).toFixed(1),
      avgDistAdj: +(sumDistAdj / Math.max(1, operators.length)).toFixed(1),
      dynamicLevels,
      flowRes,
      ekSteps,
      baseFlow,
      tiempos: Object.assign(tiempos, { flujo: performance.now() - tReloj }),
      stats: Object.assign(stats, { pico, usoEntradas: liveUsage.size }),
    };
  };
})(typeof window !== "undefined" ? window : self);
