# AquaDepth — Water Depth Forecasting System

Real-time water-depth forecasting for Indian water bodies (ocean, rivers, lakes, reservoirs), with an Apple-style web app,
physics-guided ML forecasts, flood warnings, and honest validation against real tide gauges.

> **Data honesty.** No public depth-gauge network exists, so training depth labels are *physics-simulated* from **real**
> drivers (ERA5 rainfall, Open-Meteo marine sea level, GloFAS discharge). Bathymetry, rivers, state borders, lakes and
> cyclone tracks are real. INCOIS / IMD / India-WRIS data are **not** integrated (they need registration). The ML Lab and
> Validation pages report every metric, including the ones that miss the project targets.

## What's inside

| Area | Features |
|---|---|
| **Map** | Smooth bathymetry (NOAA ETOPO), real rivers & state borders (Natural Earth), 1,399 real lakes/reservoirs (OpenStreetMap), cyclone tracks (IBTrACS), 48 h rain/wave/wind time-scrubber, "survey priority" layer, Apple-style layers sheet and draggable place card |
| **Forecast / Detail** | 1–48 h ML forecast with P10–P90 band, depth-fusion breakdown, tide, flood risk, weather, printable report |
| **Tools** | Watchlist (share links, CSV, risk notifications), Compare, Safety advisor, ⌘K command palette, installable PWA |
| **ML Lab** | 3 models (static depth, forecast, flood warning), baselines, live demo, active-learning survey list |
| **Validation** | Real UHSLC tide-gauge comparison, tide-timing error, cyclone case study |
| **Developers** | Copy-able API snippets and a live "Try it" box (`/api/docs` for OpenAPI) |

## Quick start

Requires Python 3.12+ and Node 20+.

```bash
# Backend
cd backend
python3 -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env                            # optional keys; app works without them
python -m uvicorn app.main:app --port 7860

# Frontend (second terminal)
cd frontend
npm install --legacy-peer-deps
npm run dev                                           # http://localhost:5173 (proxies /api to :7860)
```

Trained models, bathymetry grids, river/state/lake/cyclone data and validation results are **committed**, so nothing needs
training or downloading to run. Rebuild scripts (all in `backend/scripts/`, free and keyless):
`fetch_etopo.py`, `build_dataset.py` (3 years of training drivers), `python -m app.ml.train`, `build_waterbodies.py`,
`build_cyclones.py`, `build_validation.py`.

## API highlights

```bash
curl -X POST http://localhost:7860/api/forecast \
  -H 'content-type: application/json' \
  -d '{"digipin": "F2CJ4JCM4M", "timestamp": "2026-11-13T14:30"}'      # 48 h ML forecast (~ms of model time)
```

| Endpoint | Purpose |
|---|---|
| `POST /api/forecast`, `/api/v1/ml/forecast` | 1–48 h depth forecast + P10/P90 band |
| `POST /api/v1/ml/flood` | Flood-warning probability with ensemble uncertainty |
| `POST /api/v1/ml/static-depth`, `GET /api/v1/ml/survey-priority` | Static depth model; where it is least certain |
| `GET /api/v1/ml/overview` | Metrics, latency, model size |
| `GET /api/v1/safety?digipin=&activity=` | Rule-based go/no-go advisory (not an official warning) |
| `GET /api/v1/validation/*` | Real tide-gauge validation |
| `GET /api/v1/forecast-grid?var=rain\|wave\|wind` | Gridded forecast for the map scrubber |
| `GET /api/v1/cyclones/*`, `/waterbodies/*`, `/map/*`, `/bathymetry/*` | Map data |
| `POST /api/v1/depth/current`, `GET /api/v1/alerts/active`, `/api/v1/system/status` | Core data, alerts, source health |

## Models (measured on held-out data — see ML Lab / Validation)

| Task | Algorithm | Result | Brief target |
|---|---|---|---|
| Static depth | XGBoost on real ETOPO, sparse samples | ~150 m shelf MAE in unseen regions | 0.3 m — **not met** (needs 10–100 m surveys) |
| 1–48 h forecast | XGBoost direct multi-horizon + quantiles | 0.08–0.13 m MAE, 3–4× better than persistence | tide timing < 15 min — **not met** (63 min vs real gauges) |
| Flood warning | Bootstrap XGBoost ensemble | precision 44 %, recall 34 % (6 % base rate) | precision > 0.85 — **not met** |

Not implemented: GNNs, GANs, drought detection, ConvLSTM/transformer variants.

## Tests

```bash
cd frontend
npx playwright install chromium      # first time
npm run test:e2e                     # API + desktop + mobile (needs backend :7860 and `npm run dev` running)
```

## Deploy

```bash
docker build -t aquadepth . && docker run -p 7860:7860 --env-file .env aquadepth
```

## Data sources

Open-Meteo (weather, marine, GloFAS flood, ERA5), NOAA ETOPO via ERDDAP, Natural Earth, OpenStreetMap (ODbL),
NOAA IBTrACS, UH Sea Level Center tide gauges. Optional: StormGlass and OpenTopography keys.
Not used (registration needed): INCOIS, IMD gridded rainfall, India-WRIS, Copernicus Marine, NASA SWOT, Sentinel.

## License

MIT
