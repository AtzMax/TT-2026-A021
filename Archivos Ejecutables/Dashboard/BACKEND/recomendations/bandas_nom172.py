"""
bandas_nom172.py
Conversión PM2.5 → AQI (EPA breakpoints) → banda NOM-172-SEMARNAT-2023.
Lógica preventiva: siempre toma la peor banda entre actual y predicho.
"""
from dataclasses import dataclass
from enum import IntEnum


class Banda(IntEnum):
    BUENA          = 0
    ACEPTABLE      = 1   # "Moderada" en EPA, NOM usa "Aceptable"
    MALA_SENSIBLES = 2   # No saludable para grupos sensibles
    MALA           = 3   # No saludable
    MUY_MALA       = 4   # Muy no saludable
    PELIGROSA      = 5


@dataclass
class InfoBanda:
    banda: Banda
    nombre: str
    aqi_estimado: int
    pm25_base: float
    color_hex: str          # para el frontend
    nivel_alerta: int       # 0=info  1=warning  2=critical
    requiere_accion: bool


# ── Breakpoints EPA para PM2.5 (24h) → AQI ───────────────────────────
# (C_lo, C_hi, I_lo, I_hi)
_PM25_BREAKPOINTS = [
    (0.0,   9.0,   0,  50),
    (9.1,  35.4,  51, 100),
    (35.5, 55.4, 101, 150),
    (55.5, 125.4,151, 200),
    (125.5,225.4,201, 300),
    (225.5,325.4,301, 500),
]

def pm25_a_aqi(pm25: float) -> int:
    """Convierte PM2.5 (μg/m³) a AQI usando breakpoints EPA."""
    pm25 = max(0.0, round(pm25, 1))
    for c_lo, c_hi, i_lo, i_hi in _PM25_BREAKPOINTS:
        if c_lo <= pm25 <= c_hi:
            aqi = (i_hi - i_lo) / (c_hi - c_lo) * (pm25 - c_lo) + i_lo
            return int(round(aqi))
    return 500  # fuera de escala


# ── Tabla de bandas NOM-172 ───────────────────────────────────────────
_TABLA_BANDAS: list[tuple[int, InfoBanda]] = [
    (50,  InfoBanda(Banda.BUENA,          "Buena",                       0,   0.0,  "#34C98C", 0, False)),
    (100, InfoBanda(Banda.ACEPTABLE,      "Aceptable",                  75,   9.1,  "#F5C842", 0, False)),
    (150, InfoBanda(Banda.MALA_SENSIBLES, "Mala para grupos sensibles", 125,  35.5, "#F07C3A", 1, True )),
    (200, InfoBanda(Banda.MALA,           "No saludable",               175,  55.5, "#E84B4B", 2, True )),
    (300, InfoBanda(Banda.MUY_MALA,       "Muy no saludable",           250, 125.5, "#9B7EF8", 2, True )),
    (999, InfoBanda(Banda.PELIGROSA,      "Peligrosa",                  400, 225.5, "#7A1919", 2, True )),
]

def aqi_a_banda(aqi: int) -> InfoBanda:
    for limite, info in _TABLA_BANDAS:
        if aqi <= limite:
            return info
    return _TABLA_BANDAS[-1][1]


def pm25_a_banda(pm25: float) -> InfoBanda:
    return aqi_a_banda(pm25_a_aqi(pm25))


def banda_preventiva(pm25_actual: float, pm25_pred: float,
                     confianza: str = "alta") -> tuple[InfoBanda, InfoBanda]:
    """
    Lógica worst-case NOM-172:
    - Toma la peor banda entre actual y predicho.
    - Si confianza es 'baja', sube la banda resultante un nivel.

    Retorna (banda_efectiva, banda_actual) — el motor puede mostrar ambas.
    """
    banda_actual = pm25_a_banda(pm25_actual)
    banda_pred   = pm25_a_banda(pm25_pred)

    # Peor de las dos
    if banda_pred.banda > banda_actual.banda:
        efectiva = banda_pred
    else:
        efectiva = banda_actual

    # Ajuste por baja confianza del modelo
    if confianza == "baja":
        siguiente_idx = min(int(efectiva.banda) + 1, len(_TABLA_BANDAS) - 1)
        efectiva = _TABLA_BANDAS[siguiente_idx][1]

    return efectiva, banda_actual


def banda_preventiva_aqi(aqi_actual: int, aqi_pred: float,
                         confianza: str = "alta") -> tuple[InfoBanda, InfoBanda]:
    """
    Variante de banda_preventiva que trabaja directamente con AQI.
    Usa cuando el modelo predice AQI (modelo_aqi.json) en lugar de PM2.5.

    Retorna (banda_efectiva, banda_actual).
    """
    banda_actual = aqi_a_banda(aqi_actual)
    banda_pred   = aqi_a_banda(int(round(aqi_pred)))

    if banda_pred.banda > banda_actual.banda:
        efectiva = banda_pred
    else:
        efectiva = banda_actual

    if confianza == "baja":
        siguiente_idx = min(int(efectiva.banda) + 1, len(_TABLA_BANDAS) - 1)
        efectiva = _TABLA_BANDAS[siguiente_idx][1]

    return efectiva, banda_actual
