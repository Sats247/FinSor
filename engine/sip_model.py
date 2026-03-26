"""
sip_model.py — RandomForestRegressor-based ETF SIP allocation engine.

Supports two training modes:
  1. SYNTHETIC  — generated internally when no CSV is present.
  2. CSV-TRAINED — from an uploaded merged_etf_data.csv file.

Auto-detected CSV formats
─────────────────────────
Format A — Direct training labels:
  Columns: Age, Risk_Score, BANK, GOLD, NIFTY, SILVER
  ETF columns can be fractions (0-1) or percentages (0-100); auto-normalised.

Format B — Price history (OHLCV or closing prices):
  Columns: Date, NIFTY, BANK, GOLD, SILVER   (any order, case-insensitive)
  Engine computes daily returns → Sharpe ratios → optimal weights per profile.
"""

import logging
import os
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor

logger = logging.getLogger(__name__)

# ─── Constants ─────────────────────────────────────────────────────────────────
ETF_KEYS       = ['BANK', 'GOLD', 'NIFTY', 'SILVER']
CSV_PATH       = os.path.join(os.path.dirname(__file__), '..', 'merged_etf_data.csv')
REQUIRED_PRICE_COLS = {'nifty', 'bank', 'gold', 'silver'}
REQUIRED_LABEL_COLS = {'age', 'risk_score', 'bank', 'gold', 'nifty', 'silver'}

# ─── Default centroid weights per profile ──────────────────────────────────────
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
# CSV PARSING — auto-detects format A or B
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_csv_format(df: pd.DataFrame) -> str:
    """Returns 'labels' (Format A) or 'prices' (Format B) or raises ValueError."""
    cols = {c.lower().strip() for c in df.columns}
    if REQUIRED_LABEL_COLS.issubset(cols):
        return 'labels'
    if REQUIRED_PRICE_COLS.issubset(cols):
        return 'prices'
    raise ValueError(
        f"CSV columns {list(df.columns)} do not match either expected format.\n"
        "Format A needs: Age, Risk_Score, BANK, GOLD, NIFTY, SILVER\n"
        "Format B needs: Date, NIFTY, BANK, GOLD, SILVER (plus any others)"
    )


def _load_format_a(df: pd.DataFrame) -> tuple:
    """Direct training labels: (Age, Risk_Score) → ETF weights."""
    df.columns = [c.lower().strip() for c in df.columns]
    df = df.dropna(subset=['age', 'risk_score', 'bank', 'gold', 'nifty', 'silver'])
    df['age']        = pd.to_numeric(df['age'],        errors='coerce').clip(18, 65)
    df['risk_score'] = pd.to_numeric(df['risk_score'], errors='coerce').clip(1, 10)
    df = df.dropna(subset=['age', 'risk_score'])

    weights_raw = df[['bank', 'gold', 'nifty', 'silver']].apply(pd.to_numeric, errors='coerce').fillna(0)

    # Auto-detect % vs fraction: if any value > 1.5, treat entire column as pct
    if (weights_raw > 1.5).any().any():
        weights_raw = weights_raw / 100.0

    weights_raw = weights_raw.clip(0, None)
    row_sums    = weights_raw.sum(axis=1).replace(0, np.nan)
    weights_raw = weights_raw.div(row_sums, axis=0).dropna()

    good_idx = weights_raw.index
    X = df.loc[good_idx, ['age', 'risk_score']].values.astype(float)
    # Reorder columns to match ETF_KEYS = ['BANK','GOLD','NIFTY','SILVER']
    Y = weights_raw[['bank', 'gold', 'nifty', 'silver']].values

    return X, Y


def _load_format_b(df: pd.DataFrame) -> tuple:
    """
    Price history → derive profile-optimal weights via Sharpe ratio.
    Generates synthetic (Age, Risk) training rows calibrated to those weights.
    """
    df.columns = [c.lower().strip() for c in df.columns]

    # Parse prices
    price_cols = ['nifty', 'bank', 'gold', 'silver']
    prices = df[price_cols].apply(pd.to_numeric, errors='coerce').dropna()

    if len(prices) < 30:
        raise ValueError("Price history CSV needs at least 30 rows of price data.")

    # Daily returns
    returns  = prices.pct_change().dropna()
    ann_ret  = returns.mean() * 252
    ann_vol  = returns.std() * np.sqrt(252)
    sharpe   = (ann_ret / ann_vol.replace(0, np.nan)).fillna(0).clip(0, None)

    # Compute profile weights: base centroids tempered by relative Sharpe scores
    profile_overrides = {}
    for prof, base_dict in _PROFILE_WEIGHTS.items():
        base = np.array([base_dict[k.upper()] for k in price_cols])
        # Blend 60% base + 40% sharpe-proportional
        sharpe_w = sharpe.values / (sharpe.values.sum() or 1)
        blended  = 0.60 * base + 0.40 * sharpe_w
        blended  = np.clip(blended, 0, None)
        blended /= blended.sum()
        # Order: BANK, GOLD, NIFTY, SILVER
        profile_overrides[prof] = {
            'BANK':   float(blended[1]),
            'GOLD':   float(blended[3]),
            'NIFTY':  float(blended[0]),
            'SILVER': float(blended[2]),
        }

    # Generate 2,000 synthetic (Age, Risk) rows calibrated to these weights
    rng  = np.random.default_rng(42)
    n    = 2000
    ages = rng.integers(18, 66, n)
    risks = rng.integers(1, 11, n)
    X = np.column_stack([ages, risks])
    Y = np.zeros((n, 4))

    for i, risk in enumerate(risks):
        prof = _profile(int(risk))
        w    = profile_overrides[prof]
        base = np.array([w['BANK'], w['GOLD'], w['NIFTY'], w['SILVER']])
        noise = rng.normal(0, 0.015, 4)
        w_arr = np.clip(base + noise, 0, None)
        Y[i]  = w_arr / w_arr.sum()

    return X, Y


def load_csv_training_data(csv_path: str) -> tuple:
    """
    Public entry point for loading a CSV.
    Returns (X, Y, format_detected, n_rows, stats) where
    stats is a dict of computed metrics shown in the UI.
    """
    df  = pd.read_csv(csv_path)
    fmt = _detect_csv_format(df)
    logger.info(f"SIPModel: CSV detected as format '{fmt}' — {len(df)} rows")

    if fmt == 'labels':
        X, Y = _load_format_a(df)
        stats = {
            'format':  'Direct training labels',
            'rows':    len(X),
            'columns': list(df.columns),
        }
    else:
        X, Y = _load_format_b(df)
        df.columns = [c.lower().strip() for c in df.columns]
        prices = df[['nifty','bank','gold','silver']].apply(pd.to_numeric, errors='coerce').dropna()
        rets   = prices.pct_change().dropna()
        stats  = {
            'format':  'Price history',
            'rows':    len(prices),
            'columns': list(df.columns),
            'cagr': {
                'NIFTY':  round(float(rets['nifty'].mean()  * 252 * 100), 2),
                'BANK':   round(float(rets['bank'].mean()   * 252 * 100), 2),
                'GOLD':   round(float(rets['gold'].mean()   * 252 * 100), 2),
                'SILVER': round(float(rets['silver'].mean() * 252 * 100), 2),
            },
            'vol': {
                'NIFTY':  round(float(rets['nifty'].std()  * np.sqrt(252) * 100), 2),
                'BANK':   round(float(rets['bank'].std()   * np.sqrt(252) * 100), 2),
                'GOLD':   round(float(rets['gold'].std()   * np.sqrt(252) * 100), 2),
                'SILVER': round(float(rets['silver'].std() * np.sqrt(252) * 100), 2),
            },
        }

    return X, Y, fmt, stats


# ═══════════════════════════════════════════════════════════════════════════════
# SYNTHETIC TRAINING DATA (fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def _generate_synthetic(n: int = 2000) -> tuple:
    rng = np.random.default_rng(42)
    ages  = rng.integers(18, 66, n)
    risks = rng.integers(1, 11, n)
    X = np.column_stack([ages, risks])
    Y = np.zeros((n, 4))
    for i, risk in enumerate(risks):
        prof = _profile(int(risk))
        w    = _PROFILE_WEIGHTS[prof]
        base = np.array([w['BANK'], w['GOLD'], w['NIFTY'], w['SILVER']])
        noise = rng.normal(0, 0.015, 4)
        b     = np.clip(base + noise, 0, None)
        Y[i]  = b / b.sum()
    return X, Y


# ═══════════════════════════════════════════════════════════════════════════════
# SIPModel class
# ═══════════════════════════════════════════════════════════════════════════════

class SIPModel:
    def __init__(self):
        self._models:  list[RandomForestRegressor] = []
        self._trained: bool  = False
        self.source:   str   = 'none'     # 'synthetic' | 'csv_labels' | 'csv_prices'
        self.csv_stats: dict = {}
        self.n_samples: int  = 0

    # ── Core train method ───────────────────────────────────────────────────────
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

    # ── Train on startup (synthetic or auto-load CSV if present) ───────────────
    def train(self):
        csv = os.path.abspath(CSV_PATH)
        if os.path.isfile(csv):
            try:
                X, Y, fmt, stats = load_csv_training_data(csv)
                self._fit(X, Y)
                self.source     = f'csv_{fmt}'
                self.csv_stats  = stats
                logger.info(f"SIPModel: trained on CSV ({fmt}, {len(X)} rows)")
                return
            except Exception as e:
                logger.warning(f"SIPModel: CSV load failed ({e}), falling back to synthetic.")

        X, Y = _generate_synthetic(2000)
        self._fit(X, Y)
        self.source    = 'synthetic'
        self.csv_stats = {}
        logger.info("SIPModel: trained on synthetic data.")

    # ── Retrain on a freshly uploaded CSV (called from Flask route) ─────────────
    def retrain_from_csv(self, csv_path: str) -> dict:
        """
        Trains the model on `csv_path` in-place. Returns stats dict for the API response.
        Raises ValueError on bad CSV so the route can return a user-friendly error.
        """
        X, Y, fmt, stats = load_csv_training_data(csv_path)
        self._fit(X, Y)
        self.source    = f'csv_{fmt}'
        self.csv_stats = stats
        logger.info(f"SIPModel: retrained from CSV ({fmt}, {len(X)} rows).")
        return stats

    # ── Predict ─────────────────────────────────────────────────────────────────
    def predict(self, age: int, risk: int) -> dict:
        if not self._trained:
            logger.warning("SIPModel: not trained — using rule-based fallback.")
            prof = _profile(risk)
            w    = _PROFILE_WEIGHTS[prof]
            raw  = np.array([w['BANK'], w['GOLD'], w['NIFTY'], w['SILVER']])
        else:
            X_in = np.array([[age, risk]])
            raw  = np.array([m.predict(X_in)[0] for m in self._models])

        raw = np.clip(raw, 0, None)
        s   = raw.sum()
        if s == 0:
            raw = np.array([0.25, 0.25, 0.25, 0.25])
            s   = 1.0
        weights = raw / s
        return {key: float(weights[i]) for i, key in enumerate(ETF_KEYS)}


# ─── Module-level singleton ─────────────────────────────────────────────────────
_sip_model = SIPModel()


def get_model() -> SIPModel:
    if not _sip_model._trained:
        _sip_model.train()
    return _sip_model
