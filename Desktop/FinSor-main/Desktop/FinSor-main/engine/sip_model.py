"""
sip_model.py — ETF SIP allocation engine.

Two operating modes
───────────────────
SYNTHETIC  : No CSV present. Uses direct linear interpolation between three
             hardcoded profile centroids (conservative / moderate / aggressive).
             The RandomForest is NOT used in this mode — it produced wrong outputs
             because synthetic noise swamped the signal at cluster boundaries.

CSV-TRAINED: A merged_etf_data.csv is present (or uploaded).
             Supports two formats:
               Format A — Direct labels: Age, Risk_Score, BANK, GOLD, NIFTY, SILVER
               Format B — Price history: Date, NIFTY, BANK, GOLD, SILVER
             A RandomForestRegressor is trained on real data in this mode.
"""

import logging
import os
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

logger = logging.getLogger(__name__)

# ─── Constants ─────────────────────────────────────────────────────────────────
ETF_KEYS = ['BANK', 'GOLD', 'NIFTY', 'SILVER']
CSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'merged_etf_data.csv')
REQUIRED_PRICE_COLS = {'nifty', 'bank', 'gold', 'silver'}
REQUIRED_LABEL_COLS = {'age', 'risk_score', 'bank', 'gold', 'nifty', 'silver'}
MIN_SHARPE_ROWS     = 60   # columns with fewer rows have unreliable Sharpe

# ─── Profile centroids ─────────────────────────────────────────────────────────
_PROFILE_WEIGHTS = {
    'aggressive':   {'BANK': 0.30, 'GOLD': 0.05, 'NIFTY': 0.40, 'SILVER': 0.25},
    'moderate':     {'BANK': 0.20, 'GOLD': 0.15, 'NIFTY': 0.50, 'SILVER': 0.15},
    'conservative': {'BANK': 0.10, 'GOLD': 0.50, 'NIFTY': 0.35, 'SILVER': 0.05},
}


def _profile(risk: int) -> str:
    if risk >= 8:  return 'aggressive'
    if risk >= 5:  return 'moderate'
    return 'conservative'


# ═══════════════════════════════════════════════════════════════════════════════
# INTERPOLATION — used in synthetic mode (no CSV)
# ═══════════════════════════════════════════════════════════════════════════════

def _interpolate_weights(risk: int) -> dict:
    """
    Linear interpolation between profile centroids based on risk score.
    Deterministic, transparent, matches profile labels exactly.
    RF is NOT used here — reserved for real CSV data only.
    """
    cons = _PROFILE_WEIGHTS['conservative']
    mod  = _PROFILE_WEIGHTS['moderate']
    agg  = _PROFILE_WEIGHTS['aggressive']

    if risk <= 4:
        t = (risk - 1) / 3.0 * 0.3
        w = {k: cons[k] + t * (mod[k] - cons[k]) for k in ETF_KEYS}
    elif risk <= 7:
        t = (risk - 4) / 3.0
        w = {k: cons[k] + t * (mod[k] - cons[k]) for k in ETF_KEYS}
    else:
        t = (risk - 7) / 3.0
        w = {k: mod[k] + t * (agg[k] - mod[k]) for k in ETF_KEYS}

    total = sum(w.values())
    return {k: v / total for k, v in w.items()}


# ═══════════════════════════════════════════════════════════════════════════════
# CSV PARSING
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_csv_format(df: pd.DataFrame) -> str:
    cols = {c.lower().strip() for c in df.columns}
    if REQUIRED_LABEL_COLS.issubset(cols):
        return 'labels'
    if REQUIRED_PRICE_COLS.issubset(cols):
        return 'prices'
    raise ValueError(
        f"CSV columns {list(df.columns)} match neither expected format.\n"
        "Format A needs: Age, Risk_Score, BANK, GOLD, NIFTY, SILVER\n"
        "Format B needs: Date, NIFTY, BANK, GOLD, SILVER"
    )


def _load_format_a(df: pd.DataFrame) -> tuple:
    """Direct training labels → (X, Y)."""
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.dropna(subset=['age', 'risk_score', 'bank', 'gold', 'nifty', 'silver'])
    df['age']        = pd.to_numeric(df['age'],        errors='coerce').clip(18, 65)
    df['risk_score'] = pd.to_numeric(df['risk_score'], errors='coerce').clip(1, 10)
    df = df.dropna(subset=['age', 'risk_score'])

    weights_raw = df[['bank', 'gold', 'nifty', 'silver']].apply(
        pd.to_numeric, errors='coerce'
    ).fillna(0)

    if (weights_raw > 1.5).any().any():
        weights_raw = weights_raw / 100.0

    weights_raw = weights_raw.clip(0, None)
    row_sums    = weights_raw.sum(axis=1).replace(0, np.nan)
    weights_raw = weights_raw.div(row_sums, axis=0).dropna()

    good_idx = weights_raw.index
    X = df.loc[good_idx, ['age', 'risk_score']].values.astype(float)
    # ETF_KEYS = ['BANK', 'GOLD', 'NIFTY', 'SILVER']
    Y = weights_raw[['bank', 'gold', 'nifty', 'silver']].values
    return X, Y


def _load_format_b(df: pd.DataFrame) -> tuple:
    """
    Price history → derive profile weights via per-column Sharpe ratio.

    Each ETF's Sharpe is computed from its own full non-null history
    independently. Columns with < MIN_SHARPE_ROWS valid rows are treated as
    unreliable and their Sharpe contribution is zeroed out — the centroid
    weight passes through unchanged for those columns.
    """
    df.columns = [c.lower().strip() for c in df.columns]
    price_cols = ['nifty', 'bank', 'gold', 'silver']  # fixed order

    prices = df[price_cols].apply(pd.to_numeric, errors='coerce')

    if prices.dropna(how='all').shape[0] < 30:
        raise ValueError("Price history CSV needs at least 30 rows of data.")

    # Per-column Sharpe (independent histories)
    sharpe_vals = {}
    reliable    = {}
    for col in price_cols:
        series = prices[col].dropna()
        if len(series) >= MIN_SHARPE_ROWS:
            rets  = series.pct_change().dropna()
            ann_r = rets.mean() * 12        # monthly → annualised
            ann_v = rets.std() * np.sqrt(12)
            s     = ann_r / ann_v if ann_v > 0 else 0.0
            sharpe_vals[col] = max(0.0, float(s))
            reliable[col]    = True
        else:
            sharpe_vals[col] = 0.0
            reliable[col]    = False
            logger.warning(
                f"SIPModel: '{col}' only has {len(series)} rows "
                f"(<{MIN_SHARPE_ROWS}) — Sharpe skipped, centroid used."
            )

    sharpe_arr = np.array([sharpe_vals[c] for c in price_cols])
    total_s    = sharpe_arr.sum()
    sharpe_w   = sharpe_arr / total_s if total_s > 0 else np.full(4, 0.25)

    # Build profile overrides: 70% centroid + 30% Sharpe (reliable cols only)
    profile_overrides = {}
    for prof, base_dict in _PROFILE_WEIGHTS.items():
        # price_cols order: nifty=0, bank=1, gold=2, silver=3
        base = np.array([
            base_dict['NIFTY'],
            base_dict['BANK'],
            base_dict['GOLD'],
            base_dict['SILVER'],
        ])

        sw = sharpe_w.copy()
        for i, col in enumerate(price_cols):
            if not reliable[col]:
                sw[i] = 0.0
        sw_sum = sw.sum()
        if sw_sum > 0:
            sw = sw / sw_sum

        blended = 0.70 * base + 0.30 * sw
        blended = np.clip(blended, 0, None)
        blended /= blended.sum()

        profile_overrides[prof] = {
            'NIFTY':  float(blended[0]),
            'BANK':   float(blended[1]),
            'GOLD':   float(blended[2]),
            'SILVER': float(blended[3]),
        }

    logger.info(f"SIPModel: Format B overrides → {profile_overrides}")

    # Generate calibrated training rows
    rng   = np.random.default_rng(42)
    n     = 2000
    ages  = rng.integers(18, 66, n)
    risks = rng.integers(1, 11, n)
    X     = np.column_stack([ages, risks])
    Y     = np.zeros((n, 4))

    for i, risk in enumerate(risks):
        prof  = _profile(int(risk))
        w     = profile_overrides[prof]
        # ETF_KEYS order = BANK, GOLD, NIFTY, SILVER
        base  = np.array([w['BANK'], w['GOLD'], w['NIFTY'], w['SILVER']])
        noise = rng.normal(0, 0.015, 4)
        w_arr = np.clip(base + noise, 0, None)
        Y[i]  = w_arr / w_arr.sum()

    return X, Y


def load_csv_training_data(csv_path: str) -> tuple:
    """Returns (X, Y, format_str, stats_dict)."""
    df  = pd.read_csv(csv_path)
    fmt = _detect_csv_format(df)
    logger.info(f"SIPModel: CSV format '{fmt}', {len(df)} rows")

    if fmt == 'labels':
        X, Y  = _load_format_a(df)
        stats = {'format': 'Direct training labels', 'rows': len(X),
                 'columns': list(df.columns)}
    else:
        X, Y = _load_format_b(df)
        df.columns = [c.lower().strip() for c in df.columns]
        prices = df[['nifty', 'bank', 'gold', 'silver']].apply(
            pd.to_numeric, errors='coerce')
        stats = {
            'format': 'Price history',
            'rows':   prices.dropna(how='all').shape[0],
            'columns': list(df.columns),
        }
        # Per-column CAGR/vol (each on its own non-null history)
        cagr, vol = {}, {}
        for key, col in [('NIFTY','nifty'),('BANK','bank'),('GOLD','gold'),('SILVER','silver')]:
            s = prices[col].dropna()
            if len(s) > 1:
                r = s.pct_change().dropna()
                cagr[key] = round(float(r.mean()  * 12 * 100), 2)
                vol[key]  = round(float(r.std() * np.sqrt(12) * 100), 2)
            else:
                cagr[key] = vol[key] = 0.0
        stats['cagr'] = cagr
        stats['vol']  = vol

    return X, Y, fmt, stats


# ═══════════════════════════════════════════════════════════════════════════════
# SIPModel class
# ═══════════════════════════════════════════════════════════════════════════════

class SIPModel:
    def __init__(self):
        self._models:   list = []
        self._trained:  bool = False
        self.source:    str  = 'none'
        self.csv_stats: dict = {}
        self.n_samples: int  = 0

    def _fit(self, X: np.ndarray, Y: np.ndarray):
        self._models = []
        for col in range(4):
            rf = RandomForestRegressor(
                n_estimators=120, max_depth=8,
                min_samples_leaf=5, random_state=42, n_jobs=-1,
            )
            rf.fit(X, Y[:, col])
            self._models.append(rf)
        self._trained  = True
        self.n_samples = len(X)

    def train(self):
        csv = os.path.abspath(CSV_PATH)
        if os.path.isfile(csv):
            try:
                X, Y, fmt, stats = load_csv_training_data(csv)
                self._fit(X, Y)
                self.source    = f'csv_{fmt}'
                self.csv_stats = stats
                logger.info(f"SIPModel: trained on CSV ({fmt}, {len(X)} rows)")
                return
            except Exception as e:
                logger.warning(f"SIPModel: CSV load failed ({e}), using interpolation.")

        # No CSV — interpolation mode (no RF needed)
        self._trained  = True
        self.source    = 'synthetic'
        self.csv_stats = {}
        self.n_samples = 0
        logger.info("SIPModel: synthetic/interpolation mode — no CSV.")

    def retrain_from_csv(self, csv_path: str) -> dict:
        X, Y, fmt, stats = load_csv_training_data(csv_path)
        self._fit(X, Y)
        self.source    = f'csv_{fmt}'
        self.csv_stats = stats
        logger.info(f"SIPModel: retrained from CSV ({fmt}, {len(X)} rows)")
        return stats

    def predict(self, age: int, risk: int) -> dict:
        """
        Synthetic mode → direct interpolation (correct, deterministic).
        CSV mode       → RandomForestRegressor on real data.
        """
        if self.source == 'synthetic' or not self._models:
            return _interpolate_weights(risk)

        X_in = np.array([[age, risk]])
        raw  = np.array([m.predict(X_in)[0] for m in self._models])
        raw  = np.clip(raw, 0, None)
        s    = raw.sum()
        if s == 0:
            return _interpolate_weights(risk)
        weights = raw / s
        return {key: float(weights[i]) for i, key in enumerate(ETF_KEYS)}


# ─── Module singleton ──────────────────────────────────────────────────────────
_sip_model = SIPModel()


def get_model() -> SIPModel:
    if not _sip_model._trained:
        _sip_model.train()
    return _sip_model
