import os
import time
import hashlib
import hmac
import httpx
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

# ── 1. Cargar configuración desde el archivo .env ──
DIR_BASE = os.path.dirname(os.path.abspath(__file__))
RUTA_ENV = os.path.join(DIR_BASE, '.env')

load_dotenv(RUTA_ENV)

API_KEY      = os.getenv("DAVIS_API_KEY")
API_SECRET   = os.getenv("DAVIS_API_SECRET")
STATION_ID   = os.getenv("DAVIS_STATION_ID")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

def f_a_c(valor_f):
    if valor_f is None: return None
    return round((valor_f - 32) * 5 / 9, 2)

def construir_firma(station_id, api_key, api_secret):
    ts = str(int(time.time()))
    # Construimos el mensaje (Asegúrate de que las llaves {} tengan las variables adentro)
    mensaje = f"api-key{}station-id{}t{}"
    firma = hmac.new(
        api_secret.encode("utf-8"),
        mensaje.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return ts, firma

def extraer_datos_sensores(datos):
    if "sensors" not in datos: return None

    sensores_clima = []
    for sensor in datos["sensors"]:
        if sensor.get("sensor_type") == 323:
            for registro in sensor.get("data", []):
                sensores_clima.append(registro)

    if not sensores_clima: return None

    # Ordenar y tomar el más reciente
    sensores_clima.sort(key=lambda x: x.get("ts", 0), reverse=True)
    reciente = sensores_clima[0]

    # Hora CDMX
    tz_cdmx = timezone(timedelta(hours=-6))
    ts_sensor = reciente.get("ts", 0)
    hora_cdmx = datetime.fromtimestamp(ts_sensor, timezone.utc).astimezone(tz_cdmx).strftime("%Y-%m-%d %H:%M:%S")

    return {
        "pm10":            reciente.get("pm_10"),
        "pm1":             reciente.get("pm_1"),
        "pm2_5":           reciente.get("pm_2p5"),
        "aqi":             reciente.get("aqi_val"),
        "temperatura":     f_a_c(reciente.get("temp")),
        "humedad":         reciente.get("hum"),
        "hora_sensor_utc": hora_cdmx 
    }

def main():
    # Validar que cargaron las llaves
    if not all([API_KEY, API_SECRET, STATION_ID, SUPABASE_URL, SUPABASE_KEY]):
        print(f"[{datetime.now()}] Error: Faltan credenciales en el archivo .env")
        return

    with httpx.Client(timeout=30) as client:
        try:
            # 1. Consultar a Davis
            ts, firma = construir_firma(STATION_ID, API_KEY, API_SECRET)
            url_davis = f"https://api.weatherlink.com/v2/current/{}?api-key={}&t={}&api-signature={}"
            
            resp = client.get(url_davis)
            resp.raise_for_status()
            
            datos = extraer_datos_sensores(resp.json())
            
            # 2. Enviar a Supabase
            if datos:
                headers = {
                    "apikey": SUPABASE_KEY,
                    "Authorization": f"Bearer {}",
                    "Content-Type": "application/json"
                }
                url_supabase = f"{}/rest/v1/lecturas_davis"
                
                sb_resp = client.post(url_supabase, json=datos, headers=headers)
                sb_resp.raise_for_status() # Lanza error si Supabase rechaza el dato
                
                print(f"[{datetime.now()}] Procesado a Supabase exitosamente: {datos['hora_sensor_utc']}")
            else:
                print(f"[{datetime.now()}] Sin datos nuevos del sensor Airlink")

        except Exception as e:
            print(f"[{datetime.now()}] Error capturado: {str(e)}")

# Sustituye el endpoint de Google Cloud con la ejecución directa en Linux
if __name__ == "__main__":
    main()