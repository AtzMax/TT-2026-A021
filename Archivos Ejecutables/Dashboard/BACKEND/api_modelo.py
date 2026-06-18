# Modelo de predicción AQI +1 hora


import pandas as pd
import numpy as np
import xgboost as xgb
from collections import deque
import json, os, urllib.request
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS

load_dotenv() #conectarme a la supabase

app = Flask(__name__)
CORS(app)

# ── CARGAR MODELO Y FEATURES ─────────────────────────────────
# Generados desde el notebook con:
#   modelo_xgb.save_model('modelo_aqi.json')
#   json.dump(FEATURES, open('features.json','w'))
#PASO AGREGADO PARA MV
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ruta_modelo = os.path.join(BASE_DIR, 'modelo_aqi.json')
ruta_features = os.path.join(BASE_DIR, 'features.json')

modelo_xgb = xgb.XGBRegressor()
#modelo_xgb.load_model('modelo_aqi.json')
modelo_xgb.load_model(ruta_modelo)

#with open('features.json') as f:
with open(ruta_features) as f:
    FEATURES = json.load(f)

#  CONSTANTES (igual que el notebook) 
FRECUENCIA_MINUTOS = 5
HORIZONTE_MINUTOS  = 60
PASOS_ADELANTE     = HORIZONTE_MINUTOS // FRECUENCIA_MINUTOS   # 12

#  CONFIGURACIÓN DEL PIPELINE 
# Copiado exactamente del Paso 9.5 — no cambiar nada
PIPELINE_CONFIG = {
    'features':             FEATURES,
    'lags':                 [1, 2, 3, 6, 12],
    'variables_lag':        ['aqi', 'pm25', 'pm10', 'pm1'],
    'ventanas_rolling':     [3, 6, 12],
    'variables_rolling':    ['pm25', 'pm10', 'aqi'],
    'variables_diff':       ['aqi', 'pm25', 'pm10'],
    'horizonte_pasos':      PASOS_ADELANTE,
    'frecuencia_min':       FRECUENCIA_MINUTOS,
}

#  BUFFER DE HISTORIAL 
# Tamaño = lag más grande usado = 12 pasos = 60 minutos.
MAX_HISTORIAL = max(PIPELINE_CONFIG['lags'])   # 12
cols_buffer   = ['aqi', 'pm25', 'pm10', 'pm1', 'temperatura', 'humedad']

buffer_sensor = deque(maxlen=MAX_HISTORIAL)

#  SUPABASE 
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

def supabase_fetch(path):
    req = urllib.request.Request(path, headers={
        'apikey':        SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Accept':        'application/json'
    })
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def inicializar_buffer():
    """Carga las últimas 12 lecturas de Supabase al buffer al arrancar."""
    url = (
        f"{SUPABASE_URL}/rest/v1/lecturas_davis"
        f"?select=hora_sensor_utc,aqi,pm1,pm2_5,pm10,temperatura,humedad"
        f"&order=hora_sensor_utc.desc&limit={MAX_HISTORIAL}"
    )
    rows = supabase_fetch(url)[::-1]   # de más antiguo a más reciente
    for r in rows:
        buffer_sensor.append({
            'aqi':         float(r.get('aqi',         0) or 0),
            'pm25':        float(r.get('pm2_5',        0) or 0),
            'pm10':        float(r.get('pm10',         0) or 0),
            'pm1':         float(r.get('pm1',          0) or 0),
            'temperatura': float(r.get('temperatura',  0) or 0),
            'humedad':     float(r.get('humedad',      0) or 0),
        })
    print(f' Buffer inicializado con {len(buffer_sensor)} lecturas')
    print(f'  ({MAX_HISTORIAL * FRECUENCIA_MINUTOS} minutos = '
          f'{MAX_HISTORIAL * FRECUENCIA_MINUTOS / 60:.0f} hora de historial)')


#  FUNCIÓN DE PRODUCCIÓN 
# Copiada exactamente del Paso 9.5 — no se cambió nada

def predecir_aqi_produccion(pm1, pm25, pm10, temperatura, humedad,
                             hora=12, dia_semana=0, mes=1,
                             actualizar_buffer=True):
    """
    Predice el AQI de la siguiente hora.

    Parámetros
    ----------
    pm1, pm25, pm10    : lectura actual del sensor (µg/m³)
    temperatura         : °C
    humedad             : %
    hora                : 0–23
    dia_semana          : 0=Lunes … 6=Domingo
    mes                 : 1–12
    actualizar_buffer   : True en producción continua,
                          False en backtesting / pruebas puntuales

    Retorna
    -------
    aqi_pred  : float  — AQI estimado para la próxima hora
    categoria : str    — categoría EPA
    confianza : str    — calidad de la predicción según el buffer
    """

    cfg = PIPELINE_CONFIG

    #  Validar historial suficiente
    if len(buffer_sensor) < max(cfg['lags']):
        return None, 'Buffer insuficiente', \
               f'Necesita {max(cfg["lags"])} lecturas, tiene {len(buffer_sensor)}'

    #  Variables temporales cíclicas
    fila = {
        'pm1':         pm1,
        'pm25':        pm25,
        'pm10':        pm10,
        'temperatura': temperatura,
        'humedad':     humedad,
        'hora_sin':    np.sin(2 * np.pi * hora / 24),
        'hora_cos':    np.cos(2 * np.pi * hora / 24),
        'dia_sin':     np.sin(2 * np.pi * dia_semana / 7),
        'dia_cos':     np.cos(2 * np.pi * dia_semana / 7),
        'mes_num':     mes,
    }

    hist = list(buffer_sensor)   # para calcular los promedios móviles y las diferencias que necesita el XGBoost.

    # Lags desde el buffer
    for var in cfg['variables_lag']:
        for lag in cfg['lags']:
            key = f'{var}_lag_{lag}'
            if key in cfg['features']:
                idx = -lag
                fila[key] = hist[idx][var] if lag <= len(hist) else np.nan

    #  Rolling medias desde el buffer
    # shift(1): excluir t actual, promediar desde t-1 hacia atrás
    for ventana in cfg['ventanas_rolling']:
        for var in cfg['variables_rolling']:
            key = f'{var}_roll_mean_{ventana}'
            if key in cfg['features']:
                vals = [h[var] for h in hist[-(ventana + 1):-1]]
                fila[key] = np.mean(vals) if len(vals) == ventana else np.nan

    #  Diffs desde el buffer
    # shift(1) antes de diff: diferencia entre t-1 y t-(1+d)
    for var in cfg['variables_diff']:
        for d in [1, 3]:
            key = f'{var}_diff_{d}'
            if key in cfg['features']:
                if len(hist) >= d + 2:
                    fila[key] = hist[-2][var] - hist[-(2 + d)][var]
                else:
                    fila[key] = np.nan

    # Predecir: Junta el presente y el pasado en una sola fila matemática
    X_nuevo  = pd.DataFrame([fila])[cfg['features']].bfill().fillna(0)
    aqi_pred = float(modelo_xgb.predict(X_nuevo)[0])
    aqi_pred = max(0, round(aqi_pred, 1))

    # Categoría EPA
    if aqi_pred <= 50:    cat = 'Buena (0–50)'
    elif aqi_pred <= 100: cat = ' Moderada (51–100)'
    elif aqi_pred <= 150: cat = ' Grupos sensibles (101–150)'
    elif aqi_pred <= 200: cat = ' Dañina (151–200)'
    else:                 cat = ' Muy dañina / Peligrosa (200+)'

    #  Calidad de la predicción
    nans = sum(1 for v in fila.values()
               if isinstance(v, float) and np.isnan(v))
    if nans == 0:
        confianza = 'Alta — buffer completo'
    elif nans <= 3:
        confianza = f'Media — {nans} features imputadas'
    else:
        confianza = f'Baja — {nans} features faltantes'

    # Actualizar buffer
    # Siempre al final: esta lectura pasa a ser el lag_1
    # de la siguiente predicción.
    if actualizar_buffer:
        buffer_sensor.append({
            'aqi':         aqi_pred,
            'pm25':        pm25,
            'pm10':        pm10,
            'pm1':         pm1,
            'temperatura': temperatura,
            'humedad':     humedad,
        })

    return aqi_pred, cat, confianza


# ENDPOINT 

@app.route('/predecir', methods=['GET'])
def predecir():
    try:
        # Leer la lectura más reciente de Supabase
        url = (
            f"{SUPABASE_URL}/rest/v1/lecturas_davis"
            f"?select=hora_sensor_utc,aqi,pm1,pm2_5,pm10,temperatura,humedad"
            f"&order=hora_sensor_utc.desc&limit=1"
        )
        rows = supabase_fetch(url)
        if not rows:
            return jsonify({'error': 'Sin datos en Supabase'}), 400

        ultima = rows[0]

        # Extraer hora, día y mes del timestamp
        from datetime import datetime
        dt         = datetime.fromisoformat(ultima['hora_sensor_utc'].replace(' ', 'T'))
        hora       = dt.hour
        dia_semana = dt.weekday()   # 0=Lunes … 6=Domingo
        mes        = dt.month

        # Llamar a la función exacta del notebook
        aqi_pred, categoria, confianza = predecir_aqi_produccion(
            pm1         = float(ultima.get('pm1',        0) or 0),
            pm25        = float(ultima.get('pm2_5',      0) or 0),
            pm10        = float(ultima.get('pm10',       0) or 0),
            temperatura = float(ultima.get('temperatura',0) or 0),
            humedad     = float(ultima.get('humedad',    0) or 0),
            hora        = hora,
            dia_semana  = dia_semana,
            mes         = mes,
            actualizar_buffer = True,
        )

        if aqi_pred is None:
            return jsonify({'error': categoria, 'detalle': confianza}), 400

        # Color por categoría (para el dashboard)
        if aqi_pred <= 50:    color = '#00e400'
        elif aqi_pred <= 100: color = '#ffff00'
        elif aqi_pred <= 150: color = '#ff7e00'
        elif aqi_pred <= 200: color = '#ff0000'
        else:                 color = '#8f3f97'

        return jsonify({
            'aqi_predicho': aqi_pred,
            'categoria':    categoria,
            'confianza':    confianza,
            'color':        color,
            'timestamp':    ultima['hora_sensor_utc'],
            'horizonte':    '+1 hora',
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


#  ARRANQUE 

if __name__ == '__main__':
    print(' Iniciando API de predicción AQI...')
    inicializar_buffer()
    app.run(port=5000, debug=True)