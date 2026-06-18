"""
predictor.py
Wrapper sobre modelo_aqi.json.
Usa el mismo pipeline de features que api_modelo.py (lags, rolling, diffs, sin/cos).
"""
import numpy as np
import pandas as pd
import xgboost as xgb
import json
from collections import deque
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ResultadoPrediccion:
    aqi_pred: float           # AQI predicho en T+60 min
    tendencia: str            # "sube" | "baja" | "estable"
    delta: float              # diferencia AQI respecto al actual
    confianza: str            # "alta" | "media" | "baja"
    driver: str               # feature más influyente (approx)


class PredictorXGBoost:
    """
    Usa el mismo pipeline de api_modelo.py.
    Recibe historial_15min (mínimo 12 registros de 5 min)
    y expone predict() para uso externo.
    """

    UMBRAL_TENDENCIA = 5.0    # AQI units para considerar cambio real
    MAX_HISTORIAL    = 12     # lag máximo usado en el pipeline

    # Configuración del pipeline — idéntica a api_modelo.py
    _CFG = {
        'lags':              [1, 2, 3, 6, 12],
        'variables_lag':     ['aqi', 'pm25', 'pm10', 'pm1'],
        'ventanas_rolling':  [3, 6, 12],
        'variables_rolling': ['pm25', 'pm10', 'aqi'],
        'variables_diff':    ['aqi', 'pm25', 'pm10'],
    }

    def __init__(self, ruta_modelo: str = "modelo_aqi.json",
                 ruta_features:   str = "features.json"):
        self.modelo = xgb.XGBRegressor()
        self.modelo.load_model(ruta_modelo)

        with open(ruta_features, encoding='utf-8') as f:
            self.features = json.load(f)   # lista de nombres de columnas

    # ── Conversión de nombres de campo ─────────────────────────────────
    @staticmethod
    def _normalizar(reg: dict) -> dict:
        """Acepta tanto 'temp'/'hum' (formato viejo) como 'temperatura'/'humedad'."""
        out = dict(reg)
        if 'temperatura' not in out and 'temp' in out:
            out['temperatura'] = out['temp']
        if 'humedad' not in out and 'hum' in out:
            out['humedad'] = out['hum']
        return out

    # ── Construcción de features — igual que predecir_aqi_produccion ───
    def _build_features(self, historial: list[dict]) -> pd.DataFrame:
        if len(historial) < self.MAX_HISTORIAL:
            raise ValueError(
                f"Se necesitan >={self.MAX_HISTORIAL} registros; "
                f"se recibieron {len(historial)}"
            )

        hist = [self._normalizar(r) for r in historial]
        actual = hist[-1]

        # Extraer info temporal del timestamp
        ts = actual["ts"]
        hora       = ts.hour
        dia_semana = ts.weekday()
        mes        = ts.month

        fila: dict = {
            'pm1':         actual['pm1'],
            'pm25':        actual['pm25'],
            'pm10':        actual['pm10'],
            'temperatura': actual['temperatura'],
            'humedad':     actual['humedad'],
            'hora_sin':    np.sin(2 * np.pi * hora / 24),
            'hora_cos':    np.cos(2 * np.pi * hora / 24),
            'dia_sin':     np.sin(2 * np.pi * dia_semana / 7),
            'dia_cos':     np.cos(2 * np.pi * dia_semana / 7),
            'mes_num':     mes,
        }

        cfg = self._CFG

        # Lags desde el historial
        for var in cfg['variables_lag']:
            for lag in cfg['lags']:
                key = f'{var}_lag_{lag}'
                if key in self.features:
                    idx = -lag
                    fila[key] = hist[idx][var] if lag <= len(hist) else np.nan

        # Rolling medias (shift 1 — excluye el actual)
        for ventana in cfg['ventanas_rolling']:
            for var in cfg['variables_rolling']:
                key = f'{var}_roll_mean_{ventana}'
                if key in self.features:
                    vals = [h[var] for h in hist[-(ventana + 1):-1]]
                    fila[key] = np.mean(vals) if len(vals) == ventana else np.nan

        # Diffs desde el historial (shift 1 antes del diff)
        for var in cfg['variables_diff']:
            for d in [1, 3]:
                key = f'{var}_diff_{d}'
                if key in self.features:
                    if len(hist) >= d + 2:
                        fila[key] = hist[-2][var] - hist[-(2 + d)][var]
                    else:
                        fila[key] = np.nan

        X = pd.DataFrame([fila])[self.features].bfill().fillna(0)
        return X

    def _calcular_tendencia(self, aqi_actual: float, aqi_pred: float) -> tuple[str, float]:
        delta = aqi_pred - aqi_actual
        if delta > self.UMBRAL_TENDENCIA:
            tendencia = "sube"
        elif delta < -self.UMBRAL_TENDENCIA:
            tendencia = "baja"
        else:
            tendencia = "estable"
        return tendencia, round(delta, 2)

    def _estimar_confianza(self, X: pd.DataFrame) -> str:
        """Misma lógica que api_modelo.py: cuenta NaN antes del bfill."""
        # Reconstruir fila antes de imputación para contar NaNs
        nans = int(X.isna().sum().sum())
        if nans == 0:
            return "alta"
        if nans <= 3:
            return "media"
        return "baja"

    def _feature_driver(self, X: pd.DataFrame) -> str:
        importancias = self.modelo.feature_importances_
        nombres = X.columns.tolist()
        idx = int(np.argmax(importancias))
        return nombres[idx] if idx < len(nombres) else "desconocido"

    def predict(self, historial: list[dict]) -> ResultadoPrediccion:
        X = self._build_features(historial)
        aqi_pred = float(self.modelo.predict(X)[0])
        aqi_pred = max(0.0, round(aqi_pred, 1))

        aqi_actual = float(historial[-1]['aqi'])
        tendencia, delta = self._calcular_tendencia(aqi_actual, aqi_pred)
        confianza = self._estimar_confianza(X)
        driver = self._feature_driver(X)

        return ResultadoPrediccion(
            aqi_pred=aqi_pred,
            tendencia=tendencia,
            delta=delta,
            confianza=confianza,
            driver=driver,
        )
