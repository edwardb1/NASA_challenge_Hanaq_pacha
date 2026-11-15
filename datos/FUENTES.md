# Fuentes de datos - Hanaq Pacha

Generado automaticamente por `scripts/descargar_datos.py` el 2026-11-14 17:52. No editar a mano.

## Zona y parcelas

- Zona piloto: pampas de La Yarada (Tacna), rectangulo lon -70.65 a -70.35, lat -18.32 a -18.08.
- Toda la data se extrae en el punto (lat, lon) de cada parcela:

  - **P1_estable_olivo** (olivo (permanente); verde: estable desde 2001): lat -18.1988, lon -70.5125
  - **P2_nueva_campana** (campana corta; azul: desierto en 2001-2005 y cultivada hoy): lat -18.2156, lon -70.4632
  - **P3_abandonada** (sin cultivo hoy; rojo: cultivada antes y desnuda hoy): lat -18.23, lon -70.5451

## Carpetas

| Carpeta | Que contiene | Quien lo escribe |
|---|---|---|
| `datos/1_entrada/` | parcelas.csv, cultivos.csv, rotaciones.csv | El equipo, a mano |
| `datos/2_crudos/` | Descargas tal cual: NASA POWER, SoilGrids, SRTM, CSV de Earth Engine | El script y Earth Engine |
| `datos/3_procesados/` | CSV finales que lee la app | El script |

## Archivos procesados

| Archivo | Estado | Filas | Fuente | De que lugar | Confianza |
|---|---|---|---|---|---|
| `clima_power.csv` | Listo (14-11 16:14) | 28326 | NASA POWER, API diaria (power.larc.nasa.gov), comunidad Agroclimatology, desde 2001 | Celda de la grilla (aprox. 50 km) que contiene el punto de cada parcela. Dos parcelas cercanas reciben el mismo clima. | Estimado con modelo |
| `ndvi_modis.csv` | Listo (14-11 17:52) | 1326 | NASA MODIS MOD13Q1 v6.1, NDVI cada 16 dias, desde feb. 2000 (Earth Engine; respaldo ORNL DAAC) | Pixel de 250 m que cae sobre el punto de cada parcela. | Medido por satelite |
| `ndvi_mensual.csv` | Listo (14-11 17:52) | 1687 | MODIS MOD13Q1 + Landsat 5/7/8/9 C2 L2 (NASA/USGS, 30 m) + Sentinel-2 SR (ESA, 10 m), via Earth Engine | Landsat y Sentinel-2: promedio de un circulo de 30 m de radio en cada parcela. MODIS: pixel de 250 m. | Medido por satelite |
| `lst_mensual.csv` | Listo (14-11 17:52) | 631 | NASA MODIS MOD11A2 v6.1, temperatura superficial de dia cada 8 dias (Earth Engine; respaldo ORNL DAAC) | Pixel de 1 km sobre cada parcela. Es temperatura del SUELO/cubierta, no del aire. | Medido por satelite |
| `suelo.csv` | Listo (14-11 16:17) | 3 | SoilGrids 2.0 (ISRIC), API rest.isric.org: arcilla, arena, limo, carbono organico, pH, 0-30 cm | Pixel de 250 m sobre el punto de cada parcela. | Estimado con modelo |
| `terreno.csv` | Listo (14-11 16:17) | 3 | NASA SRTM 30 m, via api.opentopodata.org | Pixel de 30 m sobre el punto de cada parcela. | Medido por satelite |
| `agua_rotaciones.csv` | Listo (14-11 16:14) | 10 | Calculo propio: ETc = Kc x ET0 (FAO-56). ET0 de clima_power.csv; Kc de 1_entrada/cultivos.csv | Por parcela y campana, con el dia promedio 2001-hoy. | Estimado con modelo |
| `resumen_estrategias.csv` | Listo (14-11 16:14) | 6 | Calculo propio a partir de agua_rotaciones.csv y 1_entrada/rotaciones.csv | Por parcela y estrategia. | Estimado con modelo |

## Archivos de entrada (hechos a mano)

- `cultivos.csv`: Kc y duracion de etapas de FAO-56 (tablas 11 y 12); salinidad de FAO-29 (tabla 4); boro de FAO-29 (tabla 16). Ver columna `estado_verificacion`.
- `rotaciones.csv`: las 3 estrategias por parcela. Requiere revision local (agronomo).
- `parcelas.csv`: puntos elegidos en Earth Engine.
