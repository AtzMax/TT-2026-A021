import os
import cv2
import threading
import time
import requests
import json

from datetime import datetime
from flask import Flask, Response, jsonify, render_template_string
from flask_cors import CORS
from ultralytics import YOLO
from collections import Counter

os.environ['USE_NNPACK'] = '0'

# =========================================================
# CONFIGURACIÓN
# =========================================================

MODELO = '/home/admin54/proyecto_root/camara/best.pt'

CONFIANZA = 0.5
IMGSZ = 640
CAMERA_INDEX = 1

# Guardado local
SAVE_RAW = True
SAVE_YOLO = True
SAVE_INTERVAL = 1.0

DIRECTORIO_SALIDA = (
    "capturas_servidor/" + datetime.now().strftime("%Y%m%d_%H%M%S")
)

# Backend dashboard
BACKEND_URL = "http://127.0.0.1:3001"

# Nombre de fuente
CAMERA_SOURCE = "escom_isla_cam"

# Intervalos
SEND_METADATA_INTERVAL = 1.0
SEND_VIDEO_INTERVAL = 30.0

# =========================================================
# FLASK
# =========================================================

app = Flask(__name__)
CORS(app)

# =========================================================
# VARIABLES GLOBALES
# =========================================================

ultimo_frame_streaming = None
ultimo_frame_yolo = None
ultimos_metadatos = []

ultima_captura_video = 0
ultima_captura_metadata = 0

lock = threading.Lock()

# =========================================================
# DIRECTORIOS
# =========================================================

ruta_raw = os.path.join(DIRECTORIO_SALIDA, "raw")
ruta_yolo = os.path.join(DIRECTORIO_SALIDA, "yolo")

os.makedirs(ruta_raw, exist_ok=True)
os.makedirs(ruta_yolo, exist_ok=True)

# =========================================================
# CARGA MODELO
# =========================================================

print(f"Cargando modelo YOLO: {MODELO}")

try:
    model = YOLO(MODELO)

except Exception as e:
    print(f"Error cargando modelo personalizado: {e}")
    print("Usando yolov8n.pt")

    model = YOLO("yolov8n.pt")

# =========================================================
# FUNCIONES BACKEND
# =========================================================

def enviar_metadatos_al_backend(detecciones, width, height, fps):

    try:

        metadata = {
            "source": CAMERA_SOURCE,
            "camera": "YOLO Isla Camera",
            "resolution": f"{width}x{height}",
            "fps": fps,
            "quality": "HD",
            "extra": {
                "detecciones_count": len(detecciones),
                "timestamp": datetime.now().isoformat(),
                "detecciones": detecciones[:5]
            }
        }

        response = requests.post(
            f"{BACKEND_URL}/api/video/metadata",
            json=metadata,
            timeout=5
        )

        if response.status_code == 200:
            print(
                f"✓ Metadatos enviados: {len(detecciones)} detecciones"
            )

        else:
            print(
                f"✗ Error enviando metadatos: {response.status_code}"
            )

    except Exception as e:
        print(f"✗ Error conexión backend metadata: {e}")


def enviar_video_al_backend(frame_yolo, metadata_json):

    try:

        ret, buffer = cv2.imencode(".jpg", frame_yolo)

        if not ret:
            return

        frame_bytes = buffer.tobytes()

        headers = {
            "X-Video-Metadata": metadata_json,
            "Content-Type": "image/jpeg"
        }

        response = requests.post(
            f"{BACKEND_URL}/api/video/stream",
            data=frame_bytes,
            headers=headers,
            timeout=10
        )

        if response.status_code == 200:
            print(
                f"✓ Frame enviado ({len(frame_bytes)} bytes)"
            )

        else:
            print(
                f"✗ Error enviando frame: {response.status_code}"
            )

    except Exception as e:
        print(f"✗ Error conexión backend video: {e}")

# =========================================================
# HILO PRINCIPAL CÁMARA + YOLO
# =========================================================

def procesar_camara():

    global ultimo_frame_streaming
    global ultimo_frame_yolo
    global ultimos_metadatos
    global ultima_captura_video
    global ultima_captura_metadata

    cap = cv2.VideoCapture(CAMERA_INDEX)

    if not cap.isOpened():
        print("❌ No se pudo abrir la cámara")
        return

    # FPS robusto
    fps = cap.get(cv2.CAP_PROP_FPS)

    if fps <= 1 or fps > 240:
        fps = 30

    fps = int(fps)

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"📷 Cámara: {width}x{height} @ {fps} FPS")

    ultimo_guardado = 0
    indice_guardado = 0

    while True:

        success, frame = cap.read()

        if not success:
            continue

        t_actual = time.time()

        # =================================================
        # YOLO
        # =================================================

        results = model.predict(
            source=frame,
            conf=CONFIANZA,
            imgsz=IMGSZ,
            verbose=False
        )

        frame_anotado = results[0].plot()

        # =================================================
        # METADATOS
        # =================================================

        detecciones = []

        for box in results[0].boxes:

            detecciones.append({
                "clase": model.names[int(box.cls[0])],
                "confianza": float(box.conf[0]),
                "bbox": box.xyxy[0].tolist()
            })

        # =================================================
        # GUARDADO LOCAL
        # =================================================

        if (t_actual - ultimo_guardado) >= SAVE_INTERVAL:

            timestamp_archivo = datetime.now().strftime(
                "%Y%m%d_%H%M%S_%f"
            )[:-3]

            nombre_archivo = (
                f"frame_{timestamp_archivo}_{indice_guardado:06d}.jpg"
            )

            if SAVE_RAW:
                cv2.imwrite(
                    os.path.join(ruta_raw, nombre_archivo),
                    frame
                )

            if SAVE_YOLO:
                cv2.imwrite(
                    os.path.join(ruta_yolo, nombre_archivo),
                    frame_anotado
                )

            ultimo_guardado = t_actual
            indice_guardado += 1

        # =================================================
        # STREAMING GLOBAL
        # =================================================

        ret, buffer = cv2.imencode(".jpg", frame_anotado)

        if ret:

            with lock:

                ultimo_frame_streaming = buffer.tobytes()
                ultimo_frame_yolo = frame_anotado
                ultimos_metadatos = detecciones

        # =================================================
        # ENVIAR METADATOS
        # =================================================

        if (
            t_actual - ultima_captura_metadata
        ) >= SEND_METADATA_INTERVAL:

            threading.Thread(
                target=enviar_metadatos_al_backend,
                args=(
                    detecciones,
                    width,
                    height,
                    fps
                ),
                daemon=True
            ).start()

            ultima_captura_metadata = t_actual

        # =================================================
        # ENVIAR FRAME
        # =================================================

        if (
            t_actual - ultima_captura_video
        ) >= SEND_VIDEO_INTERVAL and ultimo_frame_yolo is not None:

            metadata_json = json.dumps({
                "source": CAMERA_SOURCE,
                "camera": "YOLO Isla",
                "detecciones": len(detecciones),
                "fps": fps
            })

            threading.Thread(
                target=enviar_video_al_backend,
                args=(
                    ultimo_frame_yolo,
                    metadata_json
                ),
                daemon=True
            ).start()

            ultima_captura_video = t_actual

# =========================================================
# STREAM MJPEG
# =========================================================

def generate_frames():

    while True:

        with lock:

            if ultimo_frame_streaming is not None:

                yield (
                    b'--frame\r\n'
                    b'Content-Type: image/jpeg\r\n\r\n'
                    + ultimo_frame_streaming +
                    b'\r\n'
                )

        time.sleep(0.03)

# =========================================================
# RUTAS
# =========================================================

@app.route("/video_feed")
def video_feed():

    return Response(
        generate_frames(),
        mimetype='multipart/x-mixed-replace; boundary=frame'
    )


@app.route("/metadata")
def metadata():

    with lock:

        return jsonify({
            "detecciones": ultimos_metadatos,
            "count": len(ultimos_metadatos)
        })


@app.route("/status")
def status():

    backend_online = False

    try:

        response = requests.get(
            f"{BACKEND_URL}/api/video/status",
            timeout=2
        )

        backend_online = response.status_code == 200

    except:
        backend_online = False

    with lock:

        # ============================================
        # EXTRAER CLASES
        # ============================================

        clases_detectadas = [
            d["clase"]
            for d in ultimos_metadatos
        ]

        # ============================================
        # CONTAR CLASES
        # ============================================

        conteo_clases = Counter(clases_detectadas)

        personas = conteo_clases.get("persona", 0)
        cigarros = conteo_clases.get("cigarro", 0)

        # ============================================
        # RESPUESTA JSON
        # ============================================

        return jsonify({

            # Estado sistema
            "camera": "online",

            "backend": (
                "online"
                if backend_online
                else "offline"
            ),

            # Información general
            "fuente": CAMERA_SOURCE,
            "backend_url": BACKEND_URL,

            # Total detecciones
            "detecciones_ultimas": len(ultimos_metadatos),

            # Conteo específico
            "personas": personas,
            "cigarros": cigarros,

            # Flags booleanos
            "hay_persona": personas > 0,
            "hay_cigarro": cigarros > 0,

            # Conteo completo dinámico
            "conteo_clases": dict(conteo_clases),

            # Detecciones completas
            "detecciones": ultimos_metadatos
        })


@app.route("/")
def index():

    return render_template_string("""

    <html>

    <head>

        <title>YOLO Dashboard</title>

        <style>

            body {
                background: #111;
                color: white;
                font-family: sans-serif;
                text-align: center;
            }

            .container {
                display: flex;
                justify-content: center;
                gap: 20px;
                padding: 20px;
                flex-wrap: wrap;
            }

            img {
                border-radius: 10px;
                border: 3px solid #333;
                max-width: 800px;
            }

            .panel {
                width: 350px;
                background: #000;
                padding: 10px;
                border-radius: 10px;
                text-align: left;
                overflow-y: auto;
                max-height: 700px;
            }

            pre {
                color: #00ff00;
                font-size: 12px;
            }

        </style>

    </head>

    <body>

        <h1>🎥 YOLO + Flask + Dashboard</h1>

        <div class="container">

            <div>
                <img src="/video_feed">
            </div>

            <div class="panel">

                <h3>Status</h3>
                <pre id="status"></pre>

                <h3>Detecciones</h3>
                <pre id="detecciones"></pre>

            </div>

        </div>

        <script>

            async function actualizar() {

                try {

                    const r1 = await fetch('/status')
                    const status = await r1.json()

                    document.getElementById('status').textContent =
                        JSON.stringify(status, null, 2)

                    const r2 = await fetch('/metadata')
                    const metadata = await r2.json()

                    document.getElementById('detecciones').textContent =
                        JSON.stringify(metadata, null, 2)

                } catch(e) {

                    console.error(e)

                }
            }

            setInterval(actualizar, 1000)

        </script>

    </body>

    </html>

    """)

# =========================================================
# MAIN
# =========================================================

if __name__ == "__main__":

    print("\n====================================")
    print("🎥 YOLO Flask Server")
    print("====================================")

    print(f"📡 Backend: {BACKEND_URL}")
    print(f"📷 Fuente: {CAMERA_SOURCE}")

    print(
        f"✓ Metadata cada {SEND_METADATA_INTERVAL}s"
    )

    print(
        f"✓ Frame cada {SEND_VIDEO_INTERVAL}s"
    )

    print("====================================\n")

    thread = threading.Thread(
        target=procesar_camara,
        daemon=True
    )

    thread.start()

    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False,
        threaded=True
    )
    