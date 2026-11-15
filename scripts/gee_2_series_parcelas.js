// =====================================================================
// HANAQ PACHA - Series por parcela (Landsat, Sentinel-2, MODIS NDVI y MODIS LST)
// 1) Pegar en https://code.earthengine.google.com y presionar Run
// 2) Clic en el mapa: imprime lat, lon y la curva de NDVI para ELEGIR las 2 parcelas
//    - curva casi plana todo el anio  -> olivo (permanente)
//    - curva con subidas y bajadas     -> cultivo de campana corta
// 3) Copiar las coordenadas elegidas AQUI (PARCELAS) y en datos/1_entrada/parcelas.csv
// 4) Run otra vez -> pestana Tasks -> RUN en las 3 tareas
// 5) Bajar los 3 CSV de Google Drive (carpeta HanaqPacha) a datos/2_crudos/
// 6) python scripts/descargar_datos.py satelite
// =====================================================================

// [nombre, longitud, latitud]  <- las mismas de datos/1_entrada/parcelas.csv
var PARCELAS = [
  ['P1_estable_olivo', -70.5125, -18.1988],   // verde: olivar estable desde 2001
  ['P2_nueva_campana', -70.4632, -18.2156],   // azul: desierto antes, cultivada hoy
  ['P3_abandonada',    -70.5451, -18.2300]    // rojo: cultivada hasta 2005, desnuda desde 2010
];
var RADIO_M = 30;   // se promedia un circulo de 30 m alrededor de cada punto (las chacras son chicas)

// Zona piloto: la misma del script de clasificacion (pampas de La Yarada)
var zona = ee.Geometry.Rectangle([-70.65, -18.32, -70.35, -18.08]);

var parcelas = ee.FeatureCollection(PARCELAS.map(function (p) {
  return ee.Feature(ee.Geometry.Point([p[1], p[2]]).buffer(RADIO_M), {parcela: p[0]});
}));

// ---------- Landsat 5/7/8/9 (NASA/USGS, 30 m, desde 2000) ----------
function landsat(id, nir, rojo, sensor) {
  return ee.ImageCollection(id).filterBounds(zona).map(function (img) {
    var qa = img.select('QA_PIXEL');
    var limpio = qa.bitwiseAnd(1 << 1).eq(0)      // nube dilatada
      .and(qa.bitwiseAnd(1 << 3).eq(0))           // nube
      .and(qa.bitwiseAnd(1 << 4).eq(0));          // sombra
    var sr = img.select([nir, rojo]).multiply(0.0000275).add(-0.2);
    return ee.Image(sr.normalizedDifference([nir, rojo]).rename('v').updateMask(limpio)
      .copyProperties(img, ['system:time_start'])).set('sensor', sensor);
  });
}

// ---------- Sentinel-2 (ESA, 10 m, desde 2017) ----------
var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED').filterBounds(zona).map(function (img) {
  var scl = img.select('SCL');
  var limpio = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10));
  return ee.Image(img.normalizedDifference(['B8', 'B4']).rename('v').updateMask(limpio)
    .copyProperties(img, ['system:time_start'])).set('sensor', 'S2');
});

var optico = landsat('LANDSAT/LT05/C02/T1_L2', 'SR_B4', 'SR_B3', 'L5')
  .merge(landsat('LANDSAT/LE07/C02/T1_L2', 'SR_B4', 'SR_B3', 'L7'))
  .merge(landsat('LANDSAT/LC08/C02/T1_L2', 'SR_B5', 'SR_B4', 'L8'))
  .merge(landsat('LANDSAT/LC09/C02/T1_L2', 'SR_B5', 'SR_B4', 'L9'))
  .merge(s2)
  .filterDate('2000-01-01', '2026-12-31');

// ---------- MODIS (NASA): NDVI 250 m cada 16 dias y temperatura superficial 1 km cada 8 dias ----------
var modisNdvi = ee.ImageCollection('MODIS/061/MOD13Q1').map(function (img) {
  var bueno = img.select('SummaryQA').lte(1);   // 0 = bueno, 1 = marginal; quita neblina y nubes
  return ee.Image(img.select('NDVI').multiply(0.0001).rename('v').updateMask(bueno)
    .copyProperties(img, ['system:time_start'])).set('sensor', 'MOD13Q1');
});
var modisLst = ee.ImageCollection('MODIS/061/MOD11A2').select('LST_Day_1km').map(function (img) {
  return ee.Image(img.multiply(0.02).subtract(273.15).rename('v')
    .copyProperties(img, ['system:time_start'])).set('sensor', 'MOD11A2');
});

// ---------- Tabla: una fila por imagen y parcela ----------
function tabla(col, escala) {
  return col.map(function (img) {
    return img.reduceRegions({collection: parcelas, reducer: ee.Reducer.mean(), scale: escala})
      .filter(ee.Filter.notNull(['mean']))
      .map(function (f) {
        return ee.Feature(null, {
          fecha: img.date().format('YYYY-MM-dd'),
          parcela: f.get('parcela'),
          sensor: img.get('sensor'),
          valor: f.get('mean')
        });
      });
  }).flatten();
}

function exportar(col, nombre) {
  Export.table.toDrive({
    collection: col, description: nombre, folder: 'HanaqPacha', fileFormat: 'CSV',
    selectors: ['fecha', 'parcela', 'sensor', 'valor']
  });
}
exportar(tabla(optico, 30), 'gee_ndvi_imagenes');     // Landsat + Sentinel-2
exportar(tabla(modisNdvi, 250), 'gee_modis_ndvi');    // MODIS NDVI
exportar(tabla(modisLst, 1000), 'gee_modis_lst');     // MODIS temperatura superficial (grados C)

// ---------- Mapa y ayuda para elegir parcelas ----------
Map.centerObject(zona, 12);
Map.setOptions('SATELLITE');
Map.addLayer(ee.Image().paint(zona, 0, 2), {palette: ['red']}, 'Zona piloto');
Map.addLayer(parcelas, {color: 'yellow'}, 'Parcelas');
Map.style().set('cursor', 'crosshair');
print('>>> Clic en el mapa: coordenadas y curva de NDVI para elegir parcela <<<');
Map.onClick(function (c) {
  var p = ee.Geometry.Point([c.lon, c.lat]);
  print('lat, lon -> ' + c.lat.toFixed(4) + ', ' + c.lon.toFixed(4));
  print(ui.Chart.image.series(s2.filterDate('2022-01-01', '2026-12-31'), p, ee.Reducer.mean(), 10)
    .setOptions({
      title: 'NDVI Sentinel-2 (10 m) en ' + c.lat.toFixed(4) + ', ' + c.lon.toFixed(4),
      vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 0.9}}, lineWidth: 1, pointSize: 2
    }));
});
