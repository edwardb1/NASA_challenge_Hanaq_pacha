/* Hanaq Pacha - dibujo animado de la parcela del simulador.
   Es una ILUSTRACION de lo que calcula sim.js, no una simulacion aparte:
     tamanio de las plantas y cantidad de frutos = indice de rendimiento
     hojas amarillas                             = perdida por sal
     plantas caidas, suelo claro y agrietado     = falta de riego
     manchas blancas en el suelo                 = sal acumulada en el suelo (ECe)
     suelo ocre claro / marron oscuro            = suelo seco / suelo humedo
     gotas y charcos                             = agua aplicada
   Sin librerias: canvas 2D. Uso:  Granja.actualizar(canvas, estado)  */
(function (raiz) {
  'use strict';

  var CAMPOS = ['vigor', 'ySal', 'yRiego', 'riego', 'ece', 'cobertura', 'brote'];
  var ARBOLES = { olivo: true };
  var ESCALA = { zapallo: 1.75, betarraga: 1.6, cebolla: 1.5, alfalfa: 1.45, papa: 1.15, frijol: 1.4, maiz: 1.15 };   // tamanio del dibujo de cada cultivo
  var lienzos = [];                 // { canvas, ctx, actual, meta, cultivo }
  var corriendo = false, anterior = 0;
  var quieto = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- utilidades
  function azar(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function limitar(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function entre(a, b, t) { return a + (b - a) * t; }
  function mezcla(a, b, t) {
    t = limitar(t, 0, 1);
    var h = function (s, i) { return parseInt(s.substr(1 + 2 * i, 2), 16); };
    var c = [0, 1, 2].map(function (i) { return Math.round(entre(h(a, i), h(b, i), t)); });
    return '#' + c.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function circulo(ctx, x, y, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, 6.2832); ctx.fill(); }
  function elipse(ctx, x, y, rx, ry, color, giro) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), giro || 0, 0, 6.2832); ctx.fill();
  }
  function trazo(ctx, puntos, ancho, color) {
    ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(puntos[0], puntos[1]);
    for (var i = 2; i < puntos.length; i += 2) ctx.lineTo(puntos[i], puntos[i + 1]);
    ctx.stroke();
  }
  function curva(ctx, x0, y0, cx, cy, x1, y1, ancho, color) {
    ctx.strokeStyle = color; ctx.lineWidth = ancho; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(cx, cy, x1, y1); ctx.stroke();
  }
  /* hoja con forma de gota entre dos puntos */
  function hoja(ctx, x0, y0, x1, y1, ancho, color) {
    var dx = x1 - x0, dy = y1 - y0, l = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / l * ancho, ny = dx / l * ancho;
    var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx + nx, my + ny, x1, y1); ctx.quadraticCurveTo(mx - nx, my - ny, x0, y0); ctx.fill();
  }

  // ---------------------------------------------------------------- escena
  /* Paleta "Valle Organico Soleado". El sol esta arriba a la derecha: la luz cae en el lado derecho y superior
     de cada planta y la sombra queda abajo a la izquierda. */
  var P = { cieloAlto: '#90C2E7', cieloBajo: '#F3E9D2', sueloSeco: '#C2A67D', sueloHumedo: '#59412E',
            sombra: '#264017', medio: '#4B7526', luz: '#8CB342', rojo: '#B8291F', girasol: '#F2A922' };

  function geometria(W, H) {
    return { yB: H * 0.33, yF: H * 0.86, xB0: W * 0.17, xB1: W * 0.83, xF0: W * 0.035, xF1: W * 0.965, grosor: H * 0.08 };
  }
  function proyectar(g, u, v) {
    var x0 = entre(g.xB0, g.xF0, v), x1 = entre(g.xB1, g.xF1, v);
    return { x: entre(x0, x1, u), y: entre(g.yB, g.yF, v), s: entre(0.66, 1, v) };
  }
  function banda(ctx, g, v0, v1, color) {                       // franja de lado a lado de la parcela
    var a = proyectar(g, 0, v0), b = proyectar(g, 1, v0), c = proyectar(g, 1, v1), d = proyectar(g, 0, v1);
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.fill();
  }
  function colina(ctx, W, H, y, alturas, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, y - alturas[0] * H);
    var n = alturas.length - 1;
    for (var i = 1; i <= n; i++) {
      var x0 = W * (i - 1) / n, x1 = W * i / n;
      ctx.bezierCurveTo(x0 + (x1 - x0) * 0.5, y - alturas[i - 1] * H, x0 + (x1 - x0) * 0.5, y - alturas[i] * H, x1, y - alturas[i] * H);
    }
    ctx.lineTo(W, H); ctx.fill();
  }

  function cielo(ctx, W, H, g, t) {
    var grad = ctx.createLinearGradient(0, 0, 0, g.yB);
    grad.addColorStop(0, P.cieloAlto); grad.addColorStop(0.62, '#C9DFEA'); grad.addColorStop(1, P.cieloBajo);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    // sol con resplandor calido
    var sx = W * 0.85, sy = H * 0.13, sr = W * 0.032;
    var halo = ctx.createRadialGradient(sx, sy, sr * 0.5, sx, sy, W * 0.30);
    halo.addColorStop(0, 'rgba(255,238,170,0.95)'); halo.addColorStop(0.18, 'rgba(255,214,120,0.50)');
    halo.addColorStop(0.5, 'rgba(255,205,120,0.16)'); halo.addColorStop(1, 'rgba(255,205,120,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, W, g.yB + H * 0.1);
    var nucleo = ctx.createRadialGradient(sx - sr * 0.2, sy - sr * 0.2, sr * 0.1, sx, sy, sr * (1 + 0.03 * Math.sin(t * 1.3)));
    nucleo.addColorStop(0, '#FFF7D6'); nucleo.addColorStop(1, '#FFD15C');
    circulo(ctx, sx, sy, sr * (1 + 0.03 * Math.sin(t * 1.3)), nucleo);
    // nubes suaves que pasan despacio
    for (var i = 0; i < 2; i++) {
      var cx = ((t * (5 + i * 3) + i * W * 0.55) % (W * 1.3)) - W * 0.15, cy = H * (0.08 + i * 0.08), k = W * (0.021 + i * 0.006);
      ctx.globalAlpha = 0.5; elipse(ctx, cx + k * 0.2, cy + k * 0.3, k * 2.3, k * 0.55, '#E9DFC8');
      ctx.globalAlpha = 0.9; elipse(ctx, cx, cy, k * 2.2, k * 0.62, '#FFFDF6'); elipse(ctx, cx - k, cy + k * 0.12, k * 1.3, k * 0.5, '#FFFDF6');
      elipse(ctx, cx + k * 1.1, cy + k * 0.15, k * 1.5, k * 0.45, '#FFFDF6'); elipse(ctx, cx + k * 0.2, cy - k * 0.3, k * 1.1, k * 0.5, '#FFFFFF');
      ctx.globalAlpha = 1;
    }
    // colinas lejanas en tonos tierra y oliva apagados (mas claras cuanto mas lejos)
    colina(ctx, W, H, g.yB, [0.045, 0.10, 0.06, 0.115, 0.07, 0.09], '#C9C3A6');
    colina(ctx, W, H, g.yB, [0.02, 0.055, 0.075, 0.035, 0.065, 0.03], '#B3AE86');
    colina(ctx, W, H, g.yB, [0.01, 0.03, 0.012, 0.035, 0.02, 0.045], '#C9B58A');
    // olivares lejanos sobre la colina cercana
    for (i = 0; i < 46; i++) {
      var ox = W * azar(i + 40), oy = g.yB - H * (0.004 + azar(i + 70) * 0.022);
      elipse(ctx, ox, oy, W * 0.006, W * 0.0035, i % 3 ? '#7E8A5E' : '#6C7A52');
    }
    // llano de arena alrededor de la parcela
    var arena = ctx.createLinearGradient(0, g.yB, 0, H);
    arena.addColorStop(0, '#DCC79B'); arena.addColorStop(1, '#C9AE7C');
    ctx.fillStyle = arena; ctx.fillRect(0, g.yB, W, H);
    for (i = 0; i < 40; i++) {                                                         // ondas de arena
      var ax = W * azar(i + 11), ay = g.yB + (H - g.yB) * azar(i + 23), al = W * (0.02 + azar(i + 5) * 0.04);
      curva(ctx, ax, ay, ax + al * 0.5, ay - al * 0.08, ax + al, ay, Math.max(0.6, W * 0.0015), 'rgba(160,128,80,0.22)');
    }
  }

  function suelo(ctx, W, H, g, e, filas, arbol) {
    var humedad = limitar((e.riego - 0.5) / 0.65, 0, 1);
    var tierra = mezcla(P.sueloSeco, P.sueloHumedo, humedad);
    var clara = mezcla(tierra, '#FFE9BF', 0.22), oscura = mezcla(tierra, '#1E130A', 0.38), i, p;
    // sombra del bloque sobre la arena
    ctx.globalAlpha = 0.22; elipse(ctx, W * 0.5, g.yF + g.grosor * 1.05, W * 0.47, g.grosor * 0.5, '#3A2A18'); ctx.globalAlpha = 1;
    // cara frontal: bloque de tierra con capas
    var frente = ctx.createLinearGradient(0, g.yF, 0, g.yF + g.grosor);
    frente.addColorStop(0, mezcla(tierra, '#1E130A', 0.30)); frente.addColorStop(1, mezcla(tierra, '#1E130A', 0.62));
    ctx.fillStyle = frente; ctx.beginPath(); ctx.moveTo(g.xF0, g.yF); ctx.lineTo(g.xF1, g.yF); ctx.lineTo(g.xF1 - W * 0.008, g.yF + g.grosor);
    ctx.lineTo(g.xF0 + W * 0.008, g.yF + g.grosor); ctx.fill();
    trazo(ctx, [g.xF0 + W * 0.003, g.yF + g.grosor * 0.42, g.xF1 - W * 0.003, g.yF + g.grosor * 0.42], Math.max(1, H * 0.006), 'rgba(30,19,10,0.22)');
    for (i = 0; i < 26; i++) elipse(ctx, entre(g.xF0, g.xF1, azar(i + 610)), g.yF + g.grosor * (0.15 + azar(i + 640) * 0.7), W * 0.004, W * 0.0022, 'rgba(255,233,191,0.16)');
    // superficie: mas clara al fondo (bruma y sol), mas rica cerca
    var sup = ctx.createLinearGradient(0, g.yB, 0, g.yF);
    sup.addColorStop(0, mezcla(tierra, '#F3E9D2', 0.28)); sup.addColorStop(0.5, tierra); sup.addColorStop(1, mezcla(tierra, '#1E130A', 0.10));
    ctx.fillStyle = sup;
    ctx.beginPath(); ctx.moveTo(g.xB0, g.yB); ctx.lineTo(g.xB1, g.yB); ctx.lineTo(g.xF1, g.yF); ctx.lineTo(g.xF0, g.yF); ctx.fill();
    // surcos de labranza: cada uno con su lomo iluminado y su sombra propia
    var paso = arbol ? 0.055 : 0.0325;
    for (var v = 0.02; v < 0.985; v += paso) {
      ctx.globalAlpha = 0.5; banda(ctx, g, v, v + paso * 0.34, oscura);
      ctx.globalAlpha = 0.42; banda(ctx, g, v + paso * 0.5, v + paso * 0.78, clara); ctx.globalAlpha = 1;
    }
    // camellones donde va el cultivo: lomo claro arriba, sombra marcada abajo
    for (i = 0; i < filas.length; i++) {
      var f = filas[i], a = arbol ? 0.05 : 0.036;
      ctx.globalAlpha = 0.55; banda(ctx, g, f - a, f + a * 0.2, clara);
      ctx.globalAlpha = 0.6; banda(ctx, g, f + a * 0.2, f + a * 0.85, oscura); ctx.globalAlpha = 1;
    }
    // terrones y piedritas
    for (i = 0; i < 150; i++) {
      p = proyectar(g, 0.02 + azar(i + 700) * 0.96, 0.02 + azar(i + 760) * 0.96);
      ctx.globalAlpha = 0.28; elipse(ctx, p.x, p.y, W * 0.0035 * p.s * (0.6 + azar(i)), W * 0.0018 * p.s, i % 2 ? oscura : clara); ctx.globalAlpha = 1;
    }
    // borde iluminado del fondo y de la derecha
    trazo(ctx, [g.xB0, g.yB, g.xB1, g.yB], Math.max(1, H * 0.005), 'rgba(255,233,191,0.55)');
    trazo(ctx, [g.xF0, g.yF, g.xF1, g.yF], Math.max(1, H * 0.006), 'rgba(255,233,191,0.30)');
    // grietas cuando falta agua
    var seco = limitar((0.85 - e.riego) / 0.35, 0, 1), n = Math.round(seco * 30);
    for (i = 0; i < n; i++) {
      p = proyectar(g, 0.04 + azar(i + 900) * 0.92, 0.05 + azar(i + 950) * 0.9);
      var l = W * 0.013 * p.s;
      trazo(ctx, [p.x - l, p.y, p.x - l * 0.2, p.y + l * 0.35, p.x + l * 0.3, p.y - l * 0.15, p.x + l, p.y + l * 0.25], Math.max(0.8, W * 0.0018), 'rgba(74,50,28,' + (0.3 + 0.4 * seco) + ')');
      trazo(ctx, [p.x - l * 0.2, p.y + l * 0.35, p.x - l * 0.4, p.y + l * 0.75], Math.max(0.6, W * 0.0014), 'rgba(74,50,28,' + (0.25 + 0.3 * seco) + ')');
    }
    // costra de sal: mas manchas blancas cuanto mas sal acumula el suelo
    var sal = limitar((e.ece - 2) / 10, 0, 1); n = Math.round(sal * 70);
    for (i = 0; i < n; i++) {
      p = proyectar(g, 0.03 + azar(i + 300) * 0.94, 0.04 + azar(i + 350) * 0.93);
      var r = W * (0.006 + azar(i + 400) * 0.012) * p.s;
      ctx.globalAlpha = 0.25; elipse(ctx, p.x - r * 0.15, p.y + r * 0.2, r * 1.8, r * 0.62, '#8C7A6B');
      ctx.globalAlpha = 0.6 + 0.35 * sal;
      elipse(ctx, p.x, p.y, r * 1.7, r * 0.58, '#F4EEDC'); elipse(ctx, p.x + r * 0.7, p.y - r * 0.08, r, r * 0.36, '#FFFFFF');
      ctx.globalAlpha = 1;
    }
    // charcos cuando se riega de mas
    var exceso = limitar((e.riego - 1.1) / 0.4, 0, 1); n = Math.round(exceso * 9);
    for (i = 0; i < n; i++) {
      p = proyectar(g, 0.08 + azar(i + 500) * 0.84, filas[i % filas.length] + 0.035);
      ctx.globalAlpha = 0.55; elipse(ctx, p.x, p.y, W * 0.032 * p.s, W * 0.0065 * p.s, '#6FA9C9');
      ctx.globalAlpha = 0.7; elipse(ctx, p.x + W * 0.008 * p.s, p.y - W * 0.0012 * p.s, W * 0.014 * p.s, W * 0.002 * p.s, '#DDF0F7'); ctx.globalAlpha = 1;
    }
  }

  function cerca(ctx, W, g) {                       // cerca de madera al fondo de la parcela
    var n = 14, alto = W * 0.022, i, a, b;
    for (var r = 0; r < 2; r++) {
      a = proyectar(g, -0.01, 0); b = proyectar(g, 1.01, 0);
      trazo(ctx, [a.x, a.y - alto * (0.45 + r * 0.38), b.x, b.y - alto * (0.45 + r * 0.38)], Math.max(1, W * 0.0032), r ? '#A9855A' : '#8A6A45');
    }
    for (i = 0; i <= n; i++) {
      a = proyectar(g, -0.01 + 1.02 * i / n, 0);
      trazo(ctx, [a.x, a.y, a.x, a.y - alto], Math.max(1.4, W * 0.005), '#7A5C3A');
      trazo(ctx, [a.x + W * 0.0015, a.y, a.x + W * 0.0015, a.y - alto], Math.max(0.7, W * 0.0018), '#C19A68');
    }
  }

  function riego(ctx, W, g, e, v, cols, t, fila) {
    // cinta de riego por goteo, bulbo humedo y gotas
    var a = proyectar(g, 0.01, v + 0.012), b = proyectar(g, 0.99, v + 0.012);
    trazo(ctx, [a.x, a.y, b.x, b.y], Math.max(1.2, W * 0.0034 * a.s), '#22292B');
    trazo(ctx, [a.x, a.y - W * 0.0008, b.x, b.y - W * 0.0008], Math.max(0.5, W * 0.001), 'rgba(255,255,255,0.22)');
    var fuerza = limitar((e.riego - 0.45) / 0.75, 0, 1);
    for (var i = 0; i < cols; i++) {
      var p = proyectar(g, (i + 0.5) / cols, v + 0.012), fase = (t * (0.5 + fuerza) + azar(i * 7 + fila * 31)) % 1;
      if (azar(i * 13 + fila * 17) > fuerza + 0.15) continue;           // con poca agua, varios goteros secos
      ctx.globalAlpha = 0.30 * fuerza; elipse(ctx, p.x, p.y + W * 0.004 * p.s, W * 0.02 * p.s, W * 0.006 * p.s, '#2E1F12'); ctx.globalAlpha = 1;
      var r = W * 0.0042 * p.s * (0.5 + fuerza * 0.7);
      ctx.globalAlpha = 1 - fase; circulo(ctx, p.x, p.y + fase * W * 0.008 * p.s, r * (0.6 + fase * 0.6), '#5DB1E4');
      circulo(ctx, p.x - r * 0.25, p.y + fase * W * 0.008 * p.s - r * 0.25, r * 0.3, '#E6F5FC'); ctx.globalAlpha = 1;
      ctx.globalAlpha = 0.35 * fase; elipse(ctx, p.x, p.y + W * 0.009 * p.s, r * 3 * fase, r * fase, '#4A93C4'); ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- plantas
  /* Follaje con volumen en tres tonos: sombra abajo a la izquierda, tono medio y brillo calido donde pega el sol.
     Cada dibujante recibe: ctx ya trasladado a la base de la planta, U (unidad en pixeles), k (tamanio 0..1),
     col (sombra, medio, luz), frutos (0..1), vaiven (radianes), semilla */
  function follaje(ctx, cx, cy, rx, ry, col, s, n, vaiven) {
    var b = [], i;
    for (i = 0; i < n; i++) {
      var a = azar(s + i * 2.3) * 6.2832, d = Math.sqrt(azar(s + i * 4.1)) * 0.72;
      var y = Math.sin(a) * d * ry, alto = 0.5 - y / (2 * ry || 1);                   // 0 abajo, 1 arriba
      b.push({ x: cx + Math.cos(a) * d * rx + vaiven * ry * 1.6 * alto, y: cy + y, r: Math.min(rx, ry * 1.25) * (0.40 + azar(s + i * 1.7) * 0.22) });
    }
    for (i = 0; i < n; i++) circulo(ctx, b[i].x - b[i].r * 0.20, b[i].y + b[i].r * 0.24, b[i].r * 1.04, col.sombra);
    for (i = 0; i < n; i++) circulo(ctx, b[i].x, b[i].y, b[i].r * 0.92, col.medio);
    for (i = 0; i < n; i++) circulo(ctx, b[i].x + b[i].r * 0.26, b[i].y - b[i].r * 0.30, b[i].r * 0.52, col.luz);
    ctx.globalAlpha = 0.55;
    for (i = 0; i < n; i++) circulo(ctx, b[i].x + b[i].r * 0.42, b[i].y - b[i].r * 0.46, b[i].r * 0.20, mezcla(col.luz, '#FFF3B0', 0.55));
    ctx.globalAlpha = 1;
    return b;
  }
  function fruto(ctx, x, y, r, color) {             // fruto redondo con sombra y brillo
    circulo(ctx, x - r * 0.08, y + r * 0.1, r * 1.05, mezcla(color, '#2A0D08', 0.45));
    circulo(ctx, x, y, r * 0.94, color);
    circulo(ctx, x + r * 0.3, y - r * 0.32, r * 0.28, 'rgba(255,255,255,0.62)');
  }
  function sobreCopa(b, s, i) {                     // un punto sobre el follaje para colgar frutos o flores
    var q = b[Math.floor(azar(s + i * 9.1) * b.length) % b.length], a = azar(s + i * 6.3) * 6.2832, d = azar(s + i * 3.7) * q.r * 0.7;
    return { x: q.x + Math.cos(a) * d, y: q.y + Math.sin(a) * d };
  }

  var PLANTAS = {
    olivo: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (5 + 6 * k), copa = U * (2.3 + 3.2 * k), i, q;
      // tronco retorcido: lado en sombra a la izquierda, luz a la derecha
      ctx.fillStyle = '#4E3622'; ctx.beginPath();
      ctx.moveTo(-U * 0.85, 0); ctx.quadraticCurveTo(-U * 0.25, -alto * 0.3, -U * 0.55, -alto * 0.64);
      ctx.lineTo(U * 0.5, -alto * 0.64); ctx.quadraticCurveTo(U * 0.8, -alto * 0.3, U * 0.9, 0); ctx.fill();
      ctx.fillStyle = '#8A6844'; ctx.beginPath();
      ctx.moveTo(U * 0.25, 0); ctx.quadraticCurveTo(U * 0.3, -alto * 0.3, U * 0.05, -alto * 0.64);
      ctx.lineTo(U * 0.5, -alto * 0.64); ctx.quadraticCurveTo(U * 0.8, -alto * 0.3, U * 0.9, 0); ctx.fill();
      curva(ctx, -U * 0.2, -alto * 0.2, U * 0.15, -alto * 0.35, -U * 0.1, -alto * 0.55, U * 0.14, '#3A2716');
      curva(ctx, 0, -alto * 0.5, -copa * 0.5, -alto * 0.75, -copa * 0.6, -alto * 0.95, U * 0.5, '#4E3622');
      curva(ctx, 0, -alto * 0.5, copa * 0.5, -alto * 0.7, copa * 0.55, -alto * 0.9, U * 0.45, '#6E5134');
      var b = follaje(ctx, 0, -alto * 0.94, copa, copa * 0.7, col, s, Math.round(5 + 7 * k), vaiven);
      var m = Math.round(frutos * 20);                                                 // aceitunas: verdes y moradas, con brillo
      for (i = 0; i < m; i++) {
        q = sobreCopa(b, s, i);
        elipse(ctx, q.x, q.y, U * 0.24, U * 0.33, i % 3 === 0 ? '#6E7F2E' : '#2B1F33', 0.4);
        circulo(ctx, q.x + U * 0.07, q.y - U * 0.1, U * 0.07, 'rgba(255,255,255,0.6)');
      }
    },
    maiz: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (3 + 8.5 * k), tx = vaiven * alto * 0.5;
      curva(ctx, -U * 0.08, 0, tx * 0.3 - U * 0.08, -alto * 0.5, tx, -alto, U * 0.5, col.sombra);
      curva(ctx, U * 0.06, 0, tx * 0.3 + U * 0.06, -alto * 0.5, tx, -alto, U * 0.22, col.luz);
      var n = Math.round(3 + 4 * k);
      for (var i = 0; i < n; i++) {
        var f = (i + 1) / (n + 1), lado = i % 2 ? 1 : -1, bx = tx * f * f, by = -alto * f, l = U * (2.4 + 1.6 * k) * (1 - f * 0.35);
        hoja(ctx, bx, by, bx + lado * l + vaiven * U * 3, by - l * 0.25 + l * 0.5 * f, U * 0.6, lado > 0 ? col.medio : col.sombra);
        if (lado > 0) hoja(ctx, bx, by, bx + l * 0.85 + vaiven * U * 3, by - l * 0.3 + l * 0.42 * f, U * 0.22, col.luz);
      }
      if (k > 0.45) for (i = -2; i <= 2; i++) curva(ctx, tx, -alto, tx + i * U * 0.3, -alto - U * 0.8, tx + i * U * 0.6, -alto - U * 1.5, U * 0.15, '#E0BD63');
      if (frutos > 0.12) {                       // mazorca
        var mx = tx * 0.25 + U * 0.6, my = -alto * 0.5;
        elipse(ctx, mx - U * 0.1, my + U * 0.1, U * 0.5, U * (0.7 + frutos), col.sombra, 0.35);
        elipse(ctx, mx, my, U * 0.44, U * (0.62 + frutos * 0.9), col.medio, 0.35);
        elipse(ctx, mx + U * 0.14, my - U * 0.28, U * 0.3, U * (0.42 + frutos * 0.8), P.girasol, 0.35);
        elipse(ctx, mx + U * 0.22, my - U * 0.4, U * 0.1, U * (0.2 + frutos * 0.4), '#FFE08A', 0.35);
      }
    },
    tomate: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.8 + 3.6 * k), ancho = U * (1.3 + 1.6 * k);
      trazo(ctx, [0, 0, 0, -alto * 1.12], U * 0.2, '#9B7B52');                          // tutor
      var b = follaje(ctx, 0, -alto * 0.56, ancho, alto * 0.52, col, s, 7, vaiven), n = Math.round(frutos * 8);
      for (var i = 0; i < n; i++) { var q = sobreCopa(b, s, i); fruto(ctx, q.x, q.y + U * 0.2, U * 0.46, i % 6 === 5 ? P.girasol : P.rojo); }
    },
    aji_pimiento: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.8 + 3.2 * k), ancho = U * (1.2 + 1.4 * k);
      var b = follaje(ctx, 0, -alto * 0.56, ancho, alto * 0.52, col, s, 7, vaiven), n = Math.round(frutos * 7);
      for (var i = 0; i < n; i++) {
        var q = sobreCopa(b, s, i), g = (azar(s + i) - 0.5) * 0.7, c = i % 3 === 2 ? P.girasol : P.rojo;
        elipse(ctx, q.x - U * 0.04, q.y + U * 0.35, U * 0.28, U * 0.74, mezcla(c, '#2A0D08', 0.45), g);
        elipse(ctx, q.x, q.y + U * 0.3, U * 0.24, U * 0.7, c, g);
        elipse(ctx, q.x + U * 0.07, q.y + U * 0.12, U * 0.06, U * 0.3, 'rgba(255,255,255,0.55)', g);
      }
    },
    papa: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.2 + 2.3 * k), ancho = U * (1.5 + 1.7 * k);
      var b = follaje(ctx, 0, -alto * 0.55, ancho, alto * 0.55, col, s, 8, vaiven), n = Math.round(frutos * 6);
      for (var i = 0; i < n; i++) {                                                     // flores blancas con centro amarillo
        var q = sobreCopa(b, s, i);
        for (var j = 0; j < 5; j++) circulo(ctx, q.x + Math.cos(j * 1.257) * U * 0.2, q.y - U * 0.2 + Math.sin(j * 1.257) * U * 0.2, U * 0.17, '#FFFDF9');
        circulo(ctx, q.x, q.y - U * 0.2, U * 0.13, P.girasol);
      }
    },
    frijol: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.3 + 2.4 * k), ancho = U * (1.2 + 1.5 * k);
      var b = follaje(ctx, 0, -alto * 0.55, ancho, alto * 0.52, col, s, 7, vaiven), n = Math.round(frutos * 6);
      for (var i = 0; i < n; i++) {                                                     // vainas
        var q = sobreCopa(b, s, i);
        curva(ctx, q.x, q.y, q.x + U * 0.4, q.y + U * 0.6, q.x + U * 0.1, q.y + U * 1.2, U * 0.3, '#5E7A22');
        curva(ctx, q.x + U * 0.05, q.y, q.x + U * 0.42, q.y + U * 0.58, q.x + U * 0.14, q.y + U * 1.15, U * 0.14, '#C5D56A');
      }
    },
    alfalfa: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.2 + 2.8 * k), n = Math.round(6 + 6 * k);
      for (var i = 0; i < n; i++) {
        var x = (i / (n - 1) - 0.5) * U * 3.2, tx = x * 1.25 + vaiven * alto * (0.6 + azar(s + i)), h = alto * (0.7 + azar(s + i * 2.9) * 0.35);
        curva(ctx, x * 0.5, 0, x, -h * 0.5, tx, -h, U * 0.22, col.sombra);
        circulo(ctx, tx - U * 0.08, -h + U * 0.1, U * 0.46, col.sombra); circulo(ctx, tx, -h, U * 0.42, col.medio); circulo(ctx, tx + U * 0.12, -h - U * 0.12, U * 0.22, col.luz);
        if (azar(s + i * 5.1) < frutos * 0.7) { circulo(ctx, tx + U * 0.1, -h - U * 0.34, U * 0.32, '#7556B0'); circulo(ctx, tx + U * 0.18, -h - U * 0.42, U * 0.14, '#B79BE6'); }
      }
    },
    cebolla: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.5 + 3.4 * k), n = Math.round(3 + 3 * k), rb = U * (0.5 + 0.55 * frutos);
      elipse(ctx, -rb * 0.08, -U * 0.06, rb * 1.05, rb * 0.8, '#8E5E1E'); elipse(ctx, 0, -U * 0.1, rb, rb * 0.76, '#D9A441');
      elipse(ctx, rb * 0.3, -U * 0.1 - rb * 0.28, rb * 0.3, rb * 0.2, '#F6DDA0');
      for (var i = 0; i < n; i++) {
        var f = n === 1 ? 0 : i / (n - 1) - 0.5, tx = f * U * 3 + vaiven * alto * 0.7, ty = -alto * (0.85 + azar(s + i) * 0.2);
        curva(ctx, 0, -U * 0.3, f * U * 1.2, -alto * 0.6, tx, ty, U * 0.34, f < 0 ? col.sombra : col.medio);
        if (f >= 0) curva(ctx, U * 0.06, -U * 0.3, f * U * 1.2 + U * 0.06, -alto * 0.6, tx, ty, U * 0.12, col.luz);
      }
    },
    betarraga: function (ctx, U, k, col, frutos, vaiven, s) {
      var alto = U * (1.3 + 2.6 * k), n = Math.round(4 + 3 * k), rb = U * (0.45 + 0.6 * frutos);
      for (var i = 0; i < n; i++) {
        var f = i / (n - 1) - 0.5, tx = f * U * 3.6 + vaiven * alto * 0.6, ty = -alto * (0.8 + azar(s + i) * 0.25);
        curva(ctx, 0, -U * 0.2, f * U * 1.2, -alto * 0.45, tx, ty, U * 0.22, '#9C2748');
        hoja(ctx, f * U * 1.4, -alto * 0.42, tx, ty, U * 0.8, f < 0 ? col.sombra : col.medio);
        if (f >= 0) hoja(ctx, f * U * 1.4 + U * 0.15, -alto * 0.45, tx, ty, U * 0.3, col.luz);
      }
      elipse(ctx, -rb * 0.08, -U * 0.02, rb * 1.05, rb * 0.7, '#4E1028'); elipse(ctx, 0, -U * 0.05, rb, rb * 0.66, '#8E2148');
      elipse(ctx, rb * 0.3, -U * 0.05 - rb * 0.25, rb * 0.28, rb * 0.16, '#D06A8E');
    },
    zapallo: function (ctx, U, k, col, frutos, vaiven, s) {
      var ancho = U * (1.8 + 2.6 * k), n = Math.round(4 + 4 * k), i, x, y;
      curva(ctx, -ancho, -U * 0.2, 0, -U * 1.1, ancho, -U * 0.25, U * 0.24, col.sombra);
      for (i = 0; i < n; i++) {
        x = (azar(s + i * 2.9) - 0.5) * ancho * 2 + vaiven * U * 2; y = -U * (0.4 + azar(s + i * 4.3) * (0.6 + 0.9 * k));
        var rx = U * (0.8 + 0.5 * k), ry = U * (0.48 + 0.3 * k);
        elipse(ctx, x - rx * 0.12, y + ry * 0.2, rx, ry, col.sombra); elipse(ctx, x, y, rx * 0.92, ry * 0.9, col.medio);
        elipse(ctx, x + rx * 0.25, y - ry * 0.28, rx * 0.5, ry * 0.42, col.luz);
      }
      var m = Math.round(frutos * 2.4);
      for (i = 0; i < m; i++) {
        x = (i === 0 ? 0.55 : -0.6) * ancho; var r = U * (0.8 + 0.5 * frutos);
        elipse(ctx, x - r * 0.1, -r * 0.62, r * 1.04, r * 0.78, '#8A4A0C'); elipse(ctx, x, -r * 0.7, r, r * 0.75, '#E07F17');
        elipse(ctx, x, -r * 0.7, r * 0.5, r * 0.75, '#EC9426'); elipse(ctx, x + r * 0.3, -r * 0.92, r * 0.3, r * 0.26, P.girasol);
        trazo(ctx, [x, -r * 1.42, x + U * 0.18, -r * 1.75], U * 0.24, '#4B6A22');
      }
    }
  };

  function seca(ctx, U, k) {                   // planta que no sobrevivio
    var h = U * (1.4 + 2 * k);
    trazo(ctx, [0, 0, U * 0.3, -h * 0.6, -U * 0.2, -h], U * 0.26, '#6F5437');
    trazo(ctx, [U * 0.2, -h * 0.5, U * 0.9, -h * 0.75], U * 0.18, '#8C6D48');
    trazo(ctx, [U * 0.1, -h * 0.3, -U * 0.7, -h * 0.55], U * 0.18, '#6F5437');
  }

  /* Tres tonos por cultivo, siempre a partir de la paleta base; un matiz leve distingue algunos cultivos */
  var MATIZ = { cebolla: '#2F7F6B', alfalfa: '#2E7A3A', papa: '#2C6B36', maiz: '#5E9A2C', betarraga: '#3E7F3C' };
  function colores(cultivo, e) {
    var sal = limitar(1 - e.ySal, 0, 1), sed = limitar(1 - e.yRiego, 0, 1), m = MATIZ[cultivo];
    var tono = function (c, luz) {
      if (m) c = mezcla(c, m, luz ? 0.18 : 0.35);
      return mezcla(mezcla(c, luz ? '#E3C24A' : '#B8922E', sal * 0.9), luz ? '#B9A873' : '#7E6E48', sed * 0.6);
    };
    return { sombra: tono(P.sombra, false), medio: tono(P.medio, false), luz: tono(P.luz, true) };
  }

  function planta(ctx, cultivo, x, y, U, e, t, semilla, chica) {
    var vigor = limitar(e.vigor, 0, 1.15), brote = limitar(e.brote, 0, 1);
    var mortalidad = limitar((0.5 - vigor) / 0.5, 0, 1) * 0.75;
    var k = limitar((0.12 + 0.88 * Math.min(1, vigor)) * (0.85 + azar(semilla) * 0.3) * (vigor > 1 ? 1.06 : 1), 0, 1.1) * brote;
    if (chica) k *= 0.55;
    var sed = limitar(1 - e.yRiego, 0, 1), arbol = !!ARBOLES[cultivo];
    // sombra en el suelo, hacia la izquierda (el sol esta a la derecha)
    ctx.globalAlpha = 0.26; elipse(ctx, x - U * (0.8 + 1.6 * k) * (arbol ? 1.5 : 1), y + U * 0.2, U * (1.1 + 3.1 * k) * (arbol ? 1.5 : 1), U * (0.36 + 0.7 * k), '#2A1B0E'); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(x, y);
    if (azar(semilla * 1.37 + 5) < mortalidad) { seca(ctx, U, k); ctx.restore(); return; }
    var viento = quieto ? 0 : Math.sin(t * 1.6 + semilla * 0.9) * 0.035 + Math.sin(t * 0.7 + semilla * 0.3) * 0.02;
    var caida = sed * 0.22 * (azar(semilla + 2) > 0.5 ? 1 : -1);                       // la falta de agua tumba la planta
    var frutos = limitar(Math.pow(Math.min(1, vigor), 1.6) * brote * (0.8 + azar(semilla + 9) * 0.4), 0, 1);
    if (chica) frutos = 0;
    PLANTAS[cultivo](ctx, U, k, colores(cultivo, e), frutos, viento + caida, semilla * 10);
    ctx.restore();
  }

  function mariposas(ctx, W, H, g, e, t) {
    if (quieto || e.vigor < 0.8) return;
    for (var i = 0; i < 3; i++) {
      var x = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.21 + i * 2.1))) + Math.sin(t * 1.3 + i) * W * 0.02;
      var y = entre(g.yB, g.yF, 0.25 + 0.2 * i) - H * 0.12 + Math.sin(t * 1.9 + i * 1.7) * H * 0.03, a = Math.abs(Math.sin(t * 11 + i)) * W * 0.008 + 1;
      var color = ['#FFFDF9', P.girasol, '#FFFFFF'][i];
      elipse(ctx, x - a * 0.5, y, a * 0.8, W * 0.0045, color, -0.5); elipse(ctx, x + a * 0.5, y, a * 0.8, W * 0.0045, color, 0.5);
    }
  }

  /* Dibuja un cuadro completo. e: { cultivo, vigor, ySal, yRiego, riego, ece, cobertura (0..1), brote (0..1) } */
  function pintar(ctx, W, H, e, t) {
    var g = geometria(W, H), arbol = !!ARBOLES[e.cultivo], nf = arbol ? 3 : 5, nc = arbol ? 6 : 10, filas = [], f, i, p;
    for (f = 0; f < nf; f++) filas.push(arbol ? 0.2 + f * 0.33 : 0.13 + f * 0.195);
    ctx.clearRect(0, 0, W, H);
    cielo(ctx, W, H, g, t);
    suelo(ctx, W, H, g, e, filas, arbol);
    cerca(ctx, W, g);
    for (f = 0; f < nf; f++) {
      riego(ctx, W, g, e, filas[f], nc, quieto ? 0.35 : t, f);
      for (i = 0; i < nc; i++) {
        p = proyectar(g, (i + 0.5) / nc + (azar(f * 31 + i) - 0.5) * 0.012, filas[f]);
        planta(ctx, e.cultivo, p.x, p.y, W / 100 * p.s * (arbol ? 1.12 : ESCALA[e.cultivo] || 1.3), e, t, f * 100 + i + 1, false);
      }
      if (arbol && e.cobertura > 0.02 && f < nf - 1) {                               // planta entre hileras
        var ec = { vigor: Math.min(1, 0.55 + 0.45 * e.vigor), ySal: e.ySal, yRiego: e.yRiego, brote: e.cobertura * e.brote };
        for (i = 0; i < 17; i++) {
          p = proyectar(g, (i + 0.5) / 17, filas[f] + 0.165);
          planta(ctx, 'frijol', p.x, p.y, W / 100 * p.s * 1.25, ec, t, 5000 + f * 100 + i, true);
        }
      }
    }
    mariposas(ctx, W, H, g, e, t);
    // luz calida de la tarde desde el sol
    var luz = ctx.createRadialGradient(W * 0.85, H * 0.13, 0, W * 0.85, H * 0.13, W * 0.95);
    luz.addColorStop(0, 'rgba(255,214,140,0.20)'); luz.addColorStop(0.6, 'rgba(255,214,140,0.05)'); luz.addColorStop(1, 'rgba(60,40,20,0.07)');
    ctx.fillStyle = luz; ctx.fillRect(0, 0, W, H);
  }

  // ---------------------------------------------------------------- animacion
  function ajustar(l) {
    var c = l.canvas, ancho = c.clientWidth;
    if (!ancho) return false;                                                        // pestania oculta
    var alto = Math.round(ancho * 0.56), dpr = Math.min(2, raiz.devicePixelRatio || 1);
    if (c.width !== Math.round(ancho * dpr) || c.height !== Math.round(alto * dpr)) {
      c.width = Math.round(ancho * dpr); c.height = Math.round(alto * dpr); c.style.height = alto + 'px';
    }
    l.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.W = ancho; l.H = alto;
    return true;
  }

  function cuadro(ahora) {
    var dt = Math.min(0.1, (ahora - anterior) / 1000 || 0.016); anterior = ahora;
    lienzos.forEach(function (l) {
      if (!l.meta || !ajustar(l)) return;
      CAMPOS.forEach(function (c) { l.actual[c] += (l.meta[c] - l.actual[c]) * (quieto ? 1 : Math.min(1, dt * 3.5)); });
      l.actual.cultivo = l.meta.cultivo;
      pintar(l.ctx, l.W, l.H, l.actual, ahora / 1000);
    });
    if (!quieto) raiz.requestAnimationFrame(cuadro); else corriendo = false;
  }

  function actualizar(canvas, estado) {
    var l = lienzos.filter(function (x) { return x.canvas === canvas; })[0];
    if (!l) { l = { canvas: canvas, ctx: canvas.getContext('2d'), actual: null, meta: null }; lienzos.push(l); }
    var meta = { cultivo: PLANTAS[estado.cultivo] ? estado.cultivo : 'tomate', vigor: +estado.vigor || 0, ySal: estado.ySal == null ? 1 : +estado.ySal,
                 yRiego: estado.yRiego == null ? 1 : +estado.yRiego, riego: estado.riego == null ? 1 : +estado.riego, ece: +estado.ece || 0,
                 cobertura: estado.cobertura ? 1 : 0, brote: 1 };
    if (!l.actual) { l.actual = JSON.parse(JSON.stringify(meta)); l.actual.brote = quieto ? 1 : 0; l.actual.cobertura = quieto ? meta.cobertura : 0; }
    else if (l.actual.cultivo !== meta.cultivo && !quieto) l.actual.brote = 0;        // cultivo nuevo: vuelve a brotar
    l.meta = meta;
    if (!corriendo) { corriendo = true; anterior = 0; raiz.requestAnimationFrame(cuadro); }
  }

  var api = { actualizar: actualizar, pintar: pintar, cultivos: Object.keys(PLANTAS) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Granja = api;
})(typeof window !== 'undefined' ? window : globalThis);
