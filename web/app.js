/* Hanaq Pacha - mapa de riesgo, ficha de parcela, simulador y pagina de datos. */
(function () {
  var COLOR = { alerta: '#C84630', bajo: '#4D7C2B', perdida: '#8C7A6B', transicion: '#D99B26' };      // paleta "Valle Organico Soleado"
  var NOMBRE = { alerta: 'En alerta', bajo: 'Riesgo bajo', perdida: 'Sin verdor (perdida)', transicion: 'En transición' };
  var E = { parcelas: [], modelo: null, cultivos: [], porId: {}, mapa: null, capa: null, overlay: null, grafico: null,
            ver: { alerta: true, bajo: true, perdida: true, transicion: true }, clase: 'todas', sel: null };
  var $ = function (id) { return document.getElementById(id); };
  var num = function (x, d) { return Number(x).toLocaleString('es-PE', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 }); };

  function categoria(p) {
    if (p.estado === 'en uso') return p.nivel === 'bajo' || !p.nivel ? 'bajo' : 'alerta';      // datos antiguos: medio y alto cuentan como alerta
    return p.estado === 'perdida' ? 'perdida' : 'transicion';
  }

  // ------------------------------------------------------------ carga
  function json(ruta) {
    return fetch(ruta).then(function (r) { if (!r.ok) throw new Error(ruta + ' (' + r.status + ')'); return r.json(); });
  }
  Promise.all([json('data/parcelas.json'), json('data/modelo.json'), json('data/cultivos.json'),
               json('data/temporadas.json').catch(function () { return null; })]).then(function (d) {
    E.parcelas = d[0]; E.modelo = d[1]; E.cultivos = d[2].cultivos; E.fuentes = d[2].fuentes; E.temporadas = d[3];
    E.cultivos.forEach(function (c) { E.porId[c.id] = c; });
    pestanas(); kpis(); filtros(); mapa(); panelInicial(); simulador(); datos(); estilo();
  }).catch(function (e) {
    var caja = $('error'); caja.style.display = 'block';
    caja.textContent = 'No se pudieron cargar los datos: ' + e.message + '. Abre la página desde un servidor (python -m http.server), no con doble clic.';
  });

  /* Solo aspecto: tipografia de los graficos y tramo relleno de los deslizadores */
  function estilo() {
    if (window.Chart && Chart.defaults) {
      Chart.defaults.font.family = "Inter, system-ui, sans-serif"; Chart.defaults.color = '#5C5749'; Chart.defaults.borderColor = '#EDE6D6';
    }
    var avance = function (el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%'); };
    document.querySelectorAll('input[type=range]').forEach(avance);
    document.addEventListener('input', function (ev) { if (ev.target && ev.target.type === 'range') avance(ev.target); });
  }

  function pestanas() {
    document.querySelectorAll('nav button').forEach(function (b) {
      b.addEventListener('click', function () { irA(b.dataset.tab); });
    });
  }
  function irA(tab) {
    document.querySelectorAll('nav button').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === tab); });
    document.querySelectorAll('main section').forEach(function (s) { s.classList.toggle('activo', s.id === 'tab-' + tab); });
    if (tab === 'mapa' && E.mapa) E.mapa.invalidateSize();
  }

  // ------------------------------------------------------------ indicadores
  function kpis() {
    var ha = E.modelo.hectareas_por_clase, hoy = E.modelo.hoy.hectareas_estimadas_por_nivel;
    var antes = ha.estable + ha['en declive'] + ha.abandonada, ahora = ha.estable + ha['en declive'] + ha.nueva;
    var items = [
      ['Área cultivada', num(antes) + ' → ' + num(ahora) + ' ha', 'De 2001–2005 a 2021–2025: creció ' + num(ahora / antes, 1) + ' veces sobre el mismo acuífero', 'k-bajo'],
      ['Abandonadas', num(ha.abandonada) + ' ha', 'Eran cultivo hace 20 años y hoy son suelo desnudo', 'k-perdida'],
      ['En declive', num(ha['en declive']) + ' ha', 'Siguen cultivadas, pero con bastante menos verdor que hace 20 años', 'k-aviso'],
      ['En alerta hoy', num((hoy.alerta || 0) + (hoy.alto || 0) + (hoy.medio || 0)) + ' ha', 'En uso, pero con verdor inestable: las que conviene revisar (estimado)', 'k-alerta']
    ];
    $('kpis').innerHTML = '<p class="kpi-titulo"><b>La Yarada vista por satélite.</b> Estas cifras son de todo el valle, no de una parcela. Para ver una parcela, tócala en el mapa.</p>' +
      items.map(function (i) { return '<div class="kpi ' + i[3] + '"><small>' + i[0] + '</small><b>' + i[1] + '</b><span>' + i[2] + '</span></div>'; }).join('');
  }

  // ------------------------------------------------------------ mapa
  function filtros() {
    var html = Object.keys(NOMBRE).map(function (k) {
      var n = E.parcelas.filter(function (p) { return categoria(p) === k; }).length;
      return '<label><input type="checkbox" data-cat="' + k + '" checked><span class="punto" style="background:' + COLOR[k] + '"></span>' + NOMBRE[k] + ' (' + n + ')</label>';
    }).join('');
    html += '<label>Clase <select id="f-clase" style="width:auto"><option value="todas">Todas</option><option>estable</option><option>en declive</option><option>abandonada</option><option>nueva</option></select></label>';
    html += '<label><input type="checkbox" id="f-capa" checked>Clasificación de fondo</label>';
    html += '<label>Intensidad <input type="range" id="f-opacidad" min="0" max="100" value="80" style="width:110px;--p:80%" aria-label="Intensidad de la clasificación de fondo"></label>';
    $('filtros').innerHTML = html;
    $('filtros').addEventListener('change', function (ev) {
      var t = ev.target;
      if (t.dataset.cat) E.ver[t.dataset.cat] = t.checked;
      if (t.id === 'f-clase') E.clase = t.value;
      if (t.id === 'f-capa' && E.overlay) { if (t.checked) E.overlay.addTo(E.mapa); else E.mapa.removeLayer(E.overlay); }
      pintar();
    });
    $('filtros').addEventListener('input', function (ev) {
      if (ev.target.id === 'f-opacidad' && E.overlay && E.overlay.setOpacity) E.overlay.setOpacity(ev.target.value / 100);
    });
  }

  function mapa() {
    var z = E.modelo.zona, lim = [[z.sur, z.oeste], [z.norte, z.este]];
    E.mapa = L.map('mapa', { preferCanvas: true }).fitBounds(lim);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { maxZoom: 18, attribution: 'Imagen: Esri, Maxar, Earthstar Geographics · Datos: NASA/USGS Landsat' }).addTo(E.mapa);
    E.overlay = L.imageOverlay('data/clasificacion.png', lim, { opacity: 0.8 }).addTo(E.mapa);
    E.capa = L.layerGroup().addTo(E.mapa);
    pintar();
  }

  function pintar() {
    E.capa.clearLayers();
    var orden = { bajo: 0, transicion: 1, perdida: 2, alerta: 3 };      // las parcelas en alerta se dibujan encima
    E.parcelas.filter(function (p) {
      return E.ver[categoria(p)] && (E.clase === 'todas' || p.clase === E.clase);
    }).sort(function (a, b) { return orden[categoria(a)] - orden[categoria(b)]; }).forEach(function (p) {
      var c = categoria(p), fuerte = c === 'alerta';
      L.circleMarker([p.lat, p.lon], { radius: fuerte ? 6 : 3.5, color: '#ffffff', weight: fuerte ? 1.2 : 0.7, fillColor: COLOR[c], fillOpacity: 0.95 })
        .on('click', function () { seleccionar(p); }).addTo(E.capa);
    });
  }

  // ------------------------------------------------------------ panel inicial
  function rango(x) {
    return x.rango_min != null && x.rango_max != null && num(x.rango_min) !== num(x.rango_max) ? ' (entre ' + num(x.rango_min) + ' y ' + num(x.rango_max) + ')' : '';
  }

  function panelInicial() {
    var h = E.modelo.hoy.parcelas_por_nivel, n = E.modelo.niveles;
    $('panel').innerHTML = '<h2>Elige una parcela en el mapa</h2>' +
      '<p>Verás su historia desde 2000 y, si hoy está en uso, qué tan probable es que quede sin verdor en los próximos ' + E.modelo.definiciones.horizonte_anios + ' años.</p>' +
      '<h3>Qué significa cada nivel</h3><table><tr><th>Nivel</th><th class="num">Parcelas hoy</th><th class="num">De cada 100, se perdieron</th></tr>' +
      n.slice().reverse().map(function (x) {
        var k = x.nivel === 'bajo' ? 'bajo' : 'alerta';
        return '<tr><td><span class="punto" style="background:' + COLOR[k] + '"></span> ' + NOMBRE[k] + '</td><td class="num">' + (h[x.nivel] || 0) +
          '</td><td class="num">' + (x.se_perdieron_de_cada_100 == null ? '–' : num(x.se_perdieron_de_cada_100) + rango(x)) + '</td></tr>';
      }).join('') + '</table>' +
      '<p class="nota">La última columna se midió en terreno que el modelo no vio al entrenar' +
      (n[0] && n[0].repeticiones ? ', repitiendo la prueba con ' + n[0].repeticiones + ' particiones distintas del valle' : '') + '. Es riesgo, no destino: ' +
      (E.modelo.recuperacion ? num(E.modelo.recuperacion.volvieron_a_estar_en_uso_pct) + ' % de las parcelas que quedaron sin verdor volvió a cultivarse.' : '') + '</p>';
  }

  // ------------------------------------------------------------ diagnostico en palabras
  function media(v) { var s = 0, n = 0; v.forEach(function (x) { if (x != null && !isNaN(x)) { s += x; n++; } }); return n ? s / n : null; }
  function mediana(v) { var o = v.slice().sort(function (a, b) { return a - b; }), m = Math.floor(o.length / 2); return o.length ? (o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2) : null; }

  /* Lo que el satelite vio en esta parcela: su mejor nivel, el de hoy y el cambio reciente */
  function lectura(p) {
    var a = E.modelo.anios, v = p.ndvi, mejor = -1, anioMejor = null, n = v.length;
    v.forEach(function (x, i) { if (x != null && x > mejor) { mejor = x; anioMejor = a[i]; } });
    var hoy = media(v.slice(n - 3)), antes = media(v.slice(n - 8, n - 3)), cambio = hoy != null && antes ? (hoy - antes) / antes : 0;
    return { mejor: mejor, anioMejor: anioMejor, hoy: hoy, cambio: cambio, baja: cambio <= -0.10, sube: cambio >= 0.10, frente: p.frente_a_su_maximo };
  }

  /* Titulo, descripcion y medidas. El satelite muestra el cambio, no la causa: las medidas son revisiones, no recetas. */
  function diagnostico(p, c, L) {
    var pct = Math.round(L.frente * 100), cambioPct = Math.abs(Math.round(L.cambio * 100));
    var reciente = L.baja ? 'En los últimos tres años su verdor <b>bajó ' + cambioPct + ' %</b> frente a los cinco anteriores.'
      : L.sube ? 'En los últimos tres años su verdor <b>subió ' + cambioPct + ' %</b> frente a los cinco anteriores.'
      : 'En los últimos tres años su verdor se mantuvo parecido al de los cinco anteriores.';
    var historia = 'Su mejor nivel fue en ' + L.anioMejor + ' (NDVI ' + num(L.mejor, 2) + ') y hoy está al <b>' + pct + ' %</b> de ese nivel. ';
    if (E.medianaPerdidas == null) {
      E.medianaPerdidas = mediana(E.parcelas.filter(function (q) { return q.estado === 'perdida' && q.dist_mar_km != null; }).map(function (q) { return q.dist_mar_km; }));
    }
    var costa = p.dist_mar_km != null && p.dist_mar_km <= 1.5
      ? ' Está a ' + num(p.dist_mar_km, 1) + ' km del mar' + (E.medianaPerdidas != null ? ': en esta muestra, la mitad de las parcelas perdidas está a menos de ' +
        num(E.medianaPerdidas, 1) + ' km de la costa' : '') + ', y hay estudios que documentan entrada de agua de mar en el acuífero. Medir la sal es lo primero.' : '';
    var revisar = 'En campo: mide la sal (conductividad) del agua del pozo y del suelo, comprueba que el riego llegue parejo y busca plantas secas o costra blanca.';
    var rec = E.modelo.recuperacion ? ' No es un caso cerrado: ' + num(E.modelo.recuperacion.volvieron_a_estar_en_uso_pct) + ' % de las parcelas que quedaron sin verdor volvió a cultivarse.' : '';
    if (c === 'perdida') return { animo: 'triste', titulo: 'quedó sin verdor',
      texto: 'Dejó de estar verde hacia <b>' + p.anio_perdida + '</b> y sigue desnuda. Su mejor nivel fue en ' + L.anioMejor + ' (NDVI ' + num(L.mejor, 2) + ').',
      medidas: 'El satélite ya no ve cultivo aquí, pero no dice por qué. Si quieres recuperarla, empieza por medir la sal del suelo y del agua del pozo.' + rec + costa };
    if (p.estado === 'recien cultivada') return { animo: 'feliz', titulo: 'es recién cultivada',
      texto: 'Empezó a verse verde hace poco. ' + reciente,
      medidas: 'Todavía no tiene historia suficiente para estimar su riesgo. Vuelve a consultarla después de la próxima campaña.' };
    if (c === 'transicion') return { animo: 'preocupado', titulo: L.baja ? 'está perdiendo verdor' : 'tiene poco verdor',
      texto: historia + reciente + ' Hoy está por debajo del nivel de una parcela en uso, sin llegar a tres años seguidos desnuda.',
      medidas: '<b>Sí, conviene revisarla ya.</b> ' + revisar + ' Si la baja fue decisión tuya (descanso, poda fuerte o cambio de cultivo), no es una alarma.' + costa };
    if (c === 'alerta') return { animo: 'preocupado', titulo: 'está en alerta',
      texto: historia + reciente + ' Sigue en uso, pero su verdor se ha vuelto inestable.',
      medidas: '<b>Sí, conviene revisarla este año</b>, antes de que la baja avance. ' + revisar + costa };
    if (L.baja) return { animo: 'atento', titulo: 'sigue en uso, pero su verdor bajó',
      texto: historia + reciente,
      medidas: '<b>Sin urgencia, pero vigílala.</b> Si la baja sigue una campaña más, revisa el riego y mide la sal del agua del pozo.' };
    if (L.sube) return { animo: 'feliz', titulo: 'está en crecimiento', texto: historia + reciente,
      medidas: '<b>No hace falta tomar medidas.</b> Vuelve a mirarla después de cada campaña.' };
    return { animo: 'feliz', titulo: 'está estable', texto: historia + reciente,
      medidas: '<b>No hace falta tomar medidas por ahora.</b> Vuelve a mirarla después de cada campaña.' };
  }

  /* Granjero dibujado a mano (SVG propio): feliz, atento, preocupado o triste segun el estado de la parcela */
  function granjero(animo, c) {
    var fondo = { bajo: '#EBF3E4', transicion: '#FDF5E2', alerta: '#FBEAE7', perdida: '#F1ECE4' }[c];
    var cejas = { feliz: 'M43 57 Q49 53 55 56 M65 56 Q71 53 77 57', atento: 'M43 56 L55 56 M65 54 Q71 51 77 55',
                  preocupado: 'M43 58 L55 53 M65 53 L77 58', triste: 'M43 59 L55 54 M65 54 L77 59' }[animo];
    var boca = { feliz: 'M49 74 Q60 86 71 74', atento: 'M52 77 Q60 79 68 76', preocupado: 'M51 80 Q60 72 69 80', triste: 'M50 82 Q60 71 70 82' }[animo];
    var extra = animo === 'feliz' ? '<path d="M49 74 Q60 86 71 74 Z" fill="#fff"/><circle cx="44" cy="71" r="4.5" fill="#E79A7A" opacity=".55"/><circle cx="76" cy="71" r="4.5" fill="#E79A7A" opacity=".55"/>'
      : animo === 'preocupado' ? '<path d="M84 50 q5 8 0 12 q-5 -4 0 -12z" fill="#6DB3E0"/>'
      : animo === 'triste' ? '<path d="M47 68 q3 6 0 9 q-3 -3 0 -9z" fill="#6DB3E0"/>' : '';
    var ojosY = animo === 'triste' ? 65 : 64, inclinado = animo === 'triste' ? ' transform="rotate(-4 60 40)"' : '';
    return '<svg class="granjero g-' + animo + '" viewBox="0 0 120 124" role="img" aria-label="Granjero ' + animo + '">' +
      '<defs><clipPath id="recorte-granjero"><circle cx="60" cy="64" r="58"/></clipPath></defs>' +
      '<circle cx="60" cy="64" r="58" fill="' + fondo + '"/><g clip-path="url(#recorte-granjero)"><g class="cuerpo">' +
      '<path d="M16 126 Q18 98 60 96 Q102 98 104 126 Z" fill="#C84630"/>' +                                   // camisa
      '<path d="M30 126 L30 106 M90 126 L90 106 M44 126 L44 100 M76 126 L76 100" stroke="#A5351F" stroke-width="2.5" opacity=".55"/>' +
      '<path d="M40 126 L42 101 L50 99 L52 112 L68 112 L70 99 L78 101 L80 126 Z" fill="#2E4F2F"/>' +             // overol
      '<circle cx="48" cy="109" r="2.3" fill="#D99B26"/><circle cx="72" cy="109" r="2.3" fill="#D99B26"/>' +
      '<rect x="53" y="84" width="14" height="16" rx="5" fill="#D9A070"/>' +                                    // cuello
      '<circle cx="35" cy="66" r="6" fill="#D9A070"/><circle cx="85" cy="66" r="6" fill="#D9A070"/>' +
      '<circle cx="60" cy="65" r="25" fill="#E8B88A"/>' +                                                       // cara
      '<path d="M37 60 Q60 52 83 60 L83 50 L37 50 Z" fill="#D9A070" opacity=".35"/>' +                          // sombra del sombrero
      '<g' + inclinado + '><ellipse cx="60" cy="45" rx="44" ry="10" fill="#D99B26"/>' +                         // sombrero de paja
      '<path d="M37 45 Q38 16 60 15 Q82 16 83 45 Z" fill="#E7B24A"/><path d="M37.5 39 Q60 46 82.5 39 L83 45 Q60 52 37 45 Z" fill="#4D7C2B"/>' +
      '<path d="M44 30 Q60 24 76 30 M41 36 Q60 30 79 36" stroke="#D99B26" stroke-width="1.6" fill="none"/></g>' +
      '<circle cx="50" cy="' + ojosY + '" r="3.2" fill="#232B20"/><circle cx="70" cy="' + ojosY + '" r="3.2" fill="#232B20"/>' +
      '<circle cx="51" cy="' + (ojosY - 1) + '" r="1" fill="#fff"/><circle cx="71" cy="' + (ojosY - 1) + '" r="1" fill="#fff"/>' +
      '<path d="' + cejas + '" stroke="#5B3A22" stroke-width="2.6" stroke-linecap="round" fill="none"/>' + extra +
      '<path d="' + boca + '" stroke="#5B3A22" stroke-width="2.8" stroke-linecap="round" fill="none"/>' +
      '</g></g></svg>';
  }

  // ------------------------------------------------------------ ficha de parcela
  function seleccionar(p) {
    E.sel = p;
    var c = categoria(p), nv = E.modelo.niveles.filter(function (x) { return x.nivel === p.nivel; })[0];
    var L = lectura(p), D = diagnostico(p, c, L), plazo = E.modelo.definiciones.horizonte_anios;
    var riesgo = c === 'bajo' || c === 'alerta'
      ? (nv && nv.se_perdieron_de_cada_100 != null
        ? '<div class="riesgo"><span>Riesgo estimado a ' + plazo + ' años</span>De cada 100 parcelas con una trayectoria como esta, <b>' +
          (Math.round(nv.se_perdieron_de_cada_100) === 1 ? 'alrededor de 1</b> quedó' : 'unas ' + num(nv.se_perdieron_de_cada_100) + '</b> quedaron') + ' sin verdor' + rango(nv) + '. ' +
          (c === 'alerta' ? 'El modelo llega a ese nivel por la inestabilidad de su verdor, su nivel actual y su distancia al mar. ' : '') +
          'Es un nivel de riesgo, no un pronóstico de esta parcela.</div>'
        : '<div class="riesgo"><span>Riesgo estimado</span>Parcela en uso. Sin datos de validación para estimar su riesgo.</div>')
      : '';
    var tendencia = p.pendiente_5a > 0.005 ? 'Subiendo' : p.pendiente_5a < -0.005 ? 'Bajando' : 'Estable';
    $('panel').innerHTML =
      '<div class="diagnostico">' + granjero(D.animo, c) + '<div>' +
      '<span class="insignia i-' + c + '">' + NOMBRE[c] + '</span>' +
      '<h2 id="titulo-parcela">Parcela ' + p.id + ' ' + D.titulo + '</h2><p>' + D.texto + '</p></div></div>' +
      '<div class="medida m-' + c + '"><span>¿Hay que tomar medidas?</span>' + D.medidas + '</div>' + riesgo +
      '<div class="hechos">' +
      '<div><span>Distancia al mar</span>' + (p.dist_mar_km == null ? 'sin dato' : num(p.dist_mar_km, 1) + ' km') + '</div>' +
      '<div><span>Altitud</span>' + (p.altitud_m == null ? 'sin dato' : num(p.altitud_m) + ' m') + '</div>' +
      '<div><span>Verdor frente a su mejor nivel</span>' + num(p.frente_a_su_maximo * 100) + ' %</div>' +
      '<div><span>Tendencia de 5 años</span>' + tendencia + '</div></div>' +
      '<h3>Historial anual</h3>' +
      '<div style="position:relative;height:220px"><canvas id="historia" role="img" aria-label="Verdor anual de la parcela desde 2000"></canvas></div>' +
      '<p class="nota">Verdor más alto de cada año (NDVI, Landsat 30 m). Sobre la línea verde la parcela está en uso; bajo la gris, desnuda. Clase en el mapa: ' + p.clase + '.</p>' +
      '<h3>Historial por temporadas</h3>' + bloqueTemporadas(p) +
      '<button class="accion" id="a-sim">Probar esta parcela en el simulador</button>';
    $('a-sim').addEventListener('click', function () { simularParcela(p, c); });
    var u = E.modelo.definiciones, anios = E.modelo.anios;
    var plana = function (v) { return anios.map(function () { return v; }); };
    graficoTemporadas(p, c);
    if (E.grafico) E.grafico.destroy();
    E.grafico = new Chart($('historia'), {
      type: 'line',
      data: { labels: anios, datasets: [
        { label: 'Verdor (NDVI)', data: p.ndvi, borderColor: COLOR[c], backgroundColor: COLOR[c], borderWidth: 2, pointRadius: 2, tension: 0.2 },
        { label: 'En uso', data: plana(u.en_uso_ndvi_min), borderColor: '#4D7C2B', borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0 },
        { label: 'Desnudo', data: plana(u.desnudo_ndvi_max), borderColor: '#8C7A6B', borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { boxWidth: 14, font: { size: 11 } } } },
        scales: { y: { min: 0, max: 0.9, title: { display: true, text: 'NDVI' } }, x: { ticks: { maxTicksLimit: 9 }, grid: { display: false } } } }
    });
  }

  // ------------------------------------------------------------ historial por temporadas
  var COLOR_TEMP = ['#D99B26', '#4F86A6', '#4D7C2B'];      // ene-abr, may-ago, sep-dic

  function serieTemporadas(p) {
    return E.temporadas && E.temporadas.valores ? E.temporadas.valores[String(p.id)] : null;
  }

  function bloqueTemporadas(p) {
    var v = serieTemporadas(p);
    if (!v) return '<p class="nota">Todavía no se descargó el historial por temporadas (scripts/muestra_temporadas.py).</p>';
    var leyenda = E.temporadas.temporadas.map(function (t, i) {
      return '<span style="margin-right:12px"><span class="punto" style="background:' + COLOR_TEMP[i] + '"></span> ' + t + '</span>';
    }).join('');
    return '<div class="nota" style="margin-bottom:4px">' + leyenda + '</div>' +
      '<div style="position:relative;height:210px"><canvas id="temporadas" role="img" aria-label="Verdor de la parcela en cada temporada del año"></canvas></div>' +
      '<p class="nota">Verdor típico de cada temporada (mediana del NDVI, Landsat 30 m). Subidas y bajadas dentro del año indican siembras y cosechas; ' +
      'una línea pareja, cultivo permanente. Los tramos sin punto son temporadas sin imágenes limpias.</p>';
  }

  function graficoTemporadas(p, c) {
    if (E.grafico2) { E.grafico2.destroy(); E.grafico2 = null; }
    var v = serieTemporadas(p);
    if (!v || !$('temporadas')) return;
    var per = E.temporadas.periodos, u = E.modelo.definiciones;
    var plana = function (x) { return per.map(function () { return x; }); };
    E.grafico2 = new Chart($('temporadas'), {
      type: 'line',
      data: { labels: per.map(function (q) { return q.etiqueta; }), datasets: [
        { label: 'Verdor por temporada', data: v, borderColor: COLOR[c], borderWidth: 1.5, tension: 0.15, spanGaps: true, pointRadius: 2.5,
          pointBackgroundColor: per.map(function (q) { return COLOR_TEMP[q.t - 1]; }), pointBorderColor: per.map(function (q) { return COLOR_TEMP[q.t - 1]; }) },
        { label: 'En uso', data: plana(u.en_uso_ndvi_min), borderColor: '#4D7C2B', borderWidth: 1.2, borderDash: [5, 4], pointRadius: 0 },
        { label: 'Desnudo', data: plana(u.desnudo_ndvi_max), borderColor: '#8C7A6B', borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0 }
      ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 0.9, title: { display: true, text: 'NDVI' } },
                  x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0,
                       callback: function (valor, i) { var q = per[i]; return q && q.t === 1 && q.anio % 3 === 0 ? q.anio : ''; } } } } }
    });
  }

  // ------------------------------------------------------------ simulador
  function simulador() {
    $('s-cultivo').innerHTML = E.cultivos.map(function (c) { return '<option value="' + c.id + '">' + c.nombre + '</option>'; }).join('');
    $('s-cultivo').value = 'olivo';
    var legum = E.cultivos.filter(function (c) { return c.leguminosa; });
    $('s-previo').innerHTML = '<option value="">Ninguno (o el mismo cultivo)</option>' +
      E.cultivos.filter(function (c) { return !c.perenne; }).map(function (c) { return '<option value="' + c.id + '">' + c.nombre + (c.leguminosa ? ' (leguminosa)' : '') + '</option>'; }).join('');
    $('s-cobertura').innerHTML = '<option value="">Ninguno (suelo desnudo entre hileras)</option>' +
      legum.map(function (c) { return '<option value="' + c.id + '">' + c.nombre + ' (leguminosa)</option>'; }).join('');
    ['s-cultivo', 's-previo', 's-cobertura', 's-ecw', 's-riego'].forEach(function (id) { $(id).addEventListener('input', simular); });
    if (window.Plan && $('plan')) Plan.iniciar($('plan'), E.cultivos, E.porId);
    simular();
  }

  /* Llega desde la ficha de una parcela: el simulador vuelve a sus valores de partida y dice para que parcela es.
     El satelite no ve el cultivo ni la sal del agua, asi que esos datos los pone la persona. */
  function simularParcela(p, c) {
    E.simParcela = { id: p.id, categoria: c, estado: NOMBRE[c].toLowerCase() };
    var inicio = { 's-cultivo': 'olivo', 's-previo': '', 's-cobertura': '', 's-ecw': '2', 's-riego': '100' };
    Object.keys(inicio).forEach(function (id) { $(id).value = inicio[id]; $(id).dispatchEvent(new Event('input', { bubbles: true })); });
    var cerca = p.dist_mar_km != null && p.dist_mar_km <= 1.5;
    $('s-contexto').innerHTML = '<b>Parcela ' + p.id + '</b> · ' + NOMBRE[c].toLowerCase() + (p.dist_mar_km == null ? '' : ' · a ' + num(p.dist_mar_km, 1) + ' km del mar') +
      '<br>El satélite no ve qué cultivo hay ni cuánta sal trae el agua, así que el simulador empieza con valores de ejemplo. ' +
      'Elige tu cultivo y pon la conductividad del agua de tu pozo' + (cerca ? ': al estar tan cerca del mar, ese dato es el que más cambia el resultado.' : '.') +
      ' <button type="button" id="s-quitar">Quitar</button>';
    $('s-contexto').hidden = false;
    $('s-quitar').addEventListener('click', function () { $('s-contexto').hidden = true; E.simParcela = null; simular(); });
    irA('simulador'); window.scrollTo(0, 0);
  }

  function simular() {
    var c = E.porId[$('s-cultivo').value], ecw = parseFloat($('s-ecw').value), riego = parseInt($('s-riego').value, 10) / 100;
    $('c-previo').style.display = c.perenne ? 'none' : '';
    $('c-cobertura').style.display = c.id === 'olivo' ? '' : 'none';
    var o = { ecw: ecw, riego: riego, previo: c.perenne ? null : ($('s-previo').value || null),
              cobertura: c.id === 'olivo' ? ($('s-cobertura').value || null) : null, cultivos: E.porId };
    var r = Sim.simular(c, o);
    $('v-ecw').textContent = num(ecw, 1) + ' dS/m';
    $('v-riego').textContent = Math.round(riego * 100) + ' %';
    $('r-indice').textContent = Math.round(r.indice);
    $('r-indice').style.color = r.indice >= 80 ? '#4D7C2B' : r.indice >= 50 ? '#B07A12' : '#C84630';
    var barra = function (v) { return '<div class="barra"><i style="width:' + Math.round(v * 100) + '%"></i></div>'; };
    $('r-medidas').innerHTML =
      '<div><span>Rendimiento que deja la sal</span><b>' + Math.round(r.ySal * 100) + ' %</b>' + barra(r.ySal) + '</div>' +
      '<div><span>Rendimiento que deja el riego</span><b>' + Math.round(r.yRiego * 100) + ' %</b>' + barra(r.yRiego) + '</div>' +
      '<div><span>Sal en el suelo (en equilibrio)</span><b>' + num(r.ece, 1) + ' dS/m</b></div>' +
      '<div><span>Agua al año</span><b>' + num(r.aguaTotal) + ' m³/ha</b></div>';
    $('r-avisos').innerHTML = r.avisos.map(function (a) { return '<li>' + a.texto + '</li>'; }).join('') ||
      '<li>Sin estrés de sal ni de agua con estas condiciones.</li>';
    $('nota-cultivo').textContent = (c.id === 'olivo'
      ? 'Olivo: este simulador no incluye el frío de invierno. En NASA POWER, los inviernos 2023 y 2026 no tuvieron noches frías; tras el de 2023 se perdió la cosecha 2024. '
      : '') + 'Datos del cultivo: ' + c.verificacion + '.';
    var comp = Sim.comparar(E.cultivos, o);
    $('r-tabla').innerHTML = '<tr><th>Cultivo</th><th class="num">Índice</th><th class="num">Agua (m³/ha)</th><th class="num">Índice por 1000 m³</th></tr>' +
      comp.map(function (x) {
        return '<tr class="' + (x.id === c.id ? 'sel' : '') + '"><td>' + x.nombre + (x.leguminosa ? ' · leguminosa' : '') + '</td><td class="num">' + Math.round(x.indice) +
          '</td><td class="num">' + num(x.agua) + '</td><td class="num">' + num(x.porMilM3, 1) + '</td></tr>';
      }).join('');
    dibujar(c, r, o);
    if (window.Plan && $('plan')) Plan.actualizar({ cultivoId: c.id, ecw: ecw, riego: riego }, E.simParcela || null);
  }

  /* El dibujo lo hace granja.js: aqui solo se le pasa lo que calculo sim.js */
  function dibujar(c, r, o) {
    if (!window.Granja) return;
    Granja.actualizar($('campo'), { cultivo: c.id, vigor: r.indice / 100, ySal: r.ySal, yRiego: r.yRiego, riego: o.riego, ece: r.ece, cobertura: !!o.cobertura });
    $('campo').setAttribute('aria-label', 'Parcela de ' + c.nombre.toLowerCase() + ': índice de rendimiento ' + Math.round(r.indice) +
      ', sal en el suelo ' + num(r.ece, 1) + ' dS/m, riego al ' + Math.round(o.riego * 100) + ' % de lo que pide el cultivo.');
  }

  // ------------------------------------------------------------ datos y limites
  function datos() {
    var m = E.modelo, v = m.validacion.filter(function (x) { return x.auc != null; });
    var etiqueta = { logistica: 'Modelo (regresión logística)', boosting: 'Modelo alternativo (boosting)' };
    var html = '<h2>Qué tan bien predice</h2><p>' + m.pregunta + '.</p>' +
      '<table><tr><th>Prueba</th><th>Método</th><th class="num">AUC</th></tr>' + v.map(function (x) {
        return '<tr><td>' + x.validacion + '</td><td>' + (etiqueta[x.modelo] || x.modelo) + '</td><td class="num">' + num(x.auc, 2) + '</td></tr>';
      }).join('') + '</table><p class="nota">AUC: 0.5 es azar y 1 es perfecto. Las reglas simples sirven de referencia.</p>';
    if (m.anticipacion) html += '<h3>Anticipación</h3><p>De ' + m.anticipacion.parcelas_perdidas_evaluadas + ' parcelas que se perdieron, ' +
      num(m.anticipacion.con_alerta_previa_pct) + ' % estuvo en alerta antes de perderse, y ' +
      num(m.anticipacion.con_alerta_2_anios_antes_o_mas_pct) + ' % la tuvo con dos años o más de anticipación.</p>';
    html += '<h3>Qué mira el modelo</h3><table>' + m.variables.map(function (x) {
      return '<tr><td>' + x.etiqueta + '</td><td>' + x.sentido + '</td></tr>';
    }).join('') + '</table><p class="nota">Muestra: ' + num(m.muestra.parcelas) + ' parcelas y ' + num(m.muestra.filas_entrenamiento) +
      ' observaciones de parcela por año. Generado el ' + m.generado + '.</p>';
    $('d-modelo').innerHTML = html;
    var f = E.fuentes || {};
    $('d-fuentes').innerHTML = '<h2>Límites</h2><ul class="avisos">' + m.limites.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
      '<h3>De dónde sale cada cosa</h3><table>' +
      '<tr><td>Historia y riesgo</td><td>Landsat 5, 7, 8 y 9 (NASA/USGS), 2000–2026, vía Earth Engine</td></tr>' +
      '<tr><td>Distancia al mar y altitud</td><td>MODIS (máscara de agua) y SRTM (NASA)</td></tr>' +
      Object.keys(f).map(function (k) { return '<tr><td>Simulador: ' + k + '</td><td>' + f[k] + '</td></tr>'; }).join('') +
      '</table><p class="nota">El simulador estima con fórmulas publicadas; la salinidad, el boro y el estado real del suelo de una parcela requieren medición local.</p>';
  }
})();
