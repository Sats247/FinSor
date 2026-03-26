"""
calc.py — Pure Python financial math engine.
No LLM involvement. All inputs and outputs are plain Python numbers.
"""

from datetime import datetime, date


def future_value_sip(pmt, annual_rate, months):
    """FV of a SIP: PMT × [((1 + r)^n - 1) / r] × (1 + r)"""
    r = annual_rate / 12 / 100
    if r == 0:
        return pmt * months
    return pmt * (((1 + r) ** months - 1) / r) * (1 + r)


def future_value_lump(pv, annual_rate, years):
    """FV of a lump sum: PV × (1 + r)^n"""
    return pv * ((1 + annual_rate / 100) ** years)


def real_return_rate(nominal_rate, inflation_rate):
    """Real return: ((1 + nominal) / (1 + inflation)) - 1"""
    return ((1 + nominal_rate / 100) / (1 + inflation_rate / 100)) - 1


def goal_seek_sip(fv, annual_rate, months):
    """PMT required to reach FV: FV × r / [((1 + r)^n - 1) × (1 + r)]"""
    r = annual_rate / 12 / 100
    if r == 0:
        return fv / months
    return fv * r / (((1 + r) ** months - 1) * (1 + r))


def cagr(start_value, end_value, years):
    """CAGR: (End / Start)^(1/years) - 1"""
    if start_value <= 0 or years <= 0:
        return 0
    return (end_value / start_value) ** (1 / years) - 1


def base_risk_score(age, willingness_score):
    """
    Composite risk score 1-10.
    Base = 100 - age, capacity = base / 10, blended with willingness.
    """
    capacity = max(1, min(10, (100 - age) / 10))
    blended = capacity * 0.6 + willingness_score * 0.4
    return min(10, max(1, round(blended)))


def classify_tax(purchase_date_str):
    """
    Returns ('LTCG', days_held) or ('STCG', days_held).
    LTCG threshold: >= 365 days for equity.
    """
    try:
        purchase = datetime.strptime(purchase_date_str, '%Y-%m-%d').date()
        days = (date.today() - purchase).days
        label = 'LTCG' if days >= 365 else 'STCG'
        return label, days
    except Exception:
        return 'STCG', 0


def portfolio_health_score(holdings):
    """
    Score 0-100 based on:
    - Diversification (number of unique types): up to 35 pts
    - Tax efficiency (% LTCG holdings): up to 35 pts
    - Expense ratio (penalise high ERs): up to 30 pts
    Returns integer 0-100.
    """
    if not holdings:
        return 0

    total = len(holdings)

    # Diversification — unique asset types
    types = set(h.get('type', 'stock') for h in holdings)
    diversification_score = min(35, len(types) * 12)

    # Tax efficiency — proportion of LTCG holdings
    ltcg_count = sum(1 for h in holdings if h.get('tax_label') == 'LTCG')
    tax_score = round((ltcg_count / total) * 35)

    # Expense ratio — based on avg ER (lower is better)
    ers = [h.get('expense_ratio', 0.5) for h in holdings if h.get('expense_ratio') is not None]
    if ers:
        avg_er = sum(ers) / len(ers)
        # 0% ER → 30pts, 1%+ → 0pts
        er_score = max(0, round(30 - avg_er * 30))
    else:
        er_score = 20  # neutral

    return min(100, diversification_score + tax_score + er_score)


def days_to_march31():
    """Returns calendar days from today to the next 31 March (tax year end)."""
    today = date.today()
    march31 = date(today.year if today.month < 4 else today.year + 1, 3, 31)
    return (march31 - today).days


def sip_year_by_year(pmt, annual_rate, years):
    """Returns list of FV values at each year from 1 to `years`."""
    return [round(future_value_sip(pmt, annual_rate, y * 12)) for y in range(1, years + 1)]


def lump_year_by_year(pv, annual_rate, years):
    """Returns list of FV values at each year from 1 to `years`."""
    return [round(future_value_lump(pv, annual_rate, y)) for y in range(1, years + 1)]


def sensitivity_analysis(pmt, rate, months):
    """
    Returns normalised sensitivity weights for three factors:
    SIP amount, time horizon, return rate.
    Each is the % change in FV per 1% change in the factor.
    Returns dict with weights summing to 1.0.
    """
    base = future_value_sip(pmt, rate, months)
    if base == 0:
        return {'sip_amount_impact': 0.33, 'time_horizon_impact': 0.33, 'return_rate_impact': 0.34}

    delta_pmt = abs(future_value_sip(pmt * 1.01, rate, months) - base) / base
    delta_months = abs(future_value_sip(pmt, rate, months + 1) - base) / base
    delta_rate = abs(future_value_sip(pmt, rate + 0.01, months) - base) / base

    total = delta_pmt + delta_months + delta_rate
    if total == 0:
        return {'sip_amount_impact': 0.33, 'time_horizon_impact': 0.33, 'return_rate_impact': 0.34}

    return {
        'sip_amount_impact': round(delta_pmt / total, 2),
        'time_horizon_impact': round(delta_months / total, 2),
        'return_rate_impact': round(delta_rate / total, 2),
    }
