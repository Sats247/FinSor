"""
risk_engine.py — Market regime detection, MMI score, macro adjustments, and fund recommendations.
All math is deterministic Python. No LLM.
"""

import json
import logging
import os
from engine.calc import base_risk_score

logger = logging.getLogger(__name__)


# ─── Risk Category ────────────────────────────────────────────────────────────

RISK_CATEGORIES = ['Conservative', 'Moderate', 'Balanced', 'Growth', 'Aggressive']

RISK_SCORE_MAP = {
    (1, 2): 'Conservative',
    (3, 4): 'Moderate',
    (5, 6): 'Balanced',
    (7, 8): 'Growth',
    (9, 10): 'Aggressive',
}


def calculate_risk_category(risk_score):
    """Maps score 1-10 to category string."""
    if risk_score <= 2:
        return 'Conservative'
    if risk_score <= 4:
        return 'Moderate'
    if risk_score <= 6:
        return 'Balanced'
    if risk_score <= 8:
        return 'Growth'
    return 'Aggressive'


def _step_conservative(category):
    """Nudges risk category one step towards Conservative."""
    idx = RISK_CATEGORIES.index(category)
    return RISK_CATEGORIES[max(0, idx - 1)]


# ─── Market Regime ────────────────────────────────────────────────────────────

def get_market_regime(vix, nifty, nifty_200dma):
    """
    Determines market regime from VIX and Nifty vs 200DMA.
    Returns: (regime_label, mmi_score)
    """
    if vix is None or nifty is None or nifty_200dma is None:
        return 'Neutral', 50

    if vix < 12 and nifty > nifty_200dma:
        regime = 'Overheated'
    elif vix < 15 and nifty > nifty_200dma:
        regime = 'Bull'
    elif vix > 25 and nifty < nifty_200dma:
        regime = 'Bear'
    else:
        regime = 'Neutral'

    mmi = get_mmi_score(vix, nifty, nifty_200dma)
    return regime, mmi


def get_mmi_score(vix, nifty, nifty_200dma):
    """
    Market Mood Index 0–100 (Fear → Greed).
    Low VIX + Nifty above 200DMA → high score (Greed).
    High VIX + Nifty below 200DMA → low score (Fear).
    """
    if vix is None or nifty is None or nifty_200dma is None:
        return 50

    # VIX component: VIX 8 → 100pts, VIX 35+ → 0pts
    vix_clamped = max(8, min(35, vix))
    vix_score = (35 - vix_clamped) / (35 - 8) * 100

    # Nifty vs 200DMA component: deviation ±10%
    if nifty_200dma > 0:
        deviation_pct = (nifty - nifty_200dma) / nifty_200dma * 100
    else:
        deviation_pct = 0
    deviation_clamped = max(-10, min(10, deviation_pct))
    dma_score = (deviation_clamped + 10) / 20 * 100

    # Blend 60% VIX, 40% DMA deviation
    mmi = round(vix_score * 0.6 + dma_score * 0.4)
    return max(0, min(100, mmi))


def get_mmi_label(mmi_score):
    """Maps MMI score to a human label."""
    if mmi_score < 20:
        return 'Extreme Fear'
    if mmi_score < 40:
        return 'Fear'
    if mmi_score < 60:
        return 'Neutral'
    if mmi_score < 80:
        return 'Greed'
    return 'Extreme Greed'


def get_regime_summary(regime, mmi_label):
    summaries = {
        'Bull': 'Market is leaning towards bullish momentum. Mid-caps showing strength.',
        'Bear': 'Markets are under pressure. Capital preservation is key in this environment.',
        'Neutral': 'Mixed signals. Systematic investing via SIPs is advisable.',
        'Overheated': 'Valuations are stretched. Exercise caution with fresh lump-sum entries.',
    }
    return summaries.get(regime, 'Market conditions are mixed.')


# ─── Macro Adjustment ─────────────────────────────────────────────────────────

def apply_macro_adjustment(risk_category, macro_signals):
    """
    Applies nudges based on live macro signals.
    Returns (adjusted_category, [reason_strings])
    """
    if not macro_signals:
        return risk_category, []

    adjustments = []
    adjusted = risk_category

    vix = macro_signals.get('india_vix', {}).get('value')
    nifty = macro_signals.get('nifty50', {}).get('value')
    nifty_200dma = macro_signals.get('nifty_200dma')

    if vix is not None and vix > 20:
        adjusted = _step_conservative(adjusted)
        adjustments.append(f"VIX elevated at {vix:.1f} — shifted one step conservative")

    if nifty and nifty_200dma and nifty < nifty_200dma:
        if 'Bear — add capital preservation note' not in adjustments:
            adjustments.append("Nifty below 200DMA — capital preservation note added")

    if vix is not None and vix < 12 and nifty and nifty_200dma and nifty > nifty_200dma:
        adjustments.append("Market appears overheated — valuation caution recommended")

    return adjusted, adjustments


# ─── Fund Recommendations ─────────────────────────────────────────────────────

def _load_funds():
    """Loads funds.json from data directory."""
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    funds_path = os.path.join(base_dir, 'data', 'funds.json')
    with open(funds_path, 'r') as f:
        return json.load(f)


def recommend_funds(risk_category, investment_type, macro_signals, db_conn=None, user_id=None):
    """
    Filters funds.json by risk_category and investment_type.
    Applies macro adjustment (VIX > 20 nudges one step conservative).
    Appends live NAV from AMFI.
    Returns dict with funds list, projection, health, and meta.
    """
    from engine.data_fetch import get_fund_nav

    funds = _load_funds()

    # Apply macro adjustment
    adjusted_category, nudge_reasons = apply_macro_adjustment(risk_category, macro_signals)
    nudge_applied = adjusted_category != risk_category

    # Filter by adjusted category and investment type
    filtered = [
        f for f in funds
        if f.get('risk_category') == adjusted_category
        and investment_type in f.get('types', [])
    ]

    # Fallback: if too few, widen to neighbour categories
    if len(filtered) < 3:
        all_cats = RISK_CATEGORIES
        idx = all_cats.index(adjusted_category)
        for neighbour_idx in [idx - 1, idx + 1, idx - 2, idx + 2]:
            if 0 <= neighbour_idx < len(all_cats):
                neighbour = all_cats[neighbour_idx]
                extras = [
                    f for f in funds
                    if f.get('risk_category') == neighbour
                    and investment_type in f.get('types', [])
                    and f not in filtered
                ]
                filtered.extend(extras)
            if len(filtered) >= 3:
                break

    selected = filtered[:3]

    # Append live NAV
    for fund in selected:
        amfi_code = fund.get('amfi_code')
        if amfi_code:
            try:
                nav_data = get_fund_nav(amfi_code)
                if nav_data:
                    fund['nav'] = nav_data['nav']
                    fund['nav_date'] = nav_data['nav_date']
                else:
                    fund['nav'] = None
                    fund['nav_date'] = None
            except Exception:
                fund['nav'] = None
                fund['nav_date'] = None
        else:
            fund['nav'] = None
            fund['nav_date'] = None

    # Log recommendation to audit_log
    if db_conn and user_id:
        try:
            fund_names = ', '.join(f.get('name', '') for f in selected)
            db_conn.execute(
                '''INSERT INTO audit_log (user_id, action, risk_category, recommended_funds, macro_context, reason)
                   VALUES (?, 'fund_recommendation', ?, ?, ?, ?)''',
                (user_id, risk_category, fund_names,
                 str(macro_signals.get('india_vix', {}).get('value')),
                 '; '.join(nudge_reasons))
            )
            db_conn.commit()
        except Exception as e:
            logger.error(f"Audit log failed: {e}")

    return {
        'risk_category': risk_category,
        'adjusted_category': adjusted_category,
        'macro_nudge_applied': nudge_applied,
        'nudge_reason': nudge_reasons[0] if nudge_reasons else None,
        'investment_type': investment_type,
        'funds': selected,
    }


def calculate_risk_score_from_answers(answers):
    """
    Converts onboarding answers to a risk score 1-10.
    answers keys: crash_reaction, age, goal, horizon, monthly_amount, experience
    """
    # Willingness from crash reaction
    reaction_map = {
        'sell_all': 1,
        'sell_some': 3,
        'hold': 6,
        'buy_more': 10,
    }
    willingness = reaction_map.get(answers.get('crash_reaction', 'hold'), 5)

    # Horizon bonus
    horizon_map = {'lt1': 0, '1to3': 1, '3to7': 2, 'gt7': 3}
    horizon_bonus = horizon_map.get(answers.get('horizon', '3to7'), 1)

    # Goal adjustment
    goal_map = {'preservation': -1, 'income': 0, 'balanced': 1, 'wealth': 2}
    goal_adj = goal_map.get(answers.get('goal', 'balanced'), 0)

    # Experience adjustment
    exp_map = {'beginner': -1, 'some': 0, 'comfortable': 1, 'experienced': 2}
    exp_adj = exp_map.get(answers.get('experience', 'some'), 0)

    age = int(answers.get('age', 35))
    base = base_risk_score(age, willingness)
    raw = base + horizon_bonus + goal_adj + exp_adj
    score = max(1, min(10, round(raw)))

    # Experience label
    exp_label_map = {
        'beginner': 'Beginner',
        'some': 'Beginner',
        'comfortable': 'Intermediate',
        'experienced': 'Experienced',
    }
    experience_level = exp_label_map.get(answers.get('experience', 'some'), 'Beginner')

    return score, calculate_risk_category(score), experience_level
