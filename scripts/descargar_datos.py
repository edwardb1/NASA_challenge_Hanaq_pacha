#!/usr/bin/env python3
"""
Hanaq Pacha - descarga y procesa la data nucleo.

Uso (desde la raiz del repo):
    pip install requests pandas numpy
    python scripts/descargar_datos.py              # hace todo
    python scripts/descargar_datos.py satelite     # solo un paso

Pasos: clima, agua, suelo, terreno, satelite

Carpetas (cada una tiene UN solo origen):
    datos/1_entrada/     lo que se escribe A MANO: parcelas.csv, cultivos.csv, rotaciones.csv
    datos/2_crudos/      lo DESCARGADO tal cual (NASA POWER, Earth Engine, MODIS). No se edita.
    datos/3_procesados/  lo que GENERA este script. Es lo que lee la app. No se edita a mano.
    datos/FUENTES.md     se regenera en cada corrida: que archivo sale de que fuente y de que punto.
"""
import sys, json, time, math
from pathlib import Path
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd
import requests

RAIZ = Path(__file__).resolve().parent.parent
ENT = RAIZ / "datos" / "1_entrada"
CRUDOS = RAIZ / "datos" / "2_crudos"
PROC = RAIZ / "datos" / "3_procesados"
for carpeta in (CRUDOS, PROC):
    carpeta.mkdir(parents=True, exist_ok=True)

INICIO_CLIMA = "20010101"
INICIO_LST_ORNL = "2015-01-01"   # por ORNL la temperatura superficial se baja desde 2015 para ahorrar tiempo
UMBRAL_DESNUDO = 0.15      # NDVI menor a esto = campo desnudo
UMBRAL_CALOR_LST = 40.0    # grados C de temperatura SUPERFICIAL (no del aire). Ajustar con agronomia.


def parcelas():
    df = pd.read_csv(ENT / "parcelas.csv")
    return df[["parcela", "lat", "lon"]].to_dict("records")


def get_json(url, params=None, intentos=4, espera=5):
    """GET con reintentos. Devuelve el JSON o lanza el ultimo error."""
    for i in range(intentos):
        try:
            r = requests.get(url, params=params, headers={"Accept": "application/json"}, timeout=120)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa
            if i == intentos - 1:
                raise
            print(f"   reintento {i + 1} ({str(e)[:60]}...)")
            time.sleep(espera * (i + 1))


# ----------------------------------------------------------------------------
# 1. CLIMA: NASA POWER + ET0 FAO-56 Penman-Monteith
# ----------------------------------------------------------------------------
def et0_fao56(tmax, tmin, hr, u2, rs, lat_grados, altitud, doy):
    """ET0 diaria (mm/dia), FAO-56 ec. 6. rs en MJ/m2/dia, u2 en m/s a 2 m, hr media en %."""
    tmed = (tmax + tmin) / 2.0
    e0 = lambda t: 0.6108 * np.exp(17.27 * t / (t + 237.3))
    es = (e0(tmax) + e0(tmin)) / 2.0
    ea = hr / 100.0 * es                                  # ec. 19 (solo HR media)
    delta = 4098 * e0(tmed) / (tmed + 237.3) ** 2
    p = 101.3 * ((293 - 0.0065 * altitud) / 293) ** 5.26
    gamma = 0.000665 * p
    phi = math.radians(lat_grados)                        # radiacion extraterrestre Ra (ec. 21)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    dec = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(-np.tan(phi) * np.tan(dec))
    ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    rso = (0.75 + 2e-5 * altitud) * ra
    rns = 0.77 * rs
    rel = np.clip(rs / rso, 0.25, 1.0)
    rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * np.sqrt(ea)) * (1.35 * rel - 0.35)
    rn = rns - rnl
    return (0.408 * delta * rn + gamma * 900 / (tmed + 273) * u2 * (es - ea)) / (delta + gamma * (1 + 0.34 * u2))


def paso_clima():
    print("== CLIMA (NASA POWER) ==")
    fin = (date.today() - timedelta(days=7)).strftime("%Y%m%d")
    todo = []
    for p in parcelas():
        print(f" {p['parcela']} ({p['lat']}, {p['lon']}) ...")
        js = get_json("https://power.larc.nasa.gov/api/temporal/daily/point", {
            "parameters": "T2M_MAX,T2M_MIN,RH2M,WS2M,ALLSKY_SFC_SW_DWN,PRECTOTCORR", "community": "AG",
            "longitude": p["lon"], "latitude": p["lat"], "start": INICIO_CLIMA, "end": fin, "format": "JSON"})
        (CRUDOS / f"power_{p['parcela']}.json").write_text(json.dumps(js))
        df = pd.DataFrame(js["properties"]["parameter"]).replace(-999, np.nan)
        df.index = pd.to_datetime(df.index, format="%Y%m%d")
        df = df.rename(columns={"T2M_MAX": "tmax_c", "T2M_MIN": "tmin_c", "RH2M": "hr_pct", "WS2M": "viento_ms",
                                "ALLSKY_SFC_SW_DWN": "rad_mj_m2", "PRECTOTCORR": "lluvia_mm"})
        alt = js["geometry"]["coordinates"][2]
        df["et0_mm"] = et0_fao56(df.tmax_c, df.tmin_c, df.hr_pct, df.viento_ms, df.rad_mj_m2,
                                 p["lat"], alt, df.index.dayofyear.values).round(2)
        df.insert(0, "parcela", p["parcela"])
        df.insert(0, "fecha", df.index.strftime("%Y-%m-%d"))
        todo.append(df)
    out = pd.concat(todo, ignore_index=True)
    out.to_csv(PROC / "clima_power.csv", index=False)
    print(f" -> clima_power.csv ({len(out)} filas). ET0 media: "
          + ", ".join(f"{k}={v:.2f} mm/dia" for k, v in out.groupby('parcela').et0_mm.mean().items()))


# ----------------------------------------------------------------------------
# 2. SATELITE: NDVI (Landsat, Sentinel-2, MODIS) y temperatura superficial (MODIS)
#    Fuente principal: los 3 CSV exportados con scripts/gee_2_series_parcelas.js
#    Respaldo solo para MODIS: servicio ORNL DAAC (sin cuenta, pero se cae seguido)
# ----------------------------------------------------------------------------
ORNL = "https://modis.ornl.gov/rst/api/v1"


def serie_ornl(producto, banda, lat, lon, etiqueta, desde="2000-01-01"):
    """Serie de un pixel. Guarda cada bloque en 2_crudos: si se corta (Ctrl+C), al volver a correr continua."""
    cache = CRUDOS / f"ornl_{producto}_{etiqueta}.json"
    datos = json.loads(cache.read_text()) if cache.exists() else {}
    fechas = get_json(f"{ORNL}/{producto}/dates", {"latitude": lat, "longitude": lon}, intentos=8, espera=10)["dates"]
    faltan = [f for f in fechas if f["calendar_date"] >= desde and f["calendar_date"] not in datos]
    fallidos = 0
    for i in range(0, len(faltan), 10):                    # el servicio acepta 10 fechas por pedido
        bloque = faltan[i:i + 10]
        try:
            js = get_json(f"{ORNL}/{producto}/subset", {
                "latitude": lat, "longitude": lon, "band": banda,
                "startDate": bloque[0]["modis_date"], "endDate": bloque[-1]["modis_date"],
                "kmAboveBelow": 0, "kmLeftRight": 0}, intentos=6, espera=10)
        except Exception:
            fallidos += 1                                  # se salta el bloque; se recupera en la siguiente corrida
            continue
        for x in js["subset"]:
            datos[x["calendar_date"]] = x["data"][0]
        cache.write_text(json.dumps(datos))
        print(f"   {producto} {etiqueta}: {min(i + 10, len(faltan))}/{len(faltan)} fechas", flush=True)
    if fallidos:
        print(f"   {producto} {etiqueta}: {fallidos} bloques no bajaron. Vuelve a correr 'satelite' para completarlos.")
    s = pd.Series(datos, dtype=float)
    s.index = pd.to_datetime(s.index)
    return s.sort_index()


def leer_gee(nombre):
    f = CRUDOS / nombre
    if not f.exists():
        return None
    d = pd.read_csv(f)
    d = d.rename(columns={"mean": "valor"}).dropna(subset=["valor"])
    return d[["fecha", "parcela", "sensor", "valor"]]


def quitar_picos(s, salto=0.10):
    """Quita caidas de UNA sola fecha que se recuperan en la siguiente: son neblina o nubes, no cosechas."""
    malo = (s < s.shift(1) - salto) & (s < s.shift(-1) - salto)
    return s.where(~malo)


def modis_desde_ornl(producto, banda, convertir, desde="2000-01-01"):
    from concurrent.futures import ThreadPoolExecutor
    ps = parcelas()
    with ThreadPoolExecutor(len(ps)) as ex:               # las parcelas bajan en paralelo
        series = list(ex.map(lambda p: serie_ornl(producto, banda, p["lat"], p["lon"], p["parcela"], desde), ps))
    partes = []
    for p, s in zip(ps, series):
        s = convertir(s).dropna()
        partes.append(pd.DataFrame({"fecha": s.index.strftime("%Y-%m-%d"), "parcela": p["parcela"],
                                    "sensor": producto, "valor": s.values}))
    return pd.concat(partes, ignore_index=True)


def paso_satelite():
    print("== SATELITE (NDVI y temperatura superficial) ==")
    # --- MODIS NDVI ---
    mod = leer_gee("gee_modis_ndvi.csv")
    origen = "Earth Engine"
    if mod is None:
        print(" Sin CSV de Earth Engine -> bajo MODIS NDVI del servicio ORNL (lento; si se corta, volver a correr y continua)")
        mod = modis_desde_ornl("MOD13Q1", "250m_16_days_NDVI", lambda s: quitar_picos(s.where(s > -2000) * 0.0001))
        origen = "ORNL DAAC"
    mod = mod.rename(columns={"valor": "ndvi"})
    mod["ndvi"] = mod.ndvi.round(4)
    mod[["fecha", "parcela", "ndvi"]].sort_values(["parcela", "fecha"]).to_csv(PROC / "ndvi_modis.csv", index=False)
    print(f" -> ndvi_modis.csv ({len(mod)} filas, via {origen})")

    # --- NDVI mensual: MODIS + Landsat + Sentinel-2 ---
    mod["fuente"] = "MODIS 250 m"
    partes = [mod[["fecha", "parcela", "ndvi", "fuente"]]]
    opt = leer_gee("gee_ndvi_imagenes.csv")
    if opt is not None:
        opt = opt.rename(columns={"valor": "ndvi"})
        opt["fuente"] = np.where(opt.sensor.astype(str).str.startswith("S2"), "Sentinel-2 10 m", "Landsat 30 m")
        partes.append(opt[["fecha", "parcela", "ndvi", "fuente"]])
    else:
        print(" (sin gee_ndvi_imagenes.csv: el mensual sale solo con MODIS)")
    d = pd.concat(partes, ignore_index=True)
    d["fecha"] = pd.to_datetime(d.fecha).dt.to_period("M").dt.to_timestamp().dt.strftime("%Y-%m-%d")
    m = d.groupby(["fecha", "parcela", "fuente"]).ndvi.agg(ndvi="mean", n_obs="count").reset_index()
    m["ndvi"] = m.ndvi.round(4)
    m["campo_desnudo"] = (m.ndvi < UMBRAL_DESNUDO).astype(int)
    m.to_csv(PROC / "ndvi_mensual.csv", index=False)
    print(f" -> ndvi_mensual.csv ({len(m)} filas; fuentes: {', '.join(sorted(m.fuente.unique()))})")

    # --- MODIS temperatura superficial ---
    lst = leer_gee("gee_modis_lst.csv")
    if lst is None:
        print(f" Sin CSV de Earth Engine -> bajo MODIS temperatura superficial de ORNL desde {INICIO_LST_ORNL[:4]}")
        lst = modis_desde_ornl("MOD11A2", "LST_Day_1km", lambda s: s.where(s > 0) * 0.02 - 273.15, INICIO_LST_ORNL)
    lst["mes"] = pd.to_datetime(lst.fecha).dt.to_period("M").dt.to_timestamp()
    t = lst.groupby(["mes", "parcela"]).valor.agg(
        lst_media_c="mean", lst_max_c="max", periodos_calor=lambda x: int((x > UMBRAL_CALOR_LST).sum())).reset_index()
    t.insert(0, "fecha", t.pop("mes").dt.strftime("%Y-%m-%d"))
    t.round(2).to_csv(PROC / "lst_mensual.csv", index=False)
    print(f" -> lst_mensual.csv ({len(t)} filas)")


# ----------------------------------------------------------------------------
# 3. SUELO (SoilGrids) y 4. TERRENO (SRTM)
# ----------------------------------------------------------------------------
def paso_suelo():
    print("== SUELO (SoilGrids 250 m) ==")
    filas = []
    for p in parcelas():
        try:
            js = get_json("https://rest.isric.org/soilgrids/v2.0/properties/query", [
                ("lon", p["lon"]), ("lat", p["lat"]), ("value", "mean"),
                *[("property", x) for x in ["clay", "sand", "silt", "soc", "phh2o"]],
                *[("depth", x) for x in ["0-5cm", "5-15cm", "15-30cm"]]])
        except Exception as e:
            print(f" {p['parcela']}: SoilGrids no respondio ({e}). Usar el visor soilgrids.org a mano.")
            continue
        (CRUDOS / f"soilgrids_{p['parcela']}.json").write_text(json.dumps(js))
        fila = {"parcela": p["parcela"]}
        espesor = {"0-5cm": 5, "5-15cm": 10, "15-30cm": 15}
        for capa in js["properties"]["layers"]:
            d = capa["unit_measure"]["d_factor"]
            vals = [(espesor[x["label"]], x["values"]["mean"]) for x in capa["depths"] if x["values"]["mean"] is not None]
            unidad = capa["unit_measure"]["target_units"]
            nombre = f"{capa['name']}_{unidad}".replace("/", "_").replace("%", "pct")
            fila[nombre] = round(sum(e * v for e, v in vals) / sum(e for e, _ in vals) / d, 2) if vals else None
        fila["confianza"] = "Estimado con modelo global 250 m; no reemplaza analisis de suelo"
        filas.append(fila)
    if filas:
        pd.DataFrame(filas).to_csv(PROC / "suelo.csv", index=False)
        vacios = sum(v is None for f in filas for v in f.values())
        print(" -> suelo.csv" + (f"  OJO: {vacios} valores vacios (SoilGrids no cubre bien el desierto): declararlo como limitacion" if vacios else ""))


def paso_terreno():
    print("== TERRENO (SRTM 30 m) ==")
    ps = parcelas()
    try:
        js = get_json("https://api.opentopodata.org/v1/srtm30m",
                      {"locations": "|".join(f"{p['lat']},{p['lon']}" for p in ps)})
        (CRUDOS / "srtm_opentopodata.json").write_text(json.dumps(js))
        for p, r in zip(ps, js["results"]):
            p["altitud_m"] = r["elevation"]
        pd.DataFrame(ps).to_csv(PROC / "terreno.csv", index=False)
        print(" -> terreno.csv")
    except Exception as e:
        print(f" No respondio opentopodata ({e}). Es dato secundario: seguir sin esto.")


# ----------------------------------------------------------------------------
# 5. AGUA POR ROTACION: ETc = Kc x ET0 (FAO-56, coeficiente unico)
# ----------------------------------------------------------------------------
def curva_kc(c):
    """Kc diario: inicial constante, desarrollo lineal, media constante, final lineal."""
    li, ld, lm, lf = int(c.dias_ini), int(c.dias_des), int(c.dias_med), int(c.dias_fin)
    return np.concatenate([np.full(li, c.kc_ini), np.linspace(c.kc_ini, c.kc_med, ld, endpoint=False),
                           np.full(lm, c.kc_med), np.linspace(c.kc_med, c.kc_fin, lf)])


def paso_agua():
    print("== AGUA POR ROTACION (FAO-56) ==")
    clima = pd.read_csv(PROC / "clima_power.csv", parse_dates=["fecha"])
    cult = pd.read_csv(ENT / "cultivos.csv").set_index("cultivo")
    rot = pd.read_csv(ENT / "rotaciones.csv", dtype={"fecha_siembra": str})
    clima["doy"] = clima.fecha.dt.dayofyear.clip(upper=365)
    et0_clim = clima.groupby(["parcela", "doy"]).et0_mm.mean()      # dia promedio 2001-hoy
    filas, resumen = [], []
    for (parc, estr), grupo in rot.groupby(["parcela", "estrategia"], sort=False):
        cubierto = np.zeros(365, bool)
        total = 0.0
        for r in grupo.itertuples():
            kc = curva_kc(cult.loc[r.cultivo])
            mes, dia = map(int, r.fecha_siembra.split("-"))
            d0 = date(2001, mes, dia).timetuple().tm_yday
            dias = (d0 - 1 + np.arange(len(kc))) % 365 + 1
            etc = float(np.nansum(kc * et0_clim.loc[parc].reindex(dias).values)) * r.fraccion_area
            if r.fraccion_area >= 0.5:
                cubierto[dias - 1] = True
            total += etc
            filas.append({"parcela": parc, "estrategia": estr, "cultivo": r.cultivo, "fecha_siembra": r.fecha_siembra,
                          "dias": len(kc), "fraccion_area": r.fraccion_area,
                          "etc_mm": round(etc, 1), "agua_m3_ha": round(etc * 10)})
        resumen.append({"parcela": parc, "estrategia": estr, "agua_m3_ha_anio": round(total * 10),
                        "meses_desnudos": round((~cubierto).sum() / 30.4, 1),
                        "confianza": "Estimado con modelo (NASA POWER + FAO-56); demanda neta, sin eficiencia de riego"})
    pd.DataFrame(filas).to_csv(PROC / "agua_rotaciones.csv", index=False)
    res = pd.DataFrame(resumen)
    res.to_csv(PROC / "resumen_estrategias.csv", index=False)
    print(res[["parcela", "estrategia", "agua_m3_ha_anio", "meses_desnudos"]].to_string(index=False))
    print(" -> agua_rotaciones.csv y resumen_estrategias.csv")


# ----------------------------------------------------------------------------
# FUENTES.md: de donde sale cada archivo (se regenera en cada corrida)
# ----------------------------------------------------------------------------
CATALOGO = [
    # (archivo, fuente, de que lugar exacto, confianza)
    ("clima_power.csv", "NASA POWER, API diaria (power.larc.nasa.gov), comunidad Agroclimatology, desde 2001",
     "Celda de la grilla (aprox. 50 km) que contiene el punto de cada parcela. Dos parcelas cercanas reciben el mismo clima.",
     "Estimado con modelo"),
    ("ndvi_modis.csv", "NASA MODIS MOD13Q1 v6.1, NDVI cada 16 dias, desde feb. 2000 (Earth Engine; respaldo ORNL DAAC)",
     "Pixel de 250 m que cae sobre el punto de cada parcela.", "Medido por satelite"),
    ("ndvi_mensual.csv", "MODIS MOD13Q1 + Landsat 5/7/8/9 C2 L2 (NASA/USGS, 30 m) + Sentinel-2 SR (ESA, 10 m), via Earth Engine",
     "Landsat y Sentinel-2: promedio de un circulo de 30 m de radio en cada parcela. MODIS: pixel de 250 m.",
     "Medido por satelite"),
    ("lst_mensual.csv", "NASA MODIS MOD11A2 v6.1, temperatura superficial de dia cada 8 dias (Earth Engine; respaldo ORNL DAAC)",
     "Pixel de 1 km sobre cada parcela. Es temperatura del SUELO/cubierta, no del aire.", "Medido por satelite"),
    ("suelo.csv", "SoilGrids 2.0 (ISRIC), API rest.isric.org: arcilla, arena, limo, carbono organico, pH, 0-30 cm",
     "Pixel de 250 m sobre el punto de cada parcela.", "Estimado con modelo"),
    ("terreno.csv", "NASA SRTM 30 m, via api.opentopodata.org", "Pixel de 30 m sobre el punto de cada parcela.",
     "Medido por satelite"),
    ("agua_rotaciones.csv", "Calculo propio: ETc = Kc x ET0 (FAO-56). ET0 de clima_power.csv; Kc de 1_entrada/cultivos.csv",
     "Por parcela y campana, con el dia promedio 2001-hoy.", "Estimado con modelo"),
    ("resumen_estrategias.csv", "Calculo propio a partir de agua_rotaciones.csv y 1_entrada/rotaciones.csv",
     "Por parcela y estrategia.", "Estimado con modelo"),
]


def escribir_fuentes():
    ps = pd.read_csv(ENT / "parcelas.csv")
    L = ["# Fuentes de datos - Hanaq Pacha", "",
         f"Generado automaticamente por `scripts/descargar_datos.py` el {datetime.now():%Y-%m-%d %H:%M}. No editar a mano.", "",
         "## Zona y parcelas", "",
         "- Zona piloto: pampas de La Yarada (Tacna), rectangulo lon -70.65 a -70.35, lat -18.32 a -18.08.",
         "- Toda la data se extrae en el punto (lat, lon) de cada parcela:", ""]
    L += [f"  - **{r.parcela}** ({r.tipo}; {r.clase_historia}): lat {r.lat}, lon {r.lon}" for r in ps.itertuples()]
    L += ["", "## Carpetas", "",
          "| Carpeta | Que contiene | Quien lo escribe |", "|---|---|---|",
          "| `datos/1_entrada/` | parcelas.csv, cultivos.csv, rotaciones.csv | El equipo, a mano |",
          "| `datos/2_crudos/` | Descargas tal cual: NASA POWER, SoilGrids, SRTM, CSV de Earth Engine | El script y Earth Engine |",
          "| `datos/3_procesados/` | CSV finales que lee la app | El script |", "",
          "## Archivos procesados", "",
          "| Archivo | Estado | Filas | Fuente | De que lugar | Confianza |", "|---|---|---|---|---|---|"]
    for archivo, fuente, lugar, conf in CATALOGO:
        f = PROC / archivo
        if f.exists():
            estado, filas = f"Listo ({datetime.fromtimestamp(f.stat().st_mtime):%d-%m %H:%M})", len(pd.read_csv(f))
        else:
            estado, filas = "FALTA", "-"
        L.append(f"| `{archivo}` | {estado} | {filas} | {fuente} | {lugar} | {conf} |")
    L += ["", "## Archivos de entrada (hechos a mano)", "",
          "- `cultivos.csv`: Kc y duracion de etapas de FAO-56 (tablas 11 y 12); salinidad de FAO-29 (tabla 4); boro de FAO-29 (tabla 16). Ver columna `estado_verificacion`.",
          "- `rotaciones.csv`: las 3 estrategias por parcela. Requiere revision local (agronomo).",
          "- `parcelas.csv`: puntos elegidos en Earth Engine.", ""]
    (RAIZ / "datos" / "FUENTES.md").write_text("\n".join(L), encoding="utf-8")
    print("\n== RESUMEN (detalle en datos/FUENTES.md) ==")
    for archivo, *_ in CATALOGO:
        print(f"  [{'OK' if (PROC / archivo).exists() else 'FALTA'}] {archivo}")


PASOS = {"clima": paso_clima, "agua": paso_agua, "suelo": paso_suelo, "terreno": paso_terreno, "satelite": paso_satelite}

if __name__ == "__main__":
    for nombre in (sys.argv[1:] or list(PASOS)):
        try:
            PASOS[nombre]()
        except KeyboardInterrupt:
            print("\n Cortado a mano. Lo ya descargado quedo guardado: vuelve a correr y continua desde ahi.")
            break
        except Exception as e:
            print(f"!! El paso '{nombre}' fallo: {str(e)[:200]}\n   Los demas pasos siguen. Para repetir solo este: "
                  f"python scripts/descargar_datos.py {nombre}")
    escribir_fuentes()
