/* =========================================================
   KivaFlow · Web Worker de cálculo
   Tiene su propia copia del grafo. Recibe solo los cambios
   (ubicación, pasillo o filas nuevas) y las tareas a calcular;
   así BFS, Bellman-Ford y Edmonds-Karp no bloquean la página.
   ========================================================= */
self.window = self;
importScripts("data.js?v=20261123b", "algorithms.js?v=20261123b", "edicion.js?v=20261123b", "tareas.js?v=20261123b");

let data = null;

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === "iniciar") {
      data = self.KF.construirDataset(m.csv.nodos, m.csv.aristas);
      for (const op of m.cambios || []) self.KF.aplicarCambio(data, op);
    } else if (m.tipo === "cambio") {
      self.KF.aplicarCambio(data, m.op);
    } else if (m.tipo === "calcular") {
      const resultado = self.KF.TAREAS[m.tarea](data, m.args);
      self.postMessage({ tipo: "resultado", id: m.id, resultado });
    }
  } catch (e) {
    self.postMessage({ tipo: "error", id: m.id, mensaje: String((e && e.message) || e) });
  }
};
