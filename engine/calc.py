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


def portfolio_health_score(holdings, user_risk_category='Balanced'):
    """
    Score 0-100 built on three factors:
    1. Risk-adjusted return (40 points)
    2. Concentration Risk (35 points)
    3. Goal Alignment (25 points)
    Capped at 50 if portfolio has real losses or dangerous concentration.
    """
    if not holdings:
        return 0

    total_invested = sum((h.get('purchase_price') or 0) * h.get('quantity', 0) for h in holdings)
    current_value = sum((h.get('current_price') or h.get('purchase_price') or 0) * h.get('quantity', 0) for h in holdings)
    total_pnl = current_value - total_invested
    portfolio_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0

    # 1. Risk-Adjusted Return (40%)
    holding_pnl_pcts = [h.get('pnl_pct', 0) for h in holdings if h.get('pnl_pct') is not None]
    if len(holding_pnl_pcts) > 1:
        import statistics
        stdev = statistics.stdev(holding_pnl_pcts)
    else:
        stdev = 0

    if stdev == 0:
        sharpe = 0.0 if portfolio_pnl_pct < 7 else 1.5
    else:
        sharpe = (portfolio_pnl_pct - 7) / stdev

    risk_adj_score = max(0, min(33.34, sharpe * (33.34 / 1.5)))

    # 2. Concentration Risk (33.33%)
    from collections import defaultdict
    holding_pcts = []
    sector_totals = defaultdict(float)

    for h in holdings:
        val = (h.get('current_price') or h.get('purchase_price') or 0) * h.get('quantity', 0)
        pct = (val / current_value * 100) if current_value else 0
        holding_pcts.append(pct)
        sector = h.get('sector') or h.get('type') or 'Other'
        sector_totals[sector] += val

    max_holding_pct = max(holding_pcts) if holding_pcts else 0
    max_sector_pct = max((v / current_value * 100) for v in sector_totals.values()) if current_value else 0

    conc_score = 33.33
    if max_holding_pct > 30:
        conc_score -= 15
    if max_sector_pct > 45:
        conc_score -= 15
    conc_score = max(0, conc_score)

    # 3. Goal Alignment (33.33%) -> 100 subscore = 33.33 total
    risk_map = {'Conservative': 0, 'Moderate': 1, 'Balanced': 2, 'Growth': 3, 'Aggressive': 4}
    user_idx = risk_map.get(user_risk_category, 2)

    port_risk_val = sum(
        ((4 if h.get('type') == 'stock' else 3 if h.get('type') == 'etf' else 2) *
         ((h.get('current_price') or h.get('purchase_price') or 0) * h.get('quantity', 0) / current_value))
        for h in holdings
    ) if current_value else 2

    port_idx = round(port_risk_val)
    diff = abs(user_idx - port_idx)
    goal_subscore = max(0, 100 - (diff * 25))
    goal_score = goal_subscore * 0.3333

    final_score = risk_adj_score + conc_score + goal_score

    # Value should never fall below 30
    final_score = max(30, final_score)

    # Convert to 5-point scale (out of 33.34)
    rank_risk_adj = round((risk_adj_score / 33.34) * 5, 1)
    rank_conc = round((conc_score / 33.33) * 5, 1)
    rank_goal = round((goal_score / 33.33) * 5, 1)

    factors = [
        {'name': 'Risk-Adjusted Return', 'rating': rank_risk_adj, 'key': 'risk_adj'},
        {'name': 'Concentration Risk', 'rating': rank_conc, 'key': 'concentration'},
        {'name': 'Goal Alignment', 'rating': rank_goal, 'key': 'goal_alignment'}
    ]

    # Sort ascending so the worst rating is first
    factors.sort(key=lambda x: x['rating'])

    improvements = [
        f"Improve {f['name']} (Rating: {f['rating']}/5.0)" for f in factors
    ]

    return {
        'score': round(final_score),
        'breakdown': {
            'risk_adj_return': rank_risk_adj,
            'concentration_risk': rank_conc,
            'goal_alignment': rank_goal
        },
        'improvements': improvements
    }


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


def sip_with_crash_timing(pmt, annual_rate, years, crash_year, crash_pct, inflation=6.5, job_loss_months=0):
    """
    Year-by-year SIP simulation with precise crash timing.

    Models SEQUENCE RISK: when a crash happens matters as much as how big it is.
    - Early crash: reduced compounding base amplifies the long-term loss
    - Late crash: compounding has already worked; terminal impact is smaller

    Args:
        pmt: monthly SIP amount (₹)
        annual_rate: expected annual return (%)
        years: investment horizon
        crash_year: year in which the crash occurs (0 = no crash)
        crash_pct: magnitude of crash (% drawdown, e.g. 30)
        inflation: annual inflation rate (%) for real-value calculation
        job_loss_months: months where SIP pauses (deducted from active months)

    Returns:
        list of {year, nominal, real} dicts
    """
    r_monthly = annual_rate / 12 / 100
    series = []
    corpus = 0.0
    months_invested = 0

    for year in range(1, years + 1):
        # Invest 12 months in this year, unless job loss is still in effect
        months_remaining_loss = max(0, job_loss_months - (year - 1) * 12)
        active_months = max(0, 12 - min(12, months_remaining_loss))

        for _ in range(active_months):
            corpus += pmt
            corpus *= (1 + r_monthly)
        for _ in range(12 - active_months):
            # Market still grows, but no new contribution
            corpus *= (1 + r_monthly)

        # Apply crash at this exact year
        if crash_year > 0 and year == crash_year:
            corpus *= (1 - crash_pct / 100)

        real_val = corpus / ((1 + inflation / 100) ** year)
        series.append({
            'year': year,
            'nominal': round(corpus),
            'real': round(real_val),
        })

    return series


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
