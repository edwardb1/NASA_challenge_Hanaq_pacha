// =====================================================================
// HANAQ PACHA - NASA Space Apps 2026
// NDVI histórico y clasificación de parcelas en La Yarada (Tacna)
// Pegar en https://code.earthengine.google.com y presionar "Run"
// =====================================================================

// ---------------------------------------------------------------------
// 1. ZONA PILOTO
// Rectángulo aproximado de las pampas de La Yarada. Para ajustarlo,
// dibuja tu propio polígono con la herramienta de dibujo del mapa y
// reemplaza "zona" por tu geometría.
// ---------------------------------------------------------------------
var zona = ee.Geometry.Rectangle([-70.65, -18.32, -70.35, -18.08]);
Map.centerObject(zona, 11);
Map.setOptions('SATELLITE');
Map.addLayer(ee.Image().paint(zona, 0, 2), {palette: ['red']}, 'Zona piloto');

// ---------------------------------------------------------------------
// 2. MODIS NDVI (NASA) - cada 16 días, 250 m, desde febrero de 2000
// ---------------------------------------------------------------------
var modis = ee.ImageCollection('MODIS/061/MOD13Q1')
  .filterBounds(zona)
  .select('NDVI')
  .map(function (img) {
    return img.multiply(0.0001).rename('NDVI')
      .set('system:time_start', img.get('system:time_start'));
  });
print('Imágenes MODIS disponibles:', modis.size());
print('Última imagen MODIS:',
  ee.Date(modis.aggregate_max('system:time_start')).format('YYYY-MM-dd'));

// ---------------------------------------------------------------------
// 3. LANDSAT (NASA/USGS) - 30 m, suficiente para ver parcelas
// Collection 2, Level 2. Se quitan nubes y sombras con la banda QA_PIXEL.
// ---------------------------------------------------------------------
function mascaraNubes(img) {
  var qa = img.select('QA_PIXEL');
  return qa.bitwiseAnd(1 << 3).eq(0)      // nube
    .and(qa.bitwiseAnd(1 << 4).eq(0));    // sombra de nube
}

// Landsat 5 y 7: rojo = SR_B3, infrarrojo cercano = SR_B4
function ndviL57(img) {
  var sr = img.select(['SR_B4', 'SR_B3']).multiply(0.0000275).add(-0.2);
  return sr.normalizedDifference(['SR_B4', 'SR_B3']).rename('NDVI')
    .updateMask(mascaraNubes(img))
    .set('system:time_start', img.get('system:time_start'));
}

// Landsat 8 y 9: rojo = SR_B4, infrarrojo cercano = SR_B5
function ndviL89(img) {
  var sr = img.select(['SR_B5', 'SR_B4']).multiply(0.0000275).add(-0.2);
  return sr.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI')
    .updateMask(mascaraNubes(img))
    .set('system:time_start', img.get('system:time_start'));
}

var l5 = ee.ImageCollection('LANDSAT/LT05/C02/T1_L2').filterBounds(zona).map(ndviL57);
var l7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2').filterBounds(zona).map(ndviL57);
var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').filterBounds(zona).map(ndviL89);
var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2').filterBounds(zona).map(ndviL89);
var landsat = l5.merge(l7).merge(l8).merge(l9);
print('Imágenes Landsat disponibles:', landsat.size());

// ---------------------------------------------------------------------
// 4. NDVI ANUAL (percentil 90 de cada año = "lo más verde del año")
// Reduce el efecto de nubes y de meses sin cultivo.
// ---------------------------------------------------------------------
var anios = ee.List.sequence(2000, 2025);
var anual = ee.ImageCollection.fromImages(anios.map(function (y) {
  y = ee.Number(y);
  return landsat
    .filter(ee.Filter.calendarRange(y, y, 'year'))
    .reduce(ee.Reducer.percentile([90]))
    .rename('NDVI')
    .clip(zona)
    .set('year', y)
    .set('system:time_start', ee.Date.fromYMD(y, 7, 1).millis());
}));

// ---------------------------------------------------------------------
// 5. CLASIFICACIÓN SIMPLE DE PARCELAS
// "antes" = promedio 2001-2005; "ahora" = promedio 2021-2025.
// Los umbrales son un punto de partida: revísenlos mirando el mapa.
// ---------------------------------------------------------------------
var antes = anual.filter(ee.Filter.rangeContains('year', 2001, 2005)).mean();
var ahora = anual.filter(ee.Filter.rangeContains('year', 2021, 2025)).mean();
var cambio = ahora.subtract(antes);

var UMBRAL_VERDE = 0.20;    // por encima = hay vegetación/cultivo
var UMBRAL_DESIERTO = 0.12; // por debajo = suelo desnudo
var CAIDA = -0.08;          // pérdida de verdor que cuenta como declive

var clase = ee.Image(0)
  .where(antes.gt(UMBRAL_VERDE).and(cambio.gt(CAIDA)), 1)          // 1 estable
  .where(antes.gt(UMBRAL_VERDE).and(cambio.lte(CAIDA)), 2)         // 2 en declive
  .where(antes.gt(UMBRAL_VERDE).and(ahora.lt(UMBRAL_DESIERTO)), 3) // 3 abandonada
  .where(antes.lte(UMBRAL_VERDE).and(ahora.gt(UMBRAL_VERDE)), 4)   // 4 nueva
  .clip(zona)
  .selfMask()
  .rename('clase');

var visNdvi = {min: 0, max: 0.6, palette: ['d9c9a3', '9bd770', '1b7a2f']};
Map.addLayer(antes, visNdvi, 'NDVI 2001-2005', false);
Map.addLayer(ahora, visNdvi, 'NDVI 2021-2025', false);
Map.addLayer(clase,
  {min: 1, max: 4, palette: ['1a9641', 'fdae61', 'd7191c', '2b83ba']},
  'Clasificación');

print('LEYENDA - verde: estable | naranja: en declive | rojo: abandonada | azul: nueva');

// Área por clase en hectáreas
var areaHa = ee.Image.pixelArea().divide(10000).addBands(clase)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'clase'}),
    geometry: zona, scale: 30, maxPixels: 1e10
  });
print('Hectáreas por clase (1 estable, 2 declive, 3 abandonada, 4 nueva):', areaHa);

// ---------------------------------------------------------------------
// 6. HAZ CLIC EN CUALQUIER PARCELA PARA VER SU HISTORIA
// ---------------------------------------------------------------------
print('>>> Haz clic en el mapa para ver la historia de una parcela <<<');
Map.style().set('cursor', 'crosshair');
Map.onClick(function (c) {
  var p = ee.Geometry.Point([c.lon, c.lat]);
  var etiqueta = c.lat.toFixed(4) + ', ' + c.lon.toFixed(4);

  print(ui.Chart.image.series(anual, p, ee.Reducer.first(), 30)
    .setOptions({
      title: 'NDVI anual Landsat (30 m) - ' + etiqueta,
      vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 0.8}},
      lineWidth: 2, pointSize: 4
    }));

  print(ui.Chart.image.series(modis, p, ee.Reducer.mean(), 250)
    .setOptions({
      title: 'NDVI MODIS cada 16 días (250 m) - ' + etiqueta,
      vAxis: {title: 'NDVI', viewWindow: {min: 0, max: 0.8}},
      lineWidth: 1, pointSize: 0
    }));
});

// ---------------------------------------------------------------------
// 7. EXPORTAR A GOOGLE DRIVE (pestaña "Tasks" -> "Run")
// ---------------------------------------------------------------------
// a) Mapa de clasificación (GeoTIFF) para el mapa web
Export.image.toDrive({
  image: clase.toByte(),
  description: 'clasificacion_la_yarada',
  folder: 'HanaqPacha',
  region: zona, scale: 30, maxPixels: 1e10
});

// b) Tabla CSV: NDVI de cada año en puntos de muestra de cada clase
//    Columnas 0_NDVI = año 2000, 1_NDVI = 2001 ... 25_NDVI = 2025
var muestras = anual.toBands().addBands(clase).stratifiedSample({
  numPoints: 200, classBand: 'clase', region: zona,
  scale: 30, geometries: true, seed: 42
});
Export.table.toDrive({
  collection: muestras,
  description: 'ndvi_anual_muestras_la_yarada',
  folder: 'HanaqPacha',
  fileFormat: 'CSV'
});

// c) Serie MODIS promedio de las zonas cultivadas (para el LSTM)
var cultivado = clase.gt(0);
var serieModis = modis.map(function (img) {
  var v = img.updateMask(cultivado).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: zona, scale: 250, maxPixels: 1e10
  });
  return ee.Feature(null, {
    fecha: ee.Date(img.get('system:time_start')).format('YYYY-MM-dd'),
    ndvi: v.get('NDVI')
  });
});
Export.table.toDrive({
  collection: serieModis,
  description: 'serie_modis_ndvi_la_yarada',
  folder: 'HanaqPacha',
  fileFormat: 'CSV'
});