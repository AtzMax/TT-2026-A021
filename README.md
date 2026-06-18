# 🌡️ Prototipo para la detección de exposición a contaminantes del aire y generación de alertas tempranas en zonas de consumo de tabaco

> Prototipo de monitoreo ambiental en tiempo real con cámaras térmicas, sensores meteorológicos y dashboard interactivo.

---

## 📽️ Demo del Proyecto

[![Video Final](https://img.youtube.com/vi/lSK_QFx31ZM/maxresdefault.jpg)](https://youtu.be/lSK_QFx31ZM)

> Haz clic en la imagen para ver el video de demostración del sistema completo.

---

## 📌 Descripción General

Este proyecto desarrolla un **prototipo de sistema de detección de alertas tempranas** que integra hardware especializado y tecnologías modernas para el monitoreo ambiental en tiempo real. El producto final es un **dashboard interactivo** que centraliza y visualiza toda la información capturada por los sensores, permitiendo identificar condiciones de riesgo de forma oportuna.

---

## 🖥️ Producto Final: Dashboard de Monitoreo

El dashboard es la pieza central del sistema. Desde él es posible:

- 📊 Visualizar datos meteorológicos (PM 2.5, PM 10, Temperatura, Humedad, aqi) en tiempo real
- 🌡️ Ver imágenes de la cámara térmica
- 🚨 Recibir alertas automáticas ante condiciones anómalas
- 📈 Analizar tendencias y comportamiento de las variables monitoreadas
- 📈 Predicción del aqi en una hora

---

## 🔧 Hardware Utilizado

### 🌡️ Cámaras Térmicas
Capturan imágenes infrarrojas del entorno para identificar variaciones de temperatura que podrían indicar situaciones de riesgo. Los datos son procesados y enviados al sistema para su visualización en el dashboard.

### 🌦️ Estación Meteorológica Davis
Sensor Davis utilizado para la recolección de variables ambientales como:
- Temperatura y humedad
- Precipitación


Toda la información del sensor es capturada de forma continua y almacenada para su análisis.
La estación se encuentra en la Isla de Datos Urbanos en la Escuela Superior de Cómputo

---

## 🗄️ Base de Datos: Supabase

Toda la información del sistema es almacenada en **Supabase**, una plataforma de base de datos en la nube basada en PostgreSQL. Esto permite:

- Almacenamiento persistente y seguro de las lecturas de los sensores
- Consultas en tiempo real desde el dashboard
- Acceso remoto a los datos históricos
- Escalabilidad para grandes volúmenes de registros

---

## 🛠️ Tecnologías

| Componente | Tecnología |
|---|---|
| Base de datos | Supabase (PostgreSQL) |
| Sensor meteorológico | Davis Instruments |
| Captura térmica | Cámara Termográfica |
| Dashboard | Aplicación Web |

---

## 📁 Estructura del Repositorio

```
TT-2026-A021/
├── backend/          # Lógica del servidor y conexión con sensores
├── frontend/         # Interfaz del dashboard
├── database/         # Scripts y esquemas de Supabase
├── docs/             # Documentación y recursos del proyecto
└── README.md
```

---

## 👥 Equipo

Proyecto Terminal Final — Generación 2026
**Instituto Politécnico Nacional — ESCOM**
Número de proyecto: **2026-A021**

---

## 📄 Licencia

Este proyecto fue desarrollado con fines académicos para el Instituto Politécnico Nacional.
