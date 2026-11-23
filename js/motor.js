/* =========================================================
   KivaFlow · Motor en segundo plano + registro de cambios del grafo
   · KF.motor.calcular(tarea, args) corre BFS, Bellman-Ford,
     Edmonds-Karp y el turno en un Web Worker: la página solo dibuja.
   · KF.grafo agrega ubicaciones, pasillos y filas en O(1) cada uno,
     guarda el registro de cambios en el navegador y lo envía al
     Worker (solo el cambio, nunca el grafo entero).
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});
  const CLAVE = "kf_grafo_cambios_v2";
  const VERSION_WORKER = "20261123b";

  /* ---------------- Motor (Web Worker con respaldo en la página) ---------------- */
  const motor = {
    worker: null,
    enPagina: false,
    pendientes: new Map(),
    sig: 1,

    iniciar() {
      if (this.worker || this.enPagina) return;
      try {
        if (typeof Worker === "undefined" || location.protocol === "file:") throw new Error("sin Worker");
        this.worker = new Worker(`js/motor-worker.js?v=${VERSION_WORKER}`);
        this.worker.onmessage = (ev) => this._recibir(ev.data);
        this.worker.onerror = (ev) => {
          ev.preventDefault();
          this._pasarAPagina(ev.message || "error del Worker");
        };
        this.worker.postMessage({ tipo: "iniciar", csv: KF.DATA._csv, cambios: grafo.cambios });
      } catch (_) {
        this.enPagina = true;
      }
    },

    get hilo() {
      return this.enPagina ? "hilo principal" : "Web Worker";
    },

    _pasarAPagina(motivo) {
      if (this.worker) this.worker.terminate();
      this.worker = null;
      this.enPagina = true;
      // Lo pendiente se recalcula en la página para no dejar la vista esperando.
      for (const [id, p] of this.pendientes) {
        this.pendientes.delete(id);
        this._enPagina(p.tarea, p.args).then(p.ok, p.fallo);
      }
      console.warn("KivaFlow: el cálculo pasa al hilo principal:", motivo);
    },

    _recibir(m) {
      const p = this.pendientes.get(m.id);
      if (!p) return;
      this.pendientes.delete(m.id);
      if (m.tipo === "error") p.fallo(new Error(m.mensaje));
      else p.ok(m.resultado);
    },

    _enPagina(tarea, args) {
      return new Promise((ok, fallo) => {
        // Se cede un cuadro para que el aviso "Calculando…" alcance a pintarse.
        setTimeout(() => {
          try {
            ok(KF.TAREAS[tarea](KF.DATA, args));
          } catch (e) {
            fallo(e);
          }
        }, 30);
      });
    },

    /** Devuelve una promesa con el resultado. `tarea`: "pedido" | "flujo" | "turno". */
    calcular(tarea, args) {
      this.iniciar();
      if (this.enPagina) return this._enPagina(tarea, args);
      const id = this.sig++;
      return new Promise((ok, fallo) => {
        this.pendientes.set(id, { ok, fallo, tarea, args });
        this.worker.postMessage({ tipo: "calcular", id, tarea, args });
      });
    },

    /** Cancela lo que esté corriendo: se descarta el Worker y se crea otro con el mismo grafo. */
    cancelar() {
      if (!this.worker) return;
      this.worker.terminate();
      this.worker = null;
      for (const p of this.pendientes.values()) p.fallo(Object.assign(new Error("cancelado"), { cancelado: true }));
      this.pendientes.clear();
      this.iniciar();
    },

    cambio(op) {
      if (this.worker) this.worker.postMessage({ tipo: "cambio", op });
    },

    reiniciar() {
      if (this.worker) this.worker.postMessage({ tipo: "iniciar", csv: KF.DATA._csv, cambios: grafo.cambios });
    },
  };

  /* ---------------- Registro de cambios del grafo ---------------- */
  const grafo = {
    cambios: [],
    oyentes: new Set(),

    alCambiar(fn) {
      this.oyentes.add(fn);
      return () => this.oyentes.delete(fn);
    },

    _avisar() {
      for (const fn of this.oyentes) {
        try {
          fn();
        } catch (_) { }
      }
    },

    _guardar() {
      try {
        localStorage.setItem(CLAVE, JSON.stringify(this.cambios));
      } catch (_) { }
    },

    get editado() {
      return this.cambios.length > 0;
    },

    /** Recupera los cambios guardados en este navegador y los aplica. */
    restaurar() {
      let guardados = [];
      try {
        guardados = JSON.parse(localStorage.getItem(CLAVE) || "[]");
      } catch (_) {
        guardados = [];
      }
      if (!Array.isArray(guardados)) guardados = [];
      for (const op of guardados) KF.aplicarCambio(KF.DATA, op);
      this.cambios = guardados;
      return guardados.length;
    },

    /** Aplica un cambio en la página y en el Worker. */
    aplicar(op) {
      KF.aplicarCambio(KF.DATA, op);
      this.cambios.push(op);
      this._guardar();
      motor.cambio(op);
      this._avisar();
    },

    /**
     * Ubicación nueva en (fila, col). Si `unirMasCercano`, también crea el pasillo
     * hacia la ubicación más cercana. Devuelve {nodo, arista} o {error}.
     */
    agregarUbicacion(fila, col, frec, unirMasCercano) {
      const data = KF.DATA;
      fila = Math.round(fila * 2) / 2;
      col = Math.round(col * 2) / 2;
      if (fila < 0 || col < 0 || col > data.cols - 1 || fila > data.rows - 1) {
        return { error: "Ese punto queda fuera del almacén." };
      }
      const yaHay = data.masCercano(fila, col, 0.3);
      if (yaHay) return { error: `Ya existe la ubicación ${yaHay.id} en ese punto. Haz clic en un espacio libre entre ubicaciones.` };
      const cercano = unirMasCercano ? data.masCercano(fila, col, 3) : null;
      const id = `N${String(data.nuevos + 1).padStart(4, "0")}`;
      this.aplicar({ t: "n", id, fila, col, unir: cercano ? cercano.id : null, frec });
      return { nodo: data.nodos[id], arista: cercano ? data.edgeMap.get(KF.edgeKey(id, cercano.id)) : null, vecino: cercano };
    },

    agregarPasillo(u, v, frec) {
      const data = KF.DATA;
      if (u === v) return { error: "Elige dos ubicaciones distintas." };
      if (data.edgeMap.has(KF.edgeKey(u, v))) return { error: `Ya existe un pasillo entre ${u} y ${v}.` };
      this.aplicar({ t: "e", u, v, frec });
      return { arista: data.edgeMap.get(KF.edgeKey(u, v)) };
    },

    /**
     * Agrega k filas por partes (unos 8 ms por cuadro) para que la página no se congele.
     * `alAvanzar(hechas, total)` se llama en cada parte. Devuelve una promesa.
     */
    ampliar(k, alAvanzar) {
      const data = KF.DATA;
      const op = { t: "f", semilla: (this.cambios.length + 1) * 7919, k };
      return new Promise((ok) => {
        let hechas = 0;
        const paso = () => {
          const t0 = performance.now();
          while (hechas < k && performance.now() - t0 < 8) {
            KF.aplicarCambio(data, op, hechas, hechas + 1);
            hechas++;
          }
          if (alAvanzar) alAvanzar(hechas, k);
          if (hechas < k) requestAnimationFrame(paso);
          else {
            this.cambios.push(op);
            this._guardar();
            motor.cambio(op);
            this._avisar();
            ok();
          }
        };
        requestAnimationFrame(paso);
      });
    },

    /** Deshace el último cambio: se rearma el grafo desde el CSV y se vuelven a aplicar los demás. */
    deshacer() {
      if (!this.cambios.length) return null;
      const quitado = this.cambios.pop();
      this._rearmar();
      return quitado;
    },

    restablecer() {
      this.cambios = [];
      this._rearmar();
    },

    _rearmar() {
      const csv = KF.DATA._csv;
      const data = KF.construirDataset(csv.nodos, csv.aristas);
      for (const op of this.cambios) KF.aplicarCambio(data, op);
      KF.DATA = data;
      this._guardar();
      motor.reiniciar();
      this._avisar();
    },

    resumen() {
      const d = KF.DATA;
      return {
        V: d.nodeList.length,
        E: d.aristas.length,
        agregadosV: d.nodeList.length - d.baseV,
        agregadosE: d.aristas.length - d.baseE,
        memoria: KF.memoriaGrafo(d),
        almacenamiento:
          d._csv.nodos.length + d._csv.aristas.length +
          // filas nuevas del CSV exportable (≈ 60 B por ubicación y 120 B por pasillo)
          (d.nodeList.length - d.baseV) * 60 + (d.aristas.length - d.baseE) * 120,
        filas: d.rows,
      };
    },

    /** CSV con las mismas columnas que data/nodos.csv y data/aristas.csv. */
    aCSV() {
      const d = KF.DATA;
      let nodos = "Nodo,Fila,Columna,Zona,Tipo_Ubicacion,SKU_Principal\n";
      for (const n of d.nodeList) nodos += `${n.id},${+(+n.fila).toFixed(3)},${+(+n.col).toFixed(3)},${n.zona},${n.tipo || ""},${n.sku || ""}\n`;
      let aristas = "Nodo_Origen,Nodo_Destino,Pasillo,Distancia_m,Frecuencia_Pedidos,Distancia_Ajustada_m,Tiempo_Estimado_s,Zona_Origen,Zona_Destino\n";
      for (const e of d.aristas) aristas += `${e.u},${e.v},${e.pasillo},${e.dist},${e.frec},${e.distAdjPunta},${e.tiempoPunta},${e.zonaOrigen},${e.zonaDestino}\n`;
      return { nodos, aristas };
    },
  };

  KF.motor = motor;
  KF.grafo = grafo;
})(window);
