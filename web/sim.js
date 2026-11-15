/* Hanaq Pacha - simulador de parcela. Funciones puras: no tocan la pagina.
   Fuentes: FAO-29 (sal y lavado), FAO-33 (riego), Moriana et al. 2003 (olivo), Zhao et al. 2022 (leguminosa previa). */
(function (raiz) {
  // FAO-29: factor que convierte la sal del agua de riego (ECw) en sal del suelo (ECe) segun la fraccion de lavado
  var FACTOR_LAVADO = [[0.05, 3.2], [0.10, 2.1], [0.15, 1.6], [0.20, 1.3], [0.25, 1.2], [0.30, 1.0],
                       [0.40, 0.9], [0.50, 0.8], [0.60, 0.7], [0.70, 0.6], [0.80, 0.6]];
  var LAVADO_MINIMO = 0.05;       // con riego igual o menor a lo que la planta consume casi no se lava sal
  var BONO_LEGUMINOSA = 0.20;     // promedio mundial; no medido en Tacna
  var FRACCION_COBERTURA = 0.30;  // parte del olivar ocupada por la planta acompaniante

  function interpolar(tabla, x) {
    if (x <= tabla[0][0]) return tabla[0][1];
    for (var i = 1; i < tabla.length; i++) {
      if (x <= tabla[i][0]) {
        var a = tabla[i - 1], b = tabla[i];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return tabla[tabla.length - 1][1];
  }

  function fraccionLavado(riego) {            // riego = agua aplicada / agua que el cultivo pide
    return riego > 1 ? Math.max(LAVADO_MINIMO, 1 - 1 / riego) : LAVADO_MINIMO;
  }

  function salDelSuelo(ecw, riego) {
    return ecw * interpolar(FACTOR_LAVADO, fraccionLavado(riego));
  }

  function rendimientoPorSal(cultivo, ece) {   // Maas y Hoffman
    return Math.max(0, Math.min(1, 1 - cultivo.sal_pendiente / 100 * (ece - cultivo.sal_umbral)));
  }

  function moriana(et) { return -16.84 + 0.063 * et - 0.035e-3 * et * et; }   // t/ha, olivo adulto

  function rendimientoPorRiego(cultivo, riego) {
    var r = Math.min(1, riego);                // regar de mas no sube el rendimiento
    if (cultivo.curva_riego === 'moriana_olivo') {
      return Math.max(0, moriana(900 * r) / moriana(900));
    }
    return Math.max(0, 1 - (cultivo.ky || 1) * (1 - r));
  }

  /* opciones: { ecw: dS/m del agua de riego, riego: 0.5 a 1.5, previo: id de cultivo o null,
                 cobertura: id de cultivo o null (solo perennes), cultivos: {id: cultivo} } */
  function simular(cultivo, o) {
    var ece = salDelSuelo(o.ecw, o.riego);
    var ySal = rendimientoPorSal(cultivo, ece);
    var yRiego = rendimientoPorRiego(cultivo, o.riego);
    var bono = 0, avisos = [];
    var previo = o.previo && o.cultivos ? o.cultivos[o.previo] : null;
    if (previo && previo.leguminosa && !cultivo.leguminosa && !cultivo.perenne) bono = BONO_LEGUMINOSA;
    var agua = cultivo.agua_m3_ha * o.riego;
    var cobertura = o.cobertura && cultivo.perenne && o.cultivos ? o.cultivos[o.cobertura] : null;
    var aguaCobertura = cobertura ? cobertura.agua_m3_ha * FRACCION_COBERTURA * Math.max(1, o.riego) : 0;
    var indice = 100 * ySal * yRiego * (1 + bono);

    if (o.riego < 0.5) avisos.push({ tipo: 'limite', texto: 'La formula de riego solo es valida hasta 50 % de deficit.' });
    if (ySal < 0.999) avisos.push({ tipo: 'sal', texto: 'La sal del suelo (' + ece.toFixed(1) + ' dS/m) supera lo que tolera ' + cultivo.nombre.toLowerCase() + ' (' + cultivo.sal_umbral + ' dS/m): pierde ' + Math.round((1 - ySal) * 100) + ' % por sal.' });
    if (o.riego <= 1 && o.ecw >= 1) avisos.push({ tipo: 'lavado', texto: 'Sin agua extra la sal no se lava y se concentra unas ' + interpolar(FACTOR_LAVADO, LAVADO_MINIMO).toFixed(1) + ' veces en el suelo.' });
    if (o.riego > 1) avisos.push({ tipo: 'agua', texto: 'El ' + Math.round(fraccionLavado(o.riego) * 100) + ' % del agua aplicada se va en lavar sales: cuida el cultivo, pero sale del acuifero.' });
    if (o.riego < 1 && yRiego < 0.999) avisos.push({ tipo: 'deficit', texto: 'Con ' + Math.round(o.riego * 100) + ' % del agua que pide, pierde ' + Math.round((1 - yRiego) * 100) + ' % por falta de riego.' });
    if (bono > 0) avisos.push({ tipo: 'rotacion', texto: 'Viene despues de una leguminosa (' + previo.nombre.toLowerCase() + '): +20 % en promedio mundial. No esta medido en Tacna.' });
    if (cobertura) avisos.push({ tipo: 'cobertura', texto: 'Cultivo de cobertura (' + cobertura.nombre.toLowerCase() + ' entre hileras): protege y mejora el suelo, pero pide ' + Math.round(aguaCobertura).toLocaleString('es-PE') + ' m3/ha mas de agua. No garantiza mas cosecha.' });

    return {
      ece: ece, lavado: fraccionLavado(o.riego), ySal: ySal, yRiego: yRiego, bono: bono,
      indice: indice, aguaCultivo: agua, aguaCobertura: aguaCobertura, aguaTotal: agua + aguaCobertura,
      porMilM3: indice / ((agua + aguaCobertura) / 1000), avisos: avisos
    };
  }

  /* Compara todos los cultivos con la misma agua y la misma sal: es la comparacion de rotaciones */
  function comparar(lista, o) {
    return lista.map(function (c) {
      var r = simular(c, { ecw: o.ecw, riego: o.riego, previo: o.previo, cobertura: null, cultivos: o.cultivos });
      return { id: c.id, nombre: c.nombre, indice: r.indice, agua: r.aguaTotal, porMilM3: r.porMilM3, ySal: r.ySal, leguminosa: c.leguminosa };
    }).sort(function (a, b) { return b.indice - a.indice; });
  }

  var api = { simular: simular, comparar: comparar, salDelSuelo: salDelSuelo, fraccionLavado: fraccionLavado,
              rendimientoPorSal: rendimientoPorSal, rendimientoPorRiego: rendimientoPorRiego };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
