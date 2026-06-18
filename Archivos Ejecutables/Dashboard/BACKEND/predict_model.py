import json
import sys
from pathlib import Path

import pandas as pd
import xgboost as xgb

root = Path(__file__).resolve().parent
model_path = root / 'modelo_humo_escom.json'
meta_path = root / 'metadata_humo.json'

model = xgb.XGBRegressor()
model.load_model(str(model_path))

with meta_path.open('r', encoding='utf-8') as f:
    meta = json.load(f)

columns = meta['columnas_entrenamiento']
threshold = float(meta.get('umbral_anomalia', 0))

payload = json.loads(sys.stdin.read() or '{}')
if not payload:
    raise ValueError('No se recibieron características para predecir')

missing = [c for c in columns if c not in payload]
if missing:
    raise ValueError(f'Faltan características obligatorias: {missing}')

X = pd.DataFrame([payload], columns=columns)
prediction = float(model.predict(X)[0])

output = {
    'modelName': model_path.name,
    'prediction': prediction,
    'threshold': threshold,
    'columns': columns,
}

print(json.dumps(output))
