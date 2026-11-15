/* Hanaq Pacha - "Que me conviene": compara tres caminos para la parcela segun las prioridades del agricultor.
   Reglas:
   - Usa solo lo que calcula el simulador (sim.js): agua, cosecha que se conserva y una regla declarada para el suelo.
     No hay precios, costos ni mercado: no tenemos esos datos de La Yarada y no se inventan.
   - Un cultivo no se recomienda solo por gastar menos agua: tiene que aguantar la sal de esa agua.
   - Las prioridades pesan de verdad: 1.a = 3, 2.a = 2, 3.a = 1. El calculo se muestra en la pagina.
   Uso:  Plan.iniciar(contenedor, cultivos, porId)  y  Plan.actualizar(estado)  */
(function (raiz) {
  'use strict';
  var PESOS = [3, 2, 1];
  var MINIMO_COMPATIBLE = 60;      // indice minimo para proponer un cultivo nuevo
  var MARGEN_CAMBIO = 5;           // ventaja minima (en puntos) para recomendar un cambio frente a seguir igual
  var MINIMO_VIABLE = 40;          // por debajo de este indice un camino no se recomienda: el cultivo casi no rinde
  var COBERTURA_REF = 'frijol';    // leguminosa anual de referencia para el agua del cultivo de cobertura; su tolerancia a la sal se toma de la leguminosa mas tolerante de la tabla
  var CRITERIOS = {
    agua: { nombre: 'Ahorrar agua', corto: 'Agua', ayuda: 'Gastar menos agua del acuífero', como: '100 puntos para el camino que menos agua usa; los demás, en proporción (la mitad de puntos si usa el doble).' },
    suelo: { nombre: 'Cuidar el suelo', corto: 'Suelo', ayuda: 'Conservar y mejorar la tierra', como: 'puntos fijos según la práctica: rotación con leguminosa 85, cultivo de cobertura 80, rotación sin leguminosa 65, cultivo permanente solo 55, el mismo cultivo cada campaña 35. Se restan 15 si el cultivo rinde menos de 50.' },
    cosecha: { nombre: 'Mantener la cosecha', corto: 'Cosecha', ayuda: 'Perder menos por sal y falta de riego', como: 'el índice de rendimiento del simulador: 100 si el cultivo no pierde nada por sal ni por falta de riego.' }
  };
  var ICONO = {
    agua: '<path d="M12 3 C8 9 5.5 12 5.5 15.5 a6.5 6.5 0 0 0 13 0 C18.5 12 16 9 12 3z"/>',
    suelo: '<path d="M3 17h18v4H3z"/><path d="M12 17V9M12 12c-3 0-4.5-1.8-4.5-4.5C10.5 7.5 12 9.3 12 12zM12 10c0-2.7 1.5-4.5 4.5-4.5C16.5 8.2 15 10 12 10z"/>',
    cosecha: '<path d="M4 10h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z"/><circle cx="8.5" cy="7" r="3"/><circle cx="15.5" cy="7" r="3"/><circle cx="12" cy="5.5" r="3"/>'
  };

  function num(x, d) { return Number(x).toLocaleString('es-PE', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); }
  function limitar(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function media(v) { return v.reduce(function (s, x) { return s + x; }, 0) / v.length; }
  function minus(s) { return s.charAt(0).toLowerCase() + s.slice(1); }

  // ------------------------------------------------------------------ calculo (sin tocar la pagina)
  /* Un tramo es un cultivo dentro de una estrategia, con su resultado del simulador */
  function tramo(S, porId, c, est, previo, cobertura) {
    var r = S.simular(c, { ecw: est.ecw, riego: est.riego, previo: previo || null, cobertura: cobertura || null, cultivos: porId });
    return { cultivo: c, r: r, indice: r.indice, agua: r.aguaTotal };
  }

  /* Aporte al suelo: regla cualitativa y declarada, no una medicion */
  function sueloDe(tramos, tipo) {
    var p = 45, por = [];
    var perenne = tramos[0].cultivo.perenne, hayLegum = tramos.some(function (t) { return t.cultivo.leguminosa; });
    if (tipo === 'cobertura') { p = 80; por.push('el cultivo de cobertura protege el suelo entre las hileras y, al ser leguminosa, le aporta nitrógeno'); }
    else if (tramos.length > 1 && hayLegum) { p = 85; por.push('alterna con una leguminosa, que aporta nitrógeno y corta el monocultivo'); }
    else if (tramos.length > 1) { p = 65; por.push('alterna dos cultivos y corta el monocultivo, sin leguminosa'); }
    else if (perenne && hayLegum) { p = 70; por.push('cultivo permanente y leguminosa: cubre el suelo todo el año'); }
    else if (perenne) { p = 55; por.push('cultivo permanente: no se labra cada campaña, pero no hay aporte nuevo'); }
    else if (hayLegum) { p = 55; por.push('es leguminosa, pero repetida cada campaña'); }
    else { p = 35; por.push('el mismo cultivo cada campaña, sin leguminosa ni cobertura'); }
    if ((tipo === 'cobertura' ? tramos[0].indice : media(tramos.map(function (t) { return t.indice; }))) < 50) { p -= 15; por.push('con esta sal el cultivo crece poco y deja el suelo más expuesto'); }
    p = limitar(p, 0, 100);
    return { puntos: p, etiqueta: p >= 75 ? 'Aporta al suelo' : p >= 50 ? 'Lo mantiene' : 'Sin aporte', por: por };
  }

  function estrategia(clave, titulo, detalle, tramos, tipo) {
    var e = {
      clave: clave, titulo: titulo, detalle: detalle, tipo: tipo, tramos: tramos,
      agua: tipo === 'cobertura' ? tramos[0].agua : media(tramos.map(function (t) { return t.agua; })),
      indice: tipo === 'cobertura' ? tramos[0].indice : media(tramos.map(function (t) { return t.indice; })),
      ece: tramos[0].r.ece, suelo: sueloDe(tramos, tipo), recomendable: true, avisos: [], medidas: []
    };
    e.unidad = tramos[0].cultivo.perenne && (tipo === 'cobertura' || tramos.length === 1) ? 'al año' : 'por campaña';
    return e;
  }

  /* est: { cultivoId, ecw, riego }   prioridades: ['agua','suelo','cosecha'] en orden de importancia */
  function evaluar(S, cultivos, porId, est, prioridades) {
    prioridades = (prioridades || []).filter(function (k) { return CRITERIOS[k]; });
    var actual = porId[est.cultivoId], legums = cultivos.filter(function (c) { return c.leguminosa; });
    var solo = function (c) { return tramo(S, porId, c, est); };
    var peso = {}; prioridades.forEach(function (k, i) { peso[k] = PESOS[i] || 1; });

    // 1. seguir igual
    var E1 = estrategia('actual', 'Seguir con ' + minus(actual.nombre), 'El mismo cultivo, sin rotación ni cultivo de cobertura', [solo(actual)], 'solo');
    if (E1.indice < 50) E1.avisos.push('Con esta sal, ' + minus(actual.nombre) + ' rinde menos de la mitad de lo que podría.');
    var mas = tramo(S, porId, actual, { ecw: est.ecw, riego: Math.min(1.5, est.riego + 0.15) });
    if (mas.indice - E1.indice >= 3 && est.riego < 1.5) {
      E1.medidas.push('Lavar sales: con 15 % más de riego el índice sube de ' + Math.round(E1.indice) + ' a ' + Math.round(mas.indice) +
        ', a costa de ' + num(mas.agua - E1.agua) + ' m³/ha más de agua del acuífero.');
    }
    E1.medidas.push('Mide la sal del agua del pozo al menos una vez por campaña y anótala.');

    // 3. rotar o diversificar (se arma antes que el cambio para no repetir cultivo)
    var E3, mejorLegum = legums.map(solo).sort(function (a, b) { return b.r.ySal - a.r.ySal; })[0];
    var otros = cultivos.filter(function (c) { return c.id !== actual.id; }).map(solo);
    var mejorNoLegum = otros.filter(function (t) { return !t.cultivo.leguminosa && !t.cultivo.perenne; }).sort(function (a, b) { return b.indice - a.indice; })[0];
    if (actual.perenne && !actual.leguminosa) {
      var cob = porId[COBERTURA_REF] || mejorLegum.cultivo, tCob = mejorLegum;
      E3 = estrategia('rotacion', actual.nombre + ' con cultivo de cobertura', 'Diversificar sin arrancar árboles: una leguminosa sembrada entre las hileras para cubrir y mejorar el suelo',
        [tramo(S, porId, actual, est, null, cob.id), tCob], 'cobertura');
      E3.medidas.push('Siembra una leguminosa de cobertura (por ejemplo veza o trébol) entre las hileras de una parte del olivar y compárala con el resto antes de extenderla.');
      E3.medidas.push('Córtala antes de la época de más calor para que no le quite agua al olivo.');
      E3.avisos.push('El cultivo de cobertura también bebe: unos ' + num(E3.tramos[0].r.aguaCobertura) + ' m³/ha más al año (calculado con una leguminosa anual, ' + minus(cob.nombre) + ', como referencia) y no garantiza más cosecha.');
      E3.avisos.push('La práctica está estudiada en olivares mediterráneos, no en La Yarada.');
      if (tCob.r.ySal < 0.6) { E3.avisos.unshift('Con esta sal ni una leguminosa tolerante prospera (tomamos la tolerancia de ' + minus(tCob.cultivo.nombre) + ' como referencia), así que el cultivo de cobertura no funcionaría.'); E3.recomendable = false; }
    } else {
      var pareja = actual.leguminosa ? mejorNoLegum : (legums.filter(function (c) { return !c.perenne; }).map(solo).sort(function (a, b) { return b.indice - a.indice; })[0] || mejorLegum);
      var conLegum = actual.leguminosa || pareja.cultivo.leguminosa;
      if (!actual.leguminosa && pareja.indice < 50) { pareja = mejorNoLegum; conLegum = false; }     // la leguminosa no aguanta esta sal: rotar con otro cultivo
      var a = actual.leguminosa ? tramo(S, porId, pareja.cultivo, est, actual.id) : tramo(S, porId, actual, est, conLegum ? pareja.cultivo.id : null);
      var b = actual.leguminosa ? solo(actual) : pareja;
      E3 = estrategia('rotacion', 'Rotar ' + minus(actual.nombre) + ' con ' + minus(pareja.cultivo.nombre), 'Una campaña cada cultivo; los valores son el promedio de las dos',
        actual.leguminosa ? [b, a] : [a, b], 'rotacion');
      E3.medidas.push('Alterna: una campaña ' + minus(actual.nombre) + ', la siguiente ' + minus(pareja.cultivo.nombre) + '. Empieza por una parte de la parcela.');
      if (conLegum) E3.avisos.push('El +20 % después de una leguminosa es un promedio mundial; no está medido en La Yarada.');
      else E3.avisos.push('Ninguna leguminosa aguanta esta sal, así que la rotación propuesta no suma nitrógeno al suelo.');
      if (pareja.indice < 50) { E3.avisos.push(pareja.cultivo.nombre + ' rinde poco con esta sal.'); E3.recomendable = false; }
    }

    // 2. cambiar de cultivo: el compatible que mejor responde a las prioridades
    var candidatos = otros.map(function (t) { return estrategia('cambio', 'Cambiar a ' + minus(t.cultivo.nombre), 'Reemplazar el cultivo actual', [t], 'solo'); });
    var puntuar = function (lista) {
      var minAgua = Math.min.apply(null, lista.map(function (e) { return e.agua; }));
      lista.forEach(function (e) {
        e.puntajes = { agua: 100 * minAgua / e.agua, suelo: e.suelo.puntos, cosecha: Math.min(100, e.indice) };
        var s = 0, w = 0; prioridades.forEach(function (k) { s += peso[k] * Math.round(e.puntajes[k]); w += peso[k]; });
        e.total = w ? s / w : null;
      });
    };
    puntuar([E1, E3].concat(candidatos));
    var compatibles = candidatos.filter(function (e) { return e.indice >= MINIMO_COMPATIBLE; });
    var orden = function (x, y) { return (y.total == null ? y.indice : y.total) - (x.total == null ? x.indice : x.total); };
    var E2 = (compatibles.length ? compatibles : candidatos).slice().sort(orden)[0];
    if (!compatibles.length) { E2.recomendable = false; E2.avisos.push('Ningún otro cultivo llega a un índice de ' + MINIMO_COMPATIBLE + ' con esta sal: cambiar no resuelve el problema.'); }
    if (actual.perenne && E1.indice >= 50) { E2.recomendable = false; E2.soloReferencia = true; }
    if (actual.perenne) E2.avisos.unshift('Cambiar ' + (actual.id === 'olivo' ? 'un olivar' : 'un cultivo permanente') + ' significa arrancar plantas que tardan años en producir. Esta comparación no incluye ese costo.');
    E2.medidas.push('Prueba primero ' + minus(E2.tramos[0].cultivo.nombre) + ' en una parte de la parcela.');
    E2.medidas.push('Antes de sembrar, averigua a quién se lo venderías y a qué precio: eso no lo calcula esta página.');
    if (E2.tramos[0].cultivo.perenne) E2.avisos.push(E2.tramos[0].cultivo.nombre + ' es un cultivo de varios años: el cambio no se revierte en una campaña.');

    var lista = [E1, E2, E3];
    puntuar(lista);
    lista.forEach(function (e) {
      if (e.indice < MINIMO_VIABLE && e.recomendable) { e.recomendable = false; e.avisos.unshift('Con esta sal y este riego rinde menos de ' + MINIMO_VIABLE + ' de 100.'); }
    });

    // recomendacion: la de mayor puntaje entre las recomendables; cambiar exige una ventaja clara
    var reco = null, motivo = '';
    if (prioridades.length) {
      var validas = lista.filter(function (e) { return e.recomendable; }).sort(function (x, y) { return y.total - x.total || (x.clave === 'actual' ? -1 : 1); });
      reco = validas[0] || null;
      if (reco && reco.clave === 'cambio') {
        var sinCambio = validas.filter(function (e) { return e.clave !== 'cambio'; })[0];
        if (sinCambio && reco.total - sinCambio.total < MARGEN_CAMBIO) {
          motivo = 'Cambiar de cultivo saca solo ' + num(reco.total - sinCambio.total, 1) + ' puntos de ventaja: no alcanza para justificar el cambio.';
          reco = sinCambio;
        }
      }
    }
    // prioridades que tiran para lados distintos
    var ganadores = {}, conflicto = [];
    prioridades.forEach(function (k) { ganadores[k] = lista.slice().sort(function (x, y) { return y.puntajes[k] - x.puntajes[k]; })[0]; });
    prioridades.forEach(function (k) { if (reco && ganadores[k].clave !== reco.clave && ganadores[k].puntajes[k] - reco.puntajes[k] >= 8) conflicto.push({ criterio: k, gana: ganadores[k] }); });

    var faltan = ['La conductividad real del agua de tu pozo (el deslizador de arriba es tu dato, no una medición nuestra).', 'Un análisis de suelo: sal, sodio y boro.',
                  'Precios, costos y mercado de cada cultivo: no tenemos esos datos de La Yarada, así que esta comparación no los incluye.'];
    // por que gana: diferencia ponderada frente al siguiente camino que compite
    var porque = null;
    if (reco) {
      var rival = lista.filter(function (e) { return e.recomendable && e.clave !== reco.clave; }).sort(function (x, y) { return y.total - x.total; })[0];
      if (rival) {
        var w = 0; prioridades.forEach(function (k) { w += peso[k]; });
        porque = { rival: rival, partes: prioridades.map(function (k) { return { criterio: k, dif: peso[k] * (Math.round(reco.puntajes[k]) - Math.round(rival.puntajes[k])) / w }; }) };
      }
    }
    var sinSalida = prioridades.length > 0 && !reco;
    return { estrategias: lista, recomendada: reco, motivo: motivo, conflicto: conflicto, faltan: faltan, peso: peso, actual: actual, sinSalida: sinSalida, porque: porque, prioridades: prioridades };
  }

  // ------------------------------------------------------------------ pagina
  var V = { caja: null, cultivos: [], porId: {}, est: null, prioridades: [], parcela: null };

  function guardar() { try { localStorage.setItem('hanaq_plan', JSON.stringify({ p: V.prioridades })); } catch (e) { /* sin almacenamiento: sigue en memoria */ } }
  function cargar() {
    try { var g = JSON.parse(localStorage.getItem('hanaq_plan') || 'null'); if (g) V.prioridades = (g.p || []).filter(function (k) { return CRITERIOS[k]; }); } catch (e) { /* nada guardado */ }
  }

  function iniciar(caja, cultivos, porId) {
    V.caja = caja; V.cultivos = cultivos; V.porId = porId; cargar();
    caja.innerHTML =
      '<h2>¿Qué me conviene? Compara tres caminos para tu parcela</h2>' +
      '<p class="nota">Usa el cultivo, la sal del agua y el riego que pusiste arriba. Cambia cualquiera y la comparación se actualiza.</p>' +
      '<h3><span class="paso">1</span> ¿Qué es lo más importante para ti?</h3>' +
      '<p class="nota">Toca una o varias, <b>en orden de importancia</b>. Toca otra vez para quitarla. Puedes cambiarlas cuando quieras.</p>' +
      '<div class="prioridades" id="p-prioridades"></div>' +
      '<h3><span class="paso">2</span> Tres caminos, comparados</h3><div id="p-tabla"></div>' +
      '<h3><span class="paso">3</span> Recomendación para ti</h3><div id="p-reco"></div>';
    caja.querySelector('#p-prioridades').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-k]'); if (!b) return;
      var k = b.dataset.k, i = V.prioridades.indexOf(k);
      if (i >= 0) V.prioridades.splice(i, 1); else V.prioridades.push(k);
      guardar(); pintar();
    });
    pintar();
  }

  function actualizar(est, parcela) { V.est = est; if (parcela !== undefined) V.parcela = parcela; if (V.caja) resultados(); }

  function pintar() {
    V.caja.querySelector('#p-prioridades').innerHTML = Object.keys(CRITERIOS).map(function (k) {
      var i = V.prioridades.indexOf(k);
      return '<button type="button" data-k="' + k + '" class="prioridad' + (i >= 0 ? ' activa' : '') + '" aria-pressed="' + (i >= 0) + '">' +
        '<span class="orden">' + (i >= 0 ? (i + 1) + '.ª' : '+') + '</span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONO[k] + '</svg><b>' + CRITERIOS[k].nombre + '</b><small>' + CRITERIOS[k].ayuda + '</small></button>';
    }).join('');
    resultados();
  }

  function barra(v, fuerte) { return '<div class="barra' + (fuerte ? '' : ' tenue') + '"><i style="width:' + Math.round(limitar(v, 0, 100)) + '%"></i></div>'; }
  function motivoNoCompite(e) { return e.soloReferencia ? 'habría que arrancar un cultivo permanente que todavía rinde' : minus((e.avisos[0] || 'no es compatible con esta parcela').replace(/\.$/, '')); }

  function celda(k, e, R) {
    var p = Math.round(e.puntajes[k]), fuerte = R.peso[k] != null;
    var valor = k === 'agua' ? num(e.agua) + ' m³/ha <small>' + e.unidad + '</small>' : k === 'suelo' ? e.suelo.etiqueta : 'Índice ' + Math.round(e.indice);
    return '<td class="' + (R.recomendada && R.recomendada.clave === e.clave ? 'elegida' : '') + '"><b>' + valor + '</b>' + barra(p, fuerte) + '<small class="pts">' + p + ' puntos</small></td>';
  }

  /* Explica el puntaje con las cuentas a la vista */
  function explicacion(R, L) {
    var pr = R.prioridades, w = 0; pr.forEach(function (k) { w += R.peso[k]; });
    var h = '<div class="cuentas"><h4>Cómo se calcula el puntaje</h4><ol>' +
      '<li><b>Cada prioridad da de 0 a 100 puntos a cada camino.</b><ul>' + pr.map(function (k) { return '<li><b>' + CRITERIOS[k].corto + ':</b> ' + CRITERIOS[k].como + '</li>'; }).join('') + '</ul></li>' +
      '<li><b>Tu orden decide cuánto pesa cada una:</b> ' + pr.map(function (k, i) { return 'la ' + (i + 1) + '.ª (' + CRITERIOS[k].corto.toLowerCase() + ') vale por ' + R.peso[k]; }).join(', ') + '.</li>' +
      '<li><b>El puntaje es el promedio con esos pesos:</b><ul>' + L.map(function (e) {
        var suma = 0; pr.forEach(function (k) { suma += R.peso[k] * Math.round(e.puntajes[k]); });
        return '<li>' + e.titulo + ': ' + (pr.length > 1
          ? pr.map(function (k) { return Math.round(e.puntajes[k]) + ' × ' + R.peso[k]; }).join(' + ') + ' = ' + suma + '; entre ' + w + ' = <b>' + Math.round(e.total) + '</b>'
          : Math.round(e.puntajes[pr[0]]) + ' puntos de ' + CRITERIOS[pr[0]].corto.toLowerCase() + ' = <b>' + Math.round(e.total) + '</b>') +
          (e.recomendable ? '' : ' <em>No compite: ' + motivoNoCompite(e) + '.</em>') + '</li>';
      }).join('') + '</ul></li>' +
      '<li><b>Gana el camino con más puntos entre los que compiten.</b> Un camino no compite si el cultivo rinde menos de ' + MINIMO_VIABLE +
      ', si obliga a arrancar un cultivo permanente que todavía rinde, o si el cultivo nuevo no llega a ' + MINIMO_COMPATIBLE + ' con esta sal. Cambiar de cultivo solo gana si saca al menos ' + MARGEN_CAMBIO + ' puntos de ventaja.</li></ol>';
    if (R.recomendada && R.porque) {
      var a = R.porque.partes.filter(function (x) { return x.dif >= 0.5; }), c = R.porque.partes.filter(function (x) { return x.dif <= -0.5; });
      var frase = function (v) { return v.map(function (x) { return CRITERIOS[x.criterio].corto.toLowerCase() + ' (' + (x.dif > 0 ? '+' : '−') + num(Math.abs(x.dif)) + ')'; }).join(' y '); };
      h += '<p><b>Por qué gana «' + R.recomendada.titulo + '»:</b> frente a «' + R.porque.rival.titulo + '», ' +
        (a.length ? 'suma más en ' + frase(a) : 'no suma más en ninguna prioridad') + (c.length ? ' y pierde en ' + frase(c) : '') +
        '. Diferencia final: ' + (Math.round(R.recomendada.total) - Math.round(R.porque.rival.total)) + ' puntos' + (R.motivo ? '. ' + R.motivo : '.') + '</p>';
    } else if (R.recomendada) h += '<p><b>Por qué gana «' + R.recomendada.titulo + '»:</b> es el único camino que compite con esta agua y este riego.</p>';
    return h + '<p class="nota">Los pesos, los puntos de suelo y los límites son reglas fijadas por el equipo para ordenar opciones; no salen de mediciones en La Yarada.</p></div>';
  }

  function resultados() {
    if (!V.est || !raiz.Sim) return;
    var R = evaluar(raiz.Sim, V.cultivos, V.porId, V.est, V.prioridades), L = R.estrategias, pr = R.prioridades;
    var filas = pr.concat(Object.keys(CRITERIOS).filter(function (k) { return pr.indexOf(k) < 0; }));
    var elegida = function (e) { return R.recomendada && R.recomendada.clave === e.clave; };
    var tabla = '<div class="rodar"><table class="caminos"><tr><th></th>' + L.map(function (e, i) {
      return '<th class="' + (elegida(e) ? 'elegida' : '') + '"><small>Camino ' + (i + 1) + (elegida(e) ? ' · recomendado' : '') +
        '</small>' + e.titulo + (e.recomendable ? '' : '<em>' + (e.soloReferencia ? 'Solo como referencia' : 'No recomendable') + '</em>') + '</th>';
    }).join('') + '</tr>' + filas.map(function (k) {
      var i = pr.indexOf(k);
      return '<tr class="' + (i >= 0 ? '' : 'apagada') + '"><td>' + (i >= 0 ? '<span class="orden">' + (i + 1) + '.ª</span> ' : '') + CRITERIOS[k].corto +
        '<small>' + (i >= 0 ? 'pesa ' + R.peso[k] : 'no la marcaste: no cuenta') + '</small></td>' + L.map(function (e) { return celda(k, e, R); }).join('') + '</tr>';
    }).join('') +
      (pr.length ? '<tr class="total"><td>Puntaje según tus prioridades<small>de 0 a 100</small></td>' + L.map(function (e) {
        return '<td class="' + (elegida(e) ? 'elegida' : '') + '">' + (e.recomendable ? '<b>' + Math.round(e.total) + '</b>' : '<b class="fuera">' + Math.round(e.total) + '</b><small>No compite: ' + motivoNoCompite(e) + '</small>') + '</td>'; }).join('') + '</tr>' : '') +
      '</table></div><p class="nota">Las barras muestran puntos: más larga es mejor en esa prioridad. Sal que se acumula en el suelo con esta agua y este riego: <b>' + num(L[0].ece, 1) +
      ' dS/m</b> en los tres caminos, porque depende del agua y no del cultivo. Los cultivos de campaña se comparan con una sola campaña al año; si siembras dos, su agua se duplica.</p>' +
      (pr.length ? explicacion(R, L) : '');
    V.caja.querySelector('#p-tabla').innerHTML = tabla;

    var caja = V.caja.querySelector('#p-reco');
    if (R.sinSalida) {
      caja.innerHTML = '<div class="reco sin"><span>Ningún camino funciona así</span><h3>Primero hay que bajar la sal</h3>' +
        '<p>Con agua de ' + num(V.est.ecw, 1) + ' dS/m y este riego, el suelo llega a ' + num(L[0].ece, 1) + ' dS/m y ninguno de los tres caminos rinde lo suficiente para recomendarlo. Cambiar de cultivo no lo resuelve.</p>' +
        '<h4>Qué hacer</h4><ul><li>Confirma con una medición la conductividad real de tu pozo.</li><li>Sube el deslizador de riego para ver cuánta agua extra haría falta para lavar las sales, y si tu pozo la puede dar.</li>' +
        '<li>Si hay otra fuente de agua menos salina, compárala bajando el deslizador de salinidad.</li></ul></div>'; return;
    }
    if (!R.recomendada) { caja.innerHTML = '<div class="vacio">Marca al menos una prioridad en el paso 1 y aquí verás qué camino te conviene y por qué.</div>'; return; }
    var e = R.recomendada, base = L[0], lista = function (v) { return '<ul>' + v.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; };
    var porque = pr.map(function (k, i) {
      var t = '<b>' + (i + 1) + '.ª ' + CRITERIOS[k].corto + ':</b> ';
      if (k === 'agua') {
        var dif = Math.round((e.agua - base.agua) / base.agua * 100);
        t += 'usa ' + num(e.agua) + ' m³/ha ' + e.unidad + (e.clave === 'actual' ? '.' : dif < 0 ? ', ' + Math.abs(dif) + ' % menos que seguir igual.' : dif > 0 ? ', ' + dif + ' % más que seguir igual.' : ', lo mismo que seguir igual.');
      } else if (k === 'suelo') t += minus(e.suelo.etiqueta) + ': ' + e.suelo.por.join('; ') + '.';
      else t += 'conserva ' + Math.round(Math.min(100, e.indice)) + ' de cada 100 de su rendimiento posible con esta sal y este riego.';
      return t;
    });
    var riesgos = e.avisos.slice();
    if (V.parcela && V.parcela.categoria !== 'bajo') riesgos.unshift('La parcela ' + V.parcela.id + ' aparece ' + V.parcela.estado + ' en el mapa: antes de invertir, mide la sal del agua y del suelo.');
    riesgos.push('Es una estimación con fórmulas publicadas, no un resultado garantizado ni calibrado con cosechas de La Yarada.');
    var choque = R.conflicto.map(function (c) {
      return 'Para <b>' + CRITERIOS[c.criterio].corto.toLowerCase() + '</b> sale mejor «' + c.gana.titulo + '», ' +
        (c.gana.recomendable ? 'pero pierde en el conjunto de tus prioridades.' : 'pero no compite: ' + motivoNoCompite(c.gana) + '.');
    });
    caja.innerHTML = '<div class="reco"><span>Te conviene</span><h3>' + e.titulo + '</h3><p>' + e.detalle + '.</p>' +
      '<h4>Cómo responde a tus prioridades</h4>' + lista(porque) +
      (choque.length ? '<h4>Donde tus prioridades chocan</h4>' + lista(choque) : '') +
      '<h4>Qué hacer</h4>' + lista(e.medidas) +
      '<h4>Riesgos y límites</h4>' + lista(riesgos) +
      '<h4>Qué dato te falta para decidir con más seguridad</h4>' + lista(R.faltan) + '</div>' +
      '<div class="otras"><b>Las otras dos opciones</b>' + lista(L.filter(function (x) { return x.clave !== e.clave; }).map(function (x) {
        return '«' + x.titulo + '»: ' + (x.recomendable ? Math.round(x.total) + ' puntos. ' + (x.avisos[0] || x.detalle + '.') : 'no compite, porque ' + motivoNoCompite(x) + '.');
      })) + '</div>';
  }

  var api = { iniciar: iniciar, actualizar: actualizar, evaluar: evaluar, CRITERIOS: CRITERIOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Plan = api;
})(typeof window !== 'undefined' ? window : globalThis);
