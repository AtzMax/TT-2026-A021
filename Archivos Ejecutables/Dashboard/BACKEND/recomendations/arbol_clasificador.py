"""
arbol_clasificador.py
Clasificadores de banda/alerta para recomendaciones de calidad del aire.

Reemplaza los pesos adaptativos y multiplicadores heurísticos del motor.

  ClasificadorExplicito  — árbol codificado (if/else), sin entrenamiento.
  ClasificadorSklearn    — DecisionTreeClassifier entrenado con datos sintéticos
                           generados desde ClasificadorExplicito.

Ambos exponen:
  clasificar(aqi_actual, aqi_pred, tendencia, ctx) -> (InfoBanda, str)

ctx es duck-typed: necesita .humo_detectado, .es_receso, .es_cambio_clase,
                             .hora, .dia_semana, .personas_detectadas
"""
from __future__ import annotations

import numpy as np
from bandas_nom172 import InfoBanda, aqi_a_banda, _TABLA_BANDAS

HORAS_PICO = {7, 8, 9}


def _subir_banda(banda: InfoBanda) -> InfoBanda:
    """Sube la banda un nivel de alerta (tope: Peligrosa)."""
    siguiente = min(int(banda.banda) + 1, len(_TABLA_BANDAS) - 1)
    return _TABLA_BANDAS[siguiente][1]


# ═══════════════════════════════════════════════════════════════════════════
# Árbol explícito (reglas codificadas)
# ═══════════════════════════════════════════════════════════════════════════

class ClasificadorExplicito:
    """
    Árbol de decisión codificado con reglas de dominio explícitas.
    Evalúa condiciones en orden jerárquico: AQI efectivo → humo → contexto.
    Sin entrenamiento requerido.
    """

    def clasificar(self, aqi_actual: int, aqi_pred: float,
                   tendencia: str, ctx) -> tuple[InfoBanda, str]:
        """
        Retorna (banda_efectiva, descripcion_contexto_activo).
        Worst-case: usa max(aqi_actual, aqi_pred) como AQI de referencia.
        """
        aqi_ef = max(aqi_actual, int(round(aqi_pred)))
        banda_base = aqi_a_banda(aqi_ef)

        humo     = ctx.humo_detectado
        receso   = ctx.es_receso
        cambio   = ctx.es_cambio_clase
        h_pico   = ctx.hora in HORAS_PICO
        personas = ctx.personas_detectadas
        finde    = ctx.dia_semana >= 5

        desc: list[str] = []

        # ── Rama 1: AQI efectivo >= 201 (Muy no saludable / Peligrosa) ──
        if aqi_ef >= 201:
            if humo or tendencia == "sube":
                banda = _subir_banda(banda_base)
                desc.append(
                    "humo confirmado + AQI crítico — emergencia ambiental"
                    if humo else "AQI crítico con tendencia creciente"
                )
            else:
                banda = banda_base
                desc.append("AQI crítico — protocolo de emergencia")

        # ── Rama 2: 151 ≤ AQI < 201 (No saludable) ──────────────────────
        elif aqi_ef >= 151:
            if humo and (receso or h_pico):
                banda = _subir_banda(banda_base)
                desc.append("humo + exposición masiva (receso/hora pico)")
            elif humo:
                banda = _subir_banda(banda_base)
                desc.append("humo de tabaco detectado — fuente directa confirmada")
            elif tendencia == "sube" and (receso or h_pico):
                banda = _subir_banda(banda_base)
                desc.append("calidad deteriorándose en hora de mayor exposición")
            elif receso:
                banda = banda_base
                desc.append("receso académico — comunidad expuesta al exterior")
            else:
                banda = banda_base
                desc.append("calidad no saludable")

        # ── Rama 3: 101 ≤ AQI < 151 (Mala para grupos sensibles) ────────
        elif aqi_ef >= 101:
            if humo:
                banda = _subir_banda(banda_base)
                desc.append("humo agrava condición para grupos sensibles")
            elif receso and personas >= 20:
                banda = banda_base
                desc.append(f"receso con alta ocupación ({personas} personas)")
            elif h_pico and cambio:
                banda = banda_base
                desc.append("hora pico + cambio de clase — máxima exposición")
            elif tendencia == "sube":
                banda = banda_base
                desc.append("tendencia creciente — condición puede empeorar")
            else:
                banda = banda_base
                desc.append("calidad regular para grupos sensibles")

        # ── Rama 4: 51 ≤ AQI < 101 (Aceptable) ──────────────────────────
        elif aqi_ef >= 51:
            if humo:
                banda = _subir_banda(banda_base)
                desc.append("humo activo eleva riesgo a nivel de grupos sensibles")
            elif tendencia == "sube" and h_pico:
                banda = banda_base
                desc.append("calidad aceptable pero deteriorándose en hora pico")
            elif receso and personas >= 25:
                banda = banda_base
                desc.append(f"calidad aceptable · receso con {personas} personas")
            elif finde:
                banda = banda_base
                desc.append("fin de semana — actividad reducida")
            else:
                banda = banda_base
                if h_pico and cambio:
                    desc.append("hora pico + cambio de clase")
                elif h_pico:
                    desc.append("calidad aceptable en hora pico matutina")
                elif cambio:
                    desc.append("calidad aceptable · cambio de clase")
                else:
                    desc.append("horario normal")

        # ── Rama 5: AQI < 51 (Buena) ─────────────────────────────────────
        else:
            if humo:
                banda = _subir_banda(banda_base)
                desc.append("humo detectado a pesar de buenas condiciones generales")
            elif finde:
                banda = banda_base
                desc.append("fin de semana — condiciones favorables")
            else:
                banda = banda_base
                desc.append("buenas condiciones" + (" · hora pico" if h_pico else ""))

        # Ocupación (si no se mencionó ya)
        desc_str = " · ".join(desc)
        if "personas" not in desc_str:
            if personas >= 30:
                desc.append(f"alta ocupación ({personas} personas)")
            elif personas >= 15:
                desc.append(f"ocupación moderada ({personas} personas)")
            elif personas > 0:
                desc.append(f"{personas} personas")

        return banda, " · ".join(desc)


# ═══════════════════════════════════════════════════════════════════════════
# Árbol sklearn (entrenado con datos sintéticos)
# ═══════════════════════════════════════════════════════════════════════════

class ClasificadorSklearn:
    """
    DecisionTreeClassifier de sklearn entrenado con 50 000 muestras sintéticas
    generadas por ClasificadorExplicito. El árbol aprende a replicar el árbol
    explícito pero puede ser inspeccionado, exportado y ajustado con datos reales.

    Al instanciarlo:
      - Si arbol_modelo.pkl existe → lo carga.
      - Si no → genera datos sintéticos, entrena y guarda el modelo.
    """

    N_SAMPLES = 50_000
    MAX_DEPTH  = 12
    FEATURE_NAMES = [
        "aqi_actual", "aqi_pred", "aqi_efectivo",
        "tendencia_num",        # -1=baja  0=estable  1=sube
        "hora", "dia_semana",
        "es_receso", "es_cambio_clase",
        "personas_detectadas", "humo_detectado",
    ]

    def __init__(self, ruta_modelo: str = "arbol_modelo.pkl"):
        from pathlib import Path
        self._ruta = Path(ruta_modelo)
        self._clf  = None

        if self._ruta.exists():
            self._cargar()
        else:
            self.entrenar_y_guardar()

    # ── Feature vector ───────────────────────────────────────────────────
    def _vec(self, aqi_actual: int, aqi_pred: float, tendencia_num: int,
             hora: int, dia_semana: int, es_receso: bool, es_cambio_clase: bool,
             personas: int, humo: bool) -> list:
        return [
            aqi_actual, float(aqi_pred), float(max(aqi_actual, aqi_pred)),
            tendencia_num,
            hora, dia_semana,
            int(es_receso), int(es_cambio_clase),
            personas, int(humo),
        ]

    # ── Generación de datos sintéticos ───────────────────────────────────
    def _generar_datos(self) -> tuple[np.ndarray, np.ndarray]:
        rng      = np.random.default_rng(42)
        clf_exp  = ClasificadorExplicito()

        class _Ctx:
            pass

        X, y = [], []
        for _ in range(self.N_SAMPLES):
            aqi_actual  = int(rng.integers(0, 400))
            delta_pred  = int(rng.integers(-80, 120))
            aqi_pred    = float(max(0, aqi_actual + delta_pred))
            hora        = int(rng.integers(0, 24))
            dia_semana  = int(rng.integers(0, 7))
            personas    = int(rng.integers(0, 55))
            humo        = bool(rng.random() < 0.15)
            es_receso   = bool(hora == 10 and rng.random() < 0.5)
            es_cambio   = bool(rng.random() < 0.10)

            delta = aqi_pred - aqi_actual
            if delta > 5:
                tendencia, t_num = "sube", 1
            elif delta < -5:
                tendencia, t_num = "baja", -1
            else:
                tendencia, t_num = "estable", 0

            ctx = _Ctx()
            ctx.humo_detectado    = humo
            ctx.es_receso         = es_receso
            ctx.es_cambio_clase   = es_cambio
            ctx.hora              = hora
            ctx.dia_semana        = dia_semana
            ctx.personas_detectadas = personas

            banda, _ = clf_exp.clasificar(aqi_actual, aqi_pred, tendencia, ctx)

            X.append(self._vec(aqi_actual, aqi_pred, t_num,
                                hora, dia_semana, es_receso, es_cambio,
                                personas, humo))
            y.append(int(banda.banda))

        return np.array(X), np.array(y)

    # ── Entrenamiento ────────────────────────────────────────────────────
    def entrenar_y_guardar(self) -> None:
        from sklearn.tree import DecisionTreeClassifier
        import pickle

        print("[ClasificadorSklearn] Generando datos sintéticos…")
        X, y = self._generar_datos()

        self._clf = DecisionTreeClassifier(
            max_depth=self.MAX_DEPTH,
            min_samples_leaf=15,
            random_state=42,
        )
        self._clf.fit(X, y)
        acc = self._clf.score(X, y)

        with open(self._ruta, "wb") as f:
            pickle.dump(self._clf, f)

        print(
            f"[ClasificadorSklearn] Entrenado con {len(X)} muestras "
            f"— accuracy sintética: {acc:.3f} → {self._ruta.name}"
        )

    def _cargar(self) -> None:
        import pickle
        with open(self._ruta, "rb") as f:
            self._clf = pickle.load(f)

    # ── Clasificación ────────────────────────────────────────────────────
    def clasificar(self, aqi_actual: int, aqi_pred: float,
                   tendencia: str, ctx) -> tuple[InfoBanda, str]:
        if self._clf is None:
            raise RuntimeError("Modelo sklearn no cargado.")

        t_num = {"sube": 1, "estable": 0, "baja": -1}.get(tendencia, 0)
        X = [self._vec(
            aqi_actual, float(aqi_pred), t_num,
            ctx.hora, ctx.dia_semana,
            ctx.es_receso, ctx.es_cambio_clase,
            ctx.personas_detectadas, ctx.humo_detectado,
        )]
        nivel = int(self._clf.predict(X)[0])
        banda = _TABLA_BANDAS[min(nivel, len(_TABLA_BANDAS) - 1)][1]

        # Descripción textual generada a partir del contexto
        partes = [f"árbol ML · {banda.nombre.lower()}"]
        if ctx.humo_detectado:
            partes.append("humo de tabaco detectado")
        if ctx.es_receso:
            partes.append("receso académico")
        elif ctx.hora in HORAS_PICO and ctx.es_cambio_clase:
            partes.append("hora pico + cambio de clase")
        elif ctx.hora in HORAS_PICO:
            partes.append("hora pico matutina")
        if ctx.personas_detectadas >= 30:
            partes.append(f"alta ocupación ({ctx.personas_detectadas} personas)")
        elif ctx.personas_detectadas >= 15:
            partes.append(f"ocupación moderada ({ctx.personas_detectadas} personas)")
        elif ctx.personas_detectadas > 0:
            partes.append(f"{ctx.personas_detectadas} personas")

        return banda, " · ".join(partes)

    # ── Utilidades ───────────────────────────────────────────────────────
    def exportar_texto(self, ruta_txt: str = "arbol_modelo.txt") -> None:
        """Exporta el árbol en formato texto legible para auditoría."""
        from sklearn.tree import export_text
        reporte = export_text(self._clf, feature_names=self.FEATURE_NAMES)
        with open(ruta_txt, "w", encoding="utf-8") as f:
            f.write(reporte)
        print(f"[ClasificadorSklearn] Árbol exportado → {ruta_txt}")
