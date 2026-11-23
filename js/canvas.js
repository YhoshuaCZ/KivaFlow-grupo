/* =========================================================
   KivaFlow · Motor gráfico Canvas HiDPI + Reproductor
   Renderizado en 2 capas (base cacheada + capa dinámica 60fps)
   ========================================================= */
(function (global) {
  "use strict";

  const KF = (global.KF = global.KF || {});

  class WarehouseCanvas {
    constructor(canvas, data, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.data = data;
      this.opts = Object.assign(
        {
          width: 760,
          height: 510,
          padTop: 32,
          padBottom: 24,
          padLeft: 32,
          padRight: 18,
          strongCongestion: false,
          customLevels: null,
          focusZone: null,
          interactive: false,
          onNodeClick: null,
          onMapClick: null,
        },
        opts
      );

      // Si el almacén se amplió con filas nuevas, el mapa crece hacia abajo (hasta el doble)
      // para que las filas no se aplasten.
      if (data.rows > 45) {
        const util = this.opts.height - this.opts.padTop - this.opts.padBottom;
        this.opts.height = Math.round(this.opts.padTop + this.opts.padBottom + (util * Math.min(data.rows, 90)) / 45);
      }

      this.aspect = this.opts.width / this.opts.height;
      this.canvas.style.aspectRatio = `${this.opts.width} / ${this.opts.height}`;
      if (!this.canvas.getAttribute("role")) this.canvas.setAttribute("role", "img");
      if (!this.canvas.getAttribute("aria-label")) {
        this.canvas.setAttribute(
          "aria-label",
          `Mapa interactivo del almacén KivaFlow de ${data.rows} filas por ${data.cols} columnas (${KF.formatNum(data.nodeList.length)} ubicaciones y ${KF.formatNum(data.aristas.length)} pasillos)`
        );
      }

      this._lastOverlay = {};
      this._hoverNode = null;
      this._baseCanvas = document.createElement("canvas");
      this._resizeAndBuild();
      this._bindEvents();

      if (typeof ResizeObserver !== "undefined") {
        this._ro = new ResizeObserver(() => {
          const rectW = this.canvas.getBoundingClientRect().width;
          if (rectW > 80 && Math.abs(rectW - this._cssW) > 6) {
            this._resizeAndBuild();
            this.render(this._lastOverlay);
          }
        });
        this._ro.observe(this.canvas);
      }
    }

    _resizeAndBuild() {
      const rectW = this.canvas.getBoundingClientRect().width;
      this._cssW = rectW > 80 ? rectW : this.opts.width;
      const baseScale = Math.min(Math.max(window.devicePixelRatio || 1, 2.25), 3);
      const pixelW = Math.round(Math.max(this._cssW, this.opts.width) * baseScale);
      const pixelH = Math.round(pixelW / this.aspect);

      this.scaleX = pixelW / this.opts.width;
      this.scaleY = pixelH / this.opts.height;
      this.canvas.width = pixelW;
      this.canvas.height = pixelH;
      this._baseCanvas.width = pixelW;
      this._baseCanvas.height = pixelH;

      this.innerW = this.opts.width - this.opts.padLeft - this.opts.padRight;
      this.innerH = this.opts.height - this.opts.padTop - this.opts.padBottom;
      this.cellW = this.innerW / (this.data.cols - 1);
      this.cellH = this.innerH / (this.data.rows - 1);

      this.pos = {};
      for (const n of this.data.nodeList) {
        this.pos[n.id] = {
          x: this.opts.padLeft + n.col * this.cellW,
          y: this.opts.padTop + n.fila * this.cellH,
        };
      }
      this._buildBaseLayer();
    }

    _buildBaseLayer() {
      const ctx = this._baseCanvas.getContext("2d");
      ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);
      ctx.fillStyle = KF.PALETA.TARJETA;
      ctx.fillRect(0, 0, this.opts.width, this.opts.height);

      // Bandas sutiles por zona + divisores arquitectónicos + etiquetas arriba
      const bands = [
        { name: "Recepción y Almacenamiento", c0: 0, c1: 12, bg: "rgba(0,41,107,0.032)" },
        { name: "Picking", c0: 13, c1: 26, bg: "rgba(51,101,160,0.042)" },
        { name: "Empaque y Despacho", c0: 27, c1: 39, bg: "rgba(242,232,207,0.22)" },
      ];
      for (const b of bands) {
        const x0 = this.opts.padLeft + (b.c0 - 0.45) * this.cellW;
        const x1 = this.opts.padLeft + (b.c1 + 0.45) * this.cellW;
        ctx.fillStyle = b.bg;
        ctx.fillRect(x0, this.opts.padTop - 5, x1 - x0, this.innerH + 10);
        ctx.fillStyle = KF.PALETA.TINTA;
        ctx.font = "700 11px Calibri, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(b.name, (x0 + x1) / 2, 16);
      }

      // Divisores verticales punteados entre zonas
      ctx.save();
      ctx.strokeStyle = "rgba(0, 41, 107, 0.16)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const splitCol of [12.5, 26.5]) {
        const sx = this.opts.padLeft + splitCol * this.cellW;
        ctx.beginPath();
        ctx.moveTo(sx, this.opts.padTop - 5);
        ctx.lineTo(sx, this.opts.padTop + this.innerH + 5);
        ctx.stroke();
      }
      ctx.restore();

      // Coordenadas de plano (filas cada 10 y columnas cada 10)
      ctx.fillStyle = "rgba(81, 102, 130, 0.72)";
      ctx.font = "500 8.5px 'JetBrains Mono', Consolas, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let r = 0; r < this.data.rows; r += 10) {
        const y = this.opts.padTop + r * this.cellH;
        ctx.fillText(`F${String(r).padStart(2, "0")}`, this.opts.padLeft - 6, y);
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let c = 0; c < this.data.cols; c += 10) {
        const x = this.opts.padLeft + c * this.cellW;
        ctx.fillText(`C${String(c).padStart(2, "0")}`, x, this.opts.padTop + this.innerH + 8);
      }
      ctx.textBaseline = "alphabetic";

      // Pasillos (3 niveles de congestión)
      const palette = this.opts.strongCongestion
        ? KF.PALETA.CONGESTION
        : KF.PALETA.CONGESTION_SUAVE;
      const custom = this.opts.customLevels;

      const focus = this.opts.focusZone;
      ctx.lineCap = "round";
      for (const level of ["Baja", "Media", "Alta"]) {
        ctx.beginPath();
        ctx.strokeStyle = palette[level];
        ctx.lineWidth = level === "Alta" ? 1.75 : level === "Media" ? 1.25 : 0.9;
        for (const e of this.data.aristas) {
          const lvl = custom ? custom.get(e.key) || "Baja" : e.frec;
          if (lvl !== level) continue;
          if (focus && (e.zonaOrigen !== focus || e.zonaDestino !== focus)) continue;
          const p1 = this.pos[e.u];
          const p2 = this.pos[e.v];
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
        }
        ctx.stroke();
      }

      // Nodos (estaciones cuadradas con borde nítido, racks circulares)
      for (const n of this.data.nodeList) {
        const p = this.pos[n.id];
        const inFocus = !focus || n.zona === focus;
        ctx.fillStyle = KF.PALETA.ZONA[n.zona] || KF.PALETA.SUAVE;
        ctx.globalAlpha = inFocus ? (n.esEstacion ? 0.92 : 0.5) : 0.08;
        if (n.esEstacion) {
          ctx.fillRect(p.x - 2.3, p.y - 2.3, 4.6, 4.6);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Ubicaciones y pasillos agregados a mano: se resaltan para distinguirlos del dataset.
      // (Las filas de ampliación siguen la cuadrícula y se dibujan como el resto.)
      ctx.strokeStyle = KF.PALETA.NUEVO || "#7C3AED";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (const e of this.data.aristas) {
        if (!e.nuevo || e.ampliacion) continue;
        const p1 = this.pos[e.u];
        const p2 = this.pos[e.v];
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
      }
      ctx.stroke();
      for (const n of this.data.nodeList) {
        if (!n.nuevo || n.ampliacion) continue;
        const p = this.pos[n.id];
        ctx.beginPath();
        ctx.fillStyle = "#FFFFFF";
        ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = KF.PALETA.NUEVO || "#7C3AED";
        ctx.stroke();
      }
    }

    setFocusZone(zone) {
      this.opts.focusZone = zone || null;
      this._buildBaseLayer();
    }

    updateCustomLevels(levels, strong = true) {
      this.opts.customLevels = levels;
      this.opts.strongCongestion = strong;
      this._buildBaseLayer();
    }

    /** Fila y columna (con decimales) bajo el cursor, o null si cae fuera del almacén. */
    aCoordenadas(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * this.opts.width;
      const y = ((clientY - rect.top) / rect.height) * this.opts.height;
      const col = (x - this.opts.padLeft) / this.cellW;
      const fila = (y - this.opts.padTop) / this.cellH;
      if (fila < -0.5 || fila > this.data.rows - 0.5 || col < -0.5 || col > this.data.cols - 0.5) return null;
      return { fila, col };
    }

    _nearestNode(clientX, clientY) {
      if (this.data.masCercano) {
        const p = this.aCoordenadas(clientX, clientY);
        return p ? this.data.masCercano(p.fila, p.col, 0.6) : null;
      }
      const rect = this.canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * this.opts.width;
      const y = ((clientY - rect.top) / rect.height) * this.opts.height;
      const col = Math.round((x - this.opts.padLeft) / this.cellW);
      const row = Math.round((y - this.opts.padTop) / this.cellH);
      if (row < 0 || row >= this.data.rows || col < 0 || col >= this.data.cols) {
        return null;
      }
      const id = `F${String(row).padStart(2, "0")}_C${String(col).padStart(2, "0")}`;
      return this.data.nodos[id] || null;
    }

    _bindEvents() {
      const tooltip = document.getElementById("map-tooltip");

      this._onMove = (ev) => {
        const node = this._nearestNode(ev.clientX, ev.clientY);
        const changed = (node ? node.id : null) !== (this._hoverNode ? this._hoverNode.id : null);
        this._hoverNode = node;
        if (changed) this.render(this._lastOverlay);
        if (node && tooltip) {
          const esc = KF.escapeHtml || ((s) => s);
          const skuLine = node.sku ? `<br>SKU: <strong>${esc(node.sku)}</strong>` : "";
          tooltip.innerHTML = `<strong>${esc(node.id)}</strong> · ${esc(node.zona)}<br>${esc(node.tipo)}${skuLine}`;
          tooltip.hidden = false;
          const left = Math.min(window.innerWidth - 270, ev.clientX + 14);
          const top = Math.min(window.innerHeight - 90, ev.clientY + 14);
          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        } else if (tooltip) {
          tooltip.hidden = true;
        }
      };

      this._onLeave = () => {
        if (this._hoverNode) {
          this._hoverNode = null;
          this.render(this._lastOverlay);
        }
        if (tooltip) tooltip.hidden = true;
      };

      this._onClick = (ev) => {
        if (!this.opts.interactive) return;
        if (this.opts.onMapClick) {
          const p = this.aCoordenadas(ev.clientX, ev.clientY);
          const exacto = p && this.data.masCercano ? this.data.masCercano(p.fila, p.col, 0.3) : null;
          if (this.opts.onMapClick(p, exacto ? exacto.id : null, this._nearestNode(ev.clientX, ev.clientY))) return;
        }
        if (!this.opts.onNodeClick) return;
        const node = this._nearestNode(ev.clientX, ev.clientY);
        if (node) this.opts.onNodeClick(node.id);
      };

      this.canvas.addEventListener("mousemove", this._onMove);
      this.canvas.addEventListener("mouseleave", this._onLeave);
      this.canvas.addEventListener("click", this._onClick);
    }

    destroy() {
      this.canvas.removeEventListener("mousemove", this._onMove);
      this.canvas.removeEventListener("mouseleave", this._onLeave);
      this.canvas.removeEventListener("click", this._onClick);
      if (this._ro) this._ro.disconnect();
      const tooltip = document.getElementById("map-tooltip");
      if (tooltip) tooltip.hidden = true;
    }

    render(overlay = {}) {
      this._lastOverlay = overlay;
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this._baseCanvas, 0, 0);
      ctx.setTransform(this.scaleX, 0, 0, this.scaleY, 0, 0);

      // 1. Mapa de calor de uso (en simulación)
      if (overlay.usageMap && overlay.maxUsage > 0) {
        for (const [key, count] of overlay.usageMap.entries()) {
          if (count <= 0) continue;
          const e = this.data.edgeMap.get(key);
          if (!e) continue;
          const ratio = Math.min(1, count / overlay.maxUsage);
          const p1 = this.pos[e.u];
          const p2 = this.pos[e.v];
          ctx.beginPath();
          ctx.strokeStyle =
            ratio > 0.66
              ? "rgba(193, 18, 31, 0.88)"
              : ratio > 0.33
              ? "rgba(224, 90, 43, 0.8)"
              : "rgba(51, 101, 160, 0.45)";
          ctx.lineWidth = 1.4 + ratio * 2.6;
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // 2. Nodos visitados / relajados
      if (overlay.visited && overlay.visited.size > 0) {
        ctx.fillStyle = overlay.visitedColor || KF.PALETA.ALGORITMO_CLARO.bfs;
        for (const id of overlay.visited) {
          const p = this.pos[id];
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3. Frontera actual (ocre)
      if (overlay.frontier && overlay.frontier.size > 0) {
        ctx.fillStyle = KF.PALETA.FRENTE;
        for (const id of overlay.frontier) {
          const p = this.pos[id];
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 4. Flujo acumulado / camino de aumento (Edmonds-Karp)
      if (overlay.flowEdges && overlay.flowEdges.size > 0) {
        ctx.lineCap = "round";
        for (const [key, amt] of overlay.flowEdges.entries()) {
          const e = this.data.edgeMap.get(key);
          if (!e) continue;
          const p1 = this.pos[e.u];
          const p2 = this.pos[e.v];
          ctx.beginPath();
          ctx.strokeStyle = "rgba(0, 41, 107, 0.55)";
          ctx.lineWidth = Math.min(4.2, 1.2 + amt * 0.9);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      if (overlay.augmentingPath && overlay.augmentingPath.length > 1) {
        this._drawPolyline(ctx, overlay.augmentingPath, KF.PALETA.FRENTE, 3.4, false);
      }

      // 5. Corte mínimo (cuellos de botella)
      if (overlay.minCut && overlay.minCut.length > 0) {
        ctx.lineCap = "round";
        for (const c of overlay.minCut) {
          const p1 = this.pos[c.u];
          const p2 = this.pos[c.v];
          if (!p1 || !p2) continue;
          ctx.beginPath();
          ctx.strokeStyle = KF.PALETA.ALGORITMO.edmonds_karp;
          ctx.lineWidth = 4.2;
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // 6. Rutas secundarias (ej. ruta original en historia)
      if (overlay.secondaryPath && overlay.secondaryPath.length > 1) {
        this._drawPolyline(
          ctx,
          overlay.secondaryPath,
          overlay.secondaryColor || "#A2412E",
          2.6,
          true
        );
      }

      // 7. Ruta principal
      if (overlay.path && overlay.path.length > 1) {
        this._drawPolyline(
          ctx,
          overlay.path,
          overlay.pathColor || KF.PALETA.ALGORITMO.bfs,
          3.4,
          false
        );
      }

      // 8. Operarios en movimiento (simulación o historia)
      if (overlay.workers && overlay.workers.length > 0) {
        for (const w of overlay.workers) {
          const p = this.pos[w.node];
          if (!p) continue;
          if (w.halo) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, (w.radius || 4.8) + 3.4, 0, Math.PI * 2);
            ctx.lineWidth = 2.4;
            ctx.strokeStyle = w.halo;
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.fillStyle = w.color || KF.PALETA.TINTA;
          ctx.arc(p.x, p.y, w.radius || 4.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = "#FFFFFF";
          ctx.stroke();
          if (w.etiqueta) {
            ctx.font = "700 8px 'JetBrains Mono', Consolas, monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = KF.PALETA.TINTA;
            ctx.fillText(w.etiqueta, p.x, p.y - (w.radius || 4.8) - 4);
          }
        }
      }

      // 9. Corredor / nodo averiado o bloqueado
      if (overlay.blockedNodes && overlay.blockedNodes.length > 1) {
        const first = this.pos[overlay.blockedNodes[0]];
        const last = this.pos[overlay.blockedNodes[overlay.blockedNodes.length - 1]];
        if (first && last) {
          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = "rgba(193, 18, 31, 0.28)";
          ctx.lineWidth = 14;
          ctx.lineCap = "round";
          ctx.moveTo(first.x, first.y);
          ctx.lineTo(last.x, last.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.strokeStyle = KF.PALETA.ALGORITMO.edmonds_karp;
          ctx.lineWidth = 3.2;
          ctx.setLineDash([4, 4]);
          ctx.moveTo(first.x, first.y);
          ctx.lineTo(last.x, last.y);
          ctx.stroke();
          ctx.restore();
        }
      }
      if (overlay.blockedNode && this.pos[overlay.blockedNode]) {
        this._drawBlockedBadge(ctx, this.pos[overlay.blockedNode], 8);
      }
      if (overlay.blockedList && overlay.blockedList.length > 0) {
        for (const bid of overlay.blockedList) {
          if (this.pos[bid]) this._drawBlockedBadge(ctx, this.pos[bid], 6.8);
        }
      }

      // 10. Destinos (numerados si hay varios)
      if (overlay.destinations && overlay.destinations.length > 0) {
        const showNums = overlay.destinations.length > 1;
        for (let i = 0; i < overlay.destinations.length; i++) {
          const p = this.pos[overlay.destinations[i]];
          if (!p) continue;
          ctx.save();
          ctx.shadowColor = "rgba(0, 41, 107, 0.25)";
          ctx.shadowBlur = 5;
          ctx.beginPath();
          ctx.fillStyle = "#FFFFFF";
          ctx.arc(p.x, p.y, showNums ? 7.4 : 6.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = KF.PALETA.TINTA;
          ctx.stroke();
          ctx.restore();
          if (showNums) {
            ctx.fillStyle = KF.PALETA.TINTA;
            ctx.font = "700 8.5px 'JetBrains Mono', Consolas, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(i + 1), p.x, p.y + 0.4);
            ctx.textBaseline = "alphabetic";
          }
        }
      }

      // 11. Inicio
      if (overlay.start && this.pos[overlay.start]) {
        const p = this.pos[overlay.start];
        ctx.save();
        ctx.shadowColor = "rgba(0, 41, 107, 0.35)";
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.fillStyle = KF.PALETA.TINTA;
        ctx.arc(p.x, p.y, 7.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2.2;
        ctx.strokeStyle = "#FFFFFF";
        ctx.stroke();
        ctx.restore();
      }

      // Marcas puntuales (p. ej. dónde un operario esperó o cedió el paso)
      if (overlay.marcas && overlay.marcas.length > 0) {
        for (const mk of overlay.marcas) {
          const p = this.pos[mk.node];
          if (!p) continue;
          ctx.beginPath();
          ctx.arc(p.x, p.y, mk.radius || 6, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.setLineDash(mk.dash ? [2, 2] : []);
          ctx.strokeStyle = mk.color || KF.PALETA.FRENTE;
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Ubicación elegida como primer extremo de un pasillo nuevo
      if (overlay.seleccion && this.pos[overlay.seleccion]) {
        const p = this.pos[overlay.seleccion];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = KF.PALETA.NUEVO || "#7C3AED";
        ctx.stroke();
      }

      // 12. Halo interactivo en el nodo bajo el cursor
      if (this._hoverNode && this.pos[this._hoverNode.id]) {
        const p = this.pos[this._hoverNode.id];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7.5, 0, Math.PI * 2);
        ctx.strokeStyle = KF.PALETA.FRENTE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    _drawBlockedBadge(ctx, p, r) {
      ctx.save();
      ctx.shadowColor = "rgba(193, 18, 31, 0.4)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.fillStyle = KF.PALETA.ALGORITMO.edmonds_karp;
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const d = r * 0.42;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - d, p.y - d);
      ctx.lineTo(p.x + d, p.y + d);
      ctx.moveTo(p.x + d, p.y - d);
      ctx.lineTo(p.x - d, p.y + d);
      ctx.stroke();
    }

    _drawPolyline(ctx, nodes, color, width, dashed) {
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      if (dashed) ctx.setLineDash([5, 5]);
      // Halo suave debajo para máxima legibilidad sobre el plano
      if (!dashed) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
        ctx.lineWidth = width + 2.6;
        for (let i = 0; i < nodes.length; i++) {
          const p = this.pos[nodes[i]];
          if (!p) continue;
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      for (let i = 0; i < nodes.length; i++) {
        const p = this.pos[nodes[i]];
        if (!p) continue;
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------- Controlador de reproducción reutilizable ---------- */
  class PlaybackController {
    constructor(container, totalFrames, onFrame, baseMs = 140) {
      this.container = container;
      this.total = Math.max(1, totalFrames);
      this.onFrame = onFrame;
      this.baseMs = baseMs;
      this.index = 0;
      this.speed = 1;
      this.playing = false;
      this.timer = null;

      this._renderUI();
      this._bindKeyboard();
      this.goTo(0);
    }

    _bindKeyboard() {
      this._onKeyDown = (ev) => {
        const tag = (ev.target && ev.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (ev.code === "Space") {
          ev.preventDefault();
          if (this.playing) this.pause();
          else this.play(this.speed || 1);
        } else if (ev.key === "ArrowRight") {
          ev.preventDefault();
          this.pause();
          this.goTo(this.index + 1);
        } else if (ev.key === "ArrowLeft") {
          ev.preventDefault();
          this.pause();
          this.goTo(this.index - 1);
        } else if (ev.key === "r" || ev.key === "R") {
          this.pause();
          this.goTo(0);
        }
      };
      window.addEventListener("keydown", this._onKeyDown);
    }

    _renderUI() {
      this.container.innerHTML = `
        <div class="playback-bar">
          <div class="playback-btns">
            <button type="button" class="pb-btn" data-act="reset" title="Reiniciar (tecla R)">⟲</button>
            <button type="button" class="pb-btn" data-speed="0.5">▶ 0.5×</button>
            <button type="button" class="pb-btn" data-speed="1" title="Reproducir / Pausar (Espacio)">▶ 1×</button>
            <button type="button" class="pb-btn" data-speed="2">▶ 2×</button>
            <button type="button" class="pb-btn" data-speed="4">▶ 4×</button>
            <button type="button" class="pb-btn" data-act="pause" title="Pausar (Espacio)">❚❚</button>
          </div>
          <input type="range" class="playback-slider" min="0" max="${this.total - 1}" value="0" aria-label="Progreso de animación" />
          <span class="playback-counter">1 / ${this.total}</span>
          <span class="pb-hint" title="Atajos: Espacio (play/pausa), ←/→ (paso), R (reiniciar)">Espacio · ← →</span>
        </div>
      `;
      this.slider = this.container.querySelector(".playback-slider");
      this.counter = this.container.querySelector(".playback-counter");
      this.speedBtns = Array.from(this.container.querySelectorAll("[data-speed]"));

      this.container.querySelector('[data-act="reset"]').addEventListener("click", () => {
        this.pause();
        this.goTo(0);
      });
      this.container.querySelector('[data-act="pause"]').addEventListener("click", () => {
        this.pause();
      });
      this.speedBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          this.play(parseFloat(btn.dataset.speed));
        });
      });
      this.slider.addEventListener("input", () => {
        this.pause();
        this.goTo(parseInt(this.slider.value, 10));
      });
    }

    goTo(idx) {
      this.index = Math.max(0, Math.min(this.total - 1, idx));
      this.slider.value = String(this.index);
      this.counter.textContent = `${this.index + 1} / ${this.total}`;
      this.onFrame(this.index);
    }

    play(speed = 1) {
      this.pause();
      this.speed = speed;
      this.playing = true;
      if (this.index >= this.total - 1) this.index = 0;
      this.speedBtns.forEach((b) =>
        b.classList.toggle("active", parseFloat(b.dataset.speed) === speed)
      );
      const tick = () => {
        if (!this.playing) return;
        this.goTo(this.index);
        if (this.index >= this.total - 1) {
          this.pause();
          return;
        }
        this.index++;
        this.timer = setTimeout(tick, Math.max(16, this.baseMs / this.speed));
      };
      tick();
    }

    pause() {
      this.playing = false;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.speedBtns.forEach((b) => b.classList.remove("active"));
    }

    destroy() {
      this.pause();
      if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    }
  }

  KF.WarehouseCanvas = WarehouseCanvas;
  KF.PlaybackController = PlaybackController;
})(window);
