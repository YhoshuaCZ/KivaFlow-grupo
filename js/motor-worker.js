/* =========================================================
   KivaFlow · Motor de algoritmos en un Web Worker
   Corre BFS, Bellman-Ford y Edmonds-Karp en un hilo aparte,
   así la página sigue respondiendo aunque el grafo crezca.
   Usa exactamente las mismas funciones de js/algorithms.js.

   Mensajes que recibe:
     { tipo: "iniciar", instantanea }         grafo completo (una sola vez)
     { tipo: "cambios", cambios: [...] }      solo los nodos/aristas nuevos
     { tipo: "ejecutar", id, alg, perfil, inicio, destino, zonaS, zonaT }
   Mensajes que envía:
     { tipo: "listo" | "sincronizado", V, E }
     { tipo: "resultado", id, alg, ... }  o  { tipo: "error", id, mensaje }
   ========================================================= */
/* global importScripts */
self.window = self; // data.js y algorithms.js se registran en `window.KF`
importScripts("data.js", "algorithms.js", "grafo-editable.js");

const KF = self.KF;
let grafo = null;

function aplicarCambios(cambios) {
  for (const c of cambios) {
    if (c.t === "n") grafo.agregarNodo(c.fila, c.col, { id: c.id, zona: c.zona });
    else if (c.t === "e") grafo.agregarArista(c.u, c.v, c.frec, c.dist);
    else if (c.t === "filas") grafo.rows = c.rows;
  }
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try {
    if (msg.tipo === "iniciar") {
      grafo = KF.GrafoEditable.desdeInstantanea(msg.instantanea);
      self.postMessage({ tipo: "listo", V: grafo.V, E: grafo.E });
    } else if (msg.tipo === "cambios") {
      aplicarCambios(msg.cambios);
      self.postMessage({ tipo: "sincronizado", V: grafo.V, E: grafo.E });
    } else if (msg.tipo === "ejecutar") {
      self.postMessage(KF.ejecutarEnGrafo(grafo, msg));
    }
  } catch (err) {
    self.postMessage({ tipo: "error", id: msg.id, mensaje: err && err.message ? err.message : String(err) });
  }
};
