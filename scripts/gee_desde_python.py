#!/usr/bin/env python3
"""
Hanaq Pacha - Landsat, Sentinel-2 y MODIS SIN abrir la pagina de Earth Engine.

Lee las coordenadas de datos/1_entrada/parcelas.csv y deja en datos/2_crudos/ los mismos 3 CSV
que exportaria el script web:  gee_ndvi_imagenes.csv, gee_modis_ndvi.csv, gee_modis_lst.csv

Uso (una sola vez pide iniciar sesion con tu cuenta de Google en el navegador):
    pip install earthengine-api pandas
    python scripts/gee_desde_python.py ID_DE_TU_PROYECTO
    python scripts/descargar_datos.py satelite

ID_DE_TU_PROYECTO es el proyecto de Google Cloud que ya usas en Earth Engine
(sale arriba a la derecha en code.earthengine.google.com). Se guarda para la proxima vez.
"""
import sys, time
from pathlib import Path

import ee
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
ENT = RAIZ / "datos" / "1_entrada"
CRUDOS = RAIZ / "datos" / "2_crudos"
CRUDOS.mkdir(parents=True, exist_ok=True)
RADIO_M = 30
ANIO_FIN = 2026


def iniciar():
    f = ENT / "proyecto_gee.txt"
    if len(sys.argv) > 1:
        proyecto = sys.argv[1]
    elif f.exists():
        proyecto = f.read_text().strip()
    else:
        proyecto = input("ID de tu proyecto de Google Cloud con Earth Engine: ").strip()
    try:
        ee.Initialize(project=proyecto)
    except Exception:
        ee.Authenticate()            # abre el navegador una sola vez
        ee.Initialize(project=proyecto)
    f.write_text(proyecto)
    print(f"Conectado a Earth Engine (proyecto {proyecto})")


def cargar_parcelas():
    df = pd.read_csv(ENT / "parcelas.csv")
    return ee.FeatureCollection([
        ee.Feature(ee.Geometry.Point([float(r.lon), float(r.lat)]).buffer(RADIO_M), {"parcela": r.parcela})
        for r in df.itertuples()])


def landsat(col_id, nir, rojo, sensor, zona):
    def f(img):
        qa = img.select("QA_PIXEL")
        limpio = qa.bitwiseAnd(1 << 1).eq(0).And(qa.bitwiseAnd(1 << 3).eq(0)).And(qa.bitwiseAnd(1 << 4).eq(0))
        sr = img.select([nir, rojo]).multiply(0.0000275).add(-0.2)
        return ee.Image(sr.normalizedDifference([nir, rojo]).rename("v").updateMask(limpio)
                        .copyProperties(img, ["system:time_start"])).set("sensor", sensor)
    return ee.ImageCollection(col_id).filterBounds(zona).map(f)


def sentinel2(zona):
    def f(img):
        scl = img.select("SCL")
        limpio = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10))
        return ee.Image(img.normalizedDifference(["B8", "B4"]).rename("v").updateMask(limpio)
                        .copyProperties(img, ["system:time_start"])).set("sensor", "S2")
    return ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED").filterBounds(zona).map(f)


def modis_ndvi():
    def f(img):
        bueno = img.select("SummaryQA").lte(1)     # 0 bueno, 1 marginal
        return ee.Image(img.select("NDVI").multiply(0.0001).rename("v").updateMask(bueno)
                        .copyProperties(img, ["system:time_start"])).set("sensor", "MOD13Q1")
    return ee.ImageCollection("MODIS/061/MOD13Q1").map(f)


def modis_lst():
    def f(img):
        return ee.Image(img.select("LST_Day_1km").multiply(0.02).subtract(273.15).rename("v")
                        .copyProperties(img, ["system:time_start"])).set("sensor", "MOD11A2")
    return ee.ImageCollection("MODIS/061/MOD11A2").map(f)


def bajar(col, escala, parcelas, anio_ini, archivo):
    """Una fila por imagen y parcela. Se pide anio por anio para no pasar el limite de 5000 filas."""
    filas = []
    for anio in range(anio_ini, ANIO_FIN + 1):
        def por_imagen(img):
            fecha = img.date().format("YYYY-MM-dd")
            return (img.reduceRegions(collection=parcelas, reducer=ee.Reducer.mean(), scale=escala)
                    .filter(ee.Filter.notNull(["mean"]))
                    .map(lambda f: ee.Feature(None, {"fecha": fecha, "parcela": f.get("parcela"),
                                                     "sensor": img.get("sensor"), "valor": f.get("mean")})))
        fc = ee.FeatureCollection(col.filterDate(f"{anio}-01-01", f"{anio + 1}-01-01").map(por_imagen)).flatten()
        for intento in range(3):
            try:
                datos = fc.getInfo()["features"]
                break
            except Exception as e:
                if intento == 2:
                    raise
                print(f"   reintento {anio} ({str(e)[:60]})")
                time.sleep(10)
        filas += [d["properties"] for d in datos]
        print(f"   {archivo}: {anio} ({len(filas)} filas)", end="\r")
    print()
    df = pd.DataFrame(filas, columns=["fecha", "parcela", "sensor", "valor"]).sort_values(["parcela", "fecha"])
    df.to_csv(CRUDOS / archivo, index=False)
    print(f" -> datos/2_crudos/{archivo} ({len(df)} filas)")


if __name__ == "__main__":
    iniciar()
    parcelas = cargar_parcelas()
    zona = parcelas.geometry()
    pasos = [
        ("gee_modis_ndvi.csv", lambda: modis_ndvi(), 250, 2000),
        ("gee_modis_lst.csv", lambda: modis_lst(), 1000, 2000),
        ("gee_ndvi_imagenes.csv", lambda: landsat("LANDSAT/LT05/C02/T1_L2", "SR_B4", "SR_B3", "L5", zona)
            .merge(landsat("LANDSAT/LE07/C02/T1_L2", "SR_B4", "SR_B3", "L7", zona))
            .merge(landsat("LANDSAT/LC08/C02/T1_L2", "SR_B5", "SR_B4", "L8", zona))
            .merge(landsat("LANDSAT/LC09/C02/T1_L2", "SR_B5", "SR_B4", "L9", zona))
            .merge(sentinel2(zona)), 30, 2000),
    ]
    for archivo, crear, escala, anio_ini in pasos:
        try:
            bajar(crear(), escala, parcelas, anio_ini, archivo)
        except Exception as e:
            print(f"!! {archivo} fallo: {str(e)[:300]}")
    print("Listo. Ahora corre:  python scripts/descargar_datos.py satelite")
