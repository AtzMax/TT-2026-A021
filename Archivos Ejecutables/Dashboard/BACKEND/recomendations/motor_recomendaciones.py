"""
motor_recomendaciones.py
Orquestador principal. No carga el modelo directamente —
delega en predictor.py y bandas_nom172.py.

Uso desde inferencia_tabaco.py:
    from motor_recomendaciones import MotorRecomendaciones
    motor = MotorRecomendaciones()
    rec = motor.generar(historial_15min, contexto_universidad)
    print(rec.to_dict())

Uso desde recomendacion_api.py (FastAPI):
    motor = MotorRecomendaciones()   # singleton en startup
    rec = motor.generar(historial, ctx)
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

from predictor import PredictorXGBoost, ResultadoPrediccion
from bandas_nom172 import InfoBanda
from arbol_clasificador import ClasificadorExplicito, ClasificadorSklearn

_BACKEND_DIR = Path(__file__).resolve().parent.parent


# ── Contexto universitario ─────────────────────────────────────────────
@dataclass
class ContextoUniversidad:
    hora: int
    dia_semana: int        # 0=lunes … 6=domingo
    es_receso: bool = False
    es_cambio_clase: bool = False  # ventana ±5 min de cambio de hora
    personas_detectadas: int = 0   # conteo de personas por cámara (0 = sin dato)
    humo_detectado: bool = False   # humo de tabaco detectado por visión artificial

    # Recesos fijos ESCOM: (inicio_min, fin_min) en minutos desde medianoche
    _RECESOS_MIN = [
        (10 * 60,       10 * 60 + 30),   # 10:00 – 10:30
        (18 * 60,       18 * 60 + 30),   # 18:00 – 18:30
    ]

    # Inicio de cada bloque de clase ESCOM, en minutos desde medianoche
    # Bloques de 1.5 h: 7:00, 8:30, (receso 10-10:30), 10:30, 12:00,
    #                   13:30, 15:00, 16:30, (receso 18-18:30), 18:30, 20:00
    _CAMBIOS_MIN = [
        7 * 60,
        8 * 60 + 30,
        10 * 60 + 30,
        12 * 60,
        13 * 60 + 30,
        15 * 60,
        16 * 60 + 30,
        18 * 60 + 30,
        20 * 60,
    ]

    @classmethod
    def desde_datetime(cls, dt: datetime,
                       personas_detectadas: int = 0,
                       humo_detectado: bool = False) -> "ContextoUniversidad":
        hora = dt.hour
        total_min = hora * 60 + dt.minute

        es_receso = any(ini <= total_min < fin for ini, fin in cls._RECESOS_MIN)

        # Ventana ±5 min alrededor de cada inicio de clase
        es_cambio = (
            not es_receso
            and any(abs(total_min - c) <= 5 for c in cls._CAMBIOS_MIN)
        )

        return cls(
            hora=hora,
            dia_semana=dt.weekday(),
            es_receso=es_receso,
            es_cambio_clase=es_cambio,
            personas_detectadas=personas_detectadas,
            humo_detectado=humo_detectado,
        )


# ── Resultado final ────────────────────────────────────────────────────
@dataclass
class Recomendacion:
    # Métricas
    pm25_actual: float
    aqi_predicho: float
    aqi_estimado: int

    # Clasificación
    banda_nombre: str
    banda_nivel: int           # 0–5 (Banda enum)
    color_hex: str
    nivel_alerta: int          # 0=info  1=warning  2=critical
    requiere_accion: bool

    # Tendencia
    tendencia: str             # "sube" | "baja" | "estable"
    icono_tendencia: str       # "↑" | "↓" | "→"
    delta_aqi: float

    # Confianza del modelo
    confianza_modelo: str      # "alta" | "media" | "baja"
    feature_driver: str

    # Mensajes
    mensaje_general: str
    mensaje_expuesto: str
    contexto_activo: str       # describe el modificador aplicado

    # Cámara
    personas_detectadas: int
    humo_detectado: bool

    # Metadatos
    timestamp: str
    banda_solo_actual: str     # para comparar en UI ("sin predicción sería X")

    def to_dict(self) -> dict:
        return asdict(self)


# ── Motor principal ────────────────────────────────────────────────────
class MotorRecomendaciones:
    """
    Singleton recomendado: instanciar una vez, llamar generar() en cada ciclo.

    modo_clasificador:
      "explicito" (default) — árbol de decisión codificado, sin entrenamiento.
      "sklearn"             — DecisionTreeClassifier entrenado con datos sintéticos.
    """

    def __init__(self,
                 ruta_modelo:         str | None = None,
                 ruta_features:       str | None = None,
                 modo_clasificador:   str = "explicito",
                 ruta_arbol:          str | None = None,
                 **_ignorados):
        if ruta_modelo is None:
            ruta_modelo = str(_BACKEND_DIR / "modelo_aqi.json")
        if ruta_features is None:
            ruta_features = str(_BACKEND_DIR / "features.json")
        if ruta_arbol is None:
            ruta_arbol = str(_BACKEND_DIR / "arbol_modelo.pkl")
        self._predictor = PredictorXGBoost(ruta_modelo, ruta_features)

        if modo_clasificador == "sklearn":
            self._clasificador = ClasificadorSklearn(ruta_arbol)
        else:
            self._clasificador = ClasificadorExplicito()

    # ── Generación de mensajes ──────────────────────────────────────────
    _MENSAJES_GENERAL: dict[str, dict] = {
        "Buena": {
            "msg": "Calidad del aire buena. No se requieren precauciones especiales.",
            "expuesto": "Condiciones favorables para actividades al exterior.",
        },
        "Aceptable": {
            "msg": "Calidad del aire aceptable. Personas muy sensibles pueden percibir molestias leves.",
            "expuesto": "Usar cubrebocas si realiza actividad física prolongada al exterior.",
        },
        "Mala para grupos sensibles": {
            "msg": "Calidad regular. Grupos sensibles (asma, adultos mayores, niños) deben reducir actividad exterior.",
            "expuesto": "Obligatorio cubrebocas N95 al exterior. Limitar exposición a 30 min continuos.",
        },
        "No saludable": {
            "msg": "Aire no saludable. Toda la comunidad universitaria debe evitar actividades exteriores prolongadas.",
            "expuesto": "No realizar labores al exterior sin equipo de protección. Reportar al área de seguridad.",
        },
        "Muy no saludable": {
            "msg": "Alerta roja. Evitar cualquier actividad exterior. Mantener ventanas cerradas.",
            "expuesto": "Suspender actividades exteriores. Protocolo de emergencia ambiental activado.",
        },
        "Peligrosa": {
            "msg": "EMERGENCIA AMBIENTAL. Permanecer en interiores. Seguir indicaciones de protección civil.",
            "expuesto": "SUSPENDER TODA ACTIVIDAD EXTERIOR. Evacuar hacia zonas interiores ventiladas.",
        },
    }

    def _generar_mensajes(self, banda: InfoBanda, tendencia: str,
                           driver: str, ctx_desc: str) -> tuple[str, str]:
        base = self._MENSAJES_GENERAL.get(
            banda.nombre,
            {"msg": "Monitorear condiciones.", "expuesto": "Precaución adicional recomendada."}
        )
        sufijo_tendencia = ""
        if tendencia == "sube":
            sufijo_tendencia = " La tendencia indica que la calidad puede empeorar en los próximos 15 min."
        elif tendencia == "baja":
            sufijo_tendencia = " Se espera mejora en los próximos 15 min."

        sufijo_general = sufijo_tendencia
        if "pm25" in driver or "pm10" in driver:
            sufijo_general += " Niveles de partículas finas son el factor determinante."
        if "humo de tabaco" in ctx_desc:
            sufijo_general += " Fuente de humo de tabaco identificada por cámara — alejarse del área afectada."

        return base["msg"] + sufijo_general, base["expuesto"] + sufijo_tendencia

    # ── Fallback sin predicción ─────────────────────────────────────────
    def _generar_sin_prediccion(self,
                                historial_15min: list[dict],
                                contexto: ContextoUniversidad) -> Recomendacion:
        """
        Genera recomendación usando solo el PM2.5 actual.
        Se usa cuando historial < 4 registros y no hay suficiente contexto
        para ejecutar el modelo XGBoost.
        """
        actual = historial_15min[-1]

        banda_actual, ctx_desc = self._clasificador.clasificar(
            actual["aqi"], actual["aqi"], "estable", contexto
        )

        msg_general, msg_expuesto = self._generar_mensajes(
            banda_actual, "estable", "sin modelo", ctx_desc
        )

        return Recomendacion(
            pm25_actual=round(actual["pm25"], 2),
            aqi_predicho=round(actual["pm25"], 2),
            aqi_estimado=actual["aqi"],

            banda_nombre=banda_actual.nombre,
            banda_nivel=int(banda_actual.banda),
            color_hex=banda_actual.color_hex,
            nivel_alerta=banda_actual.nivel_alerta,
            requiere_accion=banda_actual.requiere_accion,

            tendencia="estable",
            icono_tendencia="→",
            delta_aqi=0.0,

            confianza_modelo="sin modelo",
            feature_driver="sin modelo",

            mensaje_general=msg_general,
            mensaje_expuesto=msg_expuesto,
            contexto_activo=ctx_desc,

            personas_detectadas=contexto.personas_detectadas,
            humo_detectado=contexto.humo_detectado,

            timestamp=actual["ts"].isoformat(),
            banda_solo_actual=banda_actual.nombre,
        )

    # ── API pública ─────────────────────────────────────────────────────
    def generar(self,
                historial_15min: list[dict],
                contexto: ContextoUniversidad | None = None) -> Recomendacion:
        """
        Punto de entrada. historial_15min es la misma lista que
        construye inferencia_tabaco.py (dicts con keys: pm25, pm10,
        pm1, temp, hum, aqi, ts).

        contexto: si None, se infiere desde el último timestamp.

        Flujo:
          - >= 12 registros → predicción XGBoost completa (AQI T+60)
          - 1–11 registros  → fallback sin predicción (solo PM2.5 actual)
          - 0 registros     → ValueError
        """
        if len(historial_15min) < 1:
            raise ValueError("Se necesita al menos 1 registro de 5 min.")

        actual = historial_15min[-1]

        # Inferir contexto si no se pasa
        if contexto is None:
            contexto = ContextoUniversidad.desde_datetime(actual["ts"])

        # Fallback cuando no hay historial suficiente para el modelo
        if len(historial_15min) < PredictorXGBoost.MAX_HISTORIAL:
            return self._generar_sin_prediccion(historial_15min, contexto)

        # 1. Predicción XGBoost — AQI en T+60
        pred: ResultadoPrediccion = self._predictor.predict(historial_15min)

        # 2. Clasificación con árbol de decisión (worst-case + contexto)
        banda_efectiva, ctx_desc = self._clasificador.clasificar(
            actual["aqi"], pred.aqi_pred, pred.tendencia, contexto
        )
        banda_solo_actual = self._clasificador.clasificar(
            actual["aqi"], actual["aqi"], "estable", contexto
        )[0]

        # 3. Mensajes
        iconos = {"sube": "↑", "baja": "↓", "estable": "→"}
        msg_general, msg_expuesto = self._generar_mensajes(
            banda_efectiva, pred.tendencia, pred.driver, ctx_desc
        )

        aqi_est = max(actual["aqi"], int(round(pred.aqi_pred)))

        return Recomendacion(
            pm25_actual=round(actual["pm25"], 2),
            aqi_predicho=round(actual["pm25"], 2),
            aqi_estimado=aqi_est,

            banda_nombre=banda_efectiva.nombre,
            banda_nivel=int(banda_efectiva.banda),
            color_hex=banda_efectiva.color_hex,
            nivel_alerta=banda_efectiva.nivel_alerta,
            requiere_accion=banda_efectiva.requiere_accion,

            tendencia=pred.tendencia,
            icono_tendencia=iconos[pred.tendencia],
            delta_aqi=pred.delta,

            confianza_modelo=pred.confianza,
            feature_driver=pred.driver,

            mensaje_general=msg_general,
            mensaje_expuesto=msg_expuesto,
            contexto_activo=ctx_desc,

            personas_detectadas=contexto.personas_detectadas,
            humo_detectado=contexto.humo_detectado,

            timestamp=actual["ts"].isoformat(),
            banda_solo_actual=banda_solo_actual.nombre,
        )
