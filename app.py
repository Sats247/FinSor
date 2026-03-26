"""
app.py — FinSor Flask Application
All routes, session management, DB init, and API endpoints.
"""

import csv
import html
import io
import json
import logging
import os
import sqlite3
import threading
import time
import uuid
from datetime import date, datetime

from dotenv import load_dotenv
from flask import (Flask, jsonify, redirect, render_template, request,
                   session, url_for)
from flask_cors import CORS

# ─── Bootstrap ─────────────────────────────────────────────────────────────────
load_dotenv()

if not os.environ.get('GEMINI_API_KEY'):
    raise RuntimeError("GEMINI_API_KEY is not set in .env")
if not os.environ.get('FLASK_SECRET_KEY'):
    raise RuntimeError("FLASK_SECRET_KEY is not set in .env")

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY')
app.config['DEBUG'] = False
CORS(app, origins=['http://localhost:5000'])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Engine Imports ─────────────────────────────────────────────────────────────
from engine import calc, data_fetch, risk_engine
from engine.gemini_client import (build_macro_context, build_user_profile_context,
                                   call_genie)

# ─── Data Loading ──────────────────────────────────────────────────────────────
DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')

with open(os.path.join(DATA_DIR, 'personas.json')) as f:
    PERSONAS = json.load(f)

with open(os.path.join(DATA_DIR, 'funds.json')) as f:
    FUNDS_DATA = json.load(f)

PERSONA_BY_EMAIL = {p['email']: p for p in PERSONAS}


# ─── DB Helpers ────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect('finsor.db')
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init_db():
    db = get_db()
    db.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT,
            email TEXT UNIQUE,
            age INTEGER,
            risk_category TEXT,
            risk_score INTEGER,
            experience_level TEXT,
            monthly_investable INTEGER,
            goal TEXT,
            horizon_years INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS holdings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            ticker TEXT,
            name TEXT,
            quantity REAL,
            purchase_price REAL,
            purchase_date TEXT,
            type TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            ticker TEXT,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, ticker)
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            ticker TEXT,
            target_price REAL,
            direction TEXT,
            is_triggered INTEGER DEFAULT 0,
            triggered_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            message TEXT,
            ticker TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            action TEXT,
            risk_category TEXT,
            recommended_funds TEXT,
            macro_context TEXT,
            reason TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS research_intentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            ticker TEXT,
            intention TEXT,
            note TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, ticker)
        );
    ''')
    db.commit()
    db.close()


def sanitize(text, max_len=500):
    """Strip HTML and cap length."""
    return html.escape(str(text or ''))[:max_len]


def error_json(message, code='UNKNOWN_ERROR', status=200):
    return jsonify({'success': False, 'error': message, 'code': code}), status


# ─── Session Guard ─────────────────────────────────────────────────────────────
PUBLIC_ROUTES = {'landing', 'login', 'static', 'onboard', 'onboard_submit'}


@app.before_request
def require_login():
    if request.endpoint in PUBLIC_ROUTES or request.endpoint is None:
        return
    if request.endpoint.startswith('static'):
        return
    if not session.get('user_id'):
        return redirect(url_for('login'))


# ─── Persona Loader ────────────────────────────────────────────────────────────

def load_persona_to_db(persona):
    """Upsert persona into users + holdings tables."""
    db = get_db()
    try:
        db.execute('''
            INSERT OR REPLACE INTO users
            (id, name, email, age, risk_category, risk_score, experience_level,
             monthly_investable, goal, horizon_years)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        ''', (persona['id'], persona['name'], persona['email'], persona['age'],
              persona['risk_category'], persona['risk_score'], persona['experience_level'],
              persona['monthly_investable'], persona['goal'], persona['horizon_years']))

        # Clear existing holdings and reload
        db.execute('DELETE FROM holdings WHERE user_id = ?', (persona['id'],))
        for h in persona.get('portfolio', []):
            db.execute('''
                INSERT INTO holdings (user_id, ticker, name, quantity, purchase_price, purchase_date, type)
                VALUES (?,?,?,?,?,?,?)
            ''', (persona['id'], h['ticker'], h['name'], h['quantity'],
                  h.get('purchase_price'), h['purchase_date'], h['type']))

        # Clear watchlist and reload
        db.execute('DELETE FROM watchlist WHERE user_id = ?', (persona['id'],))
        for ticker in persona.get('watchlist', []):
            db.execute('INSERT OR IGNORE INTO watchlist (user_id, ticker) VALUES (?,?)',
                       (persona['id'], ticker))

        # Load alerts
        db.execute('DELETE FROM alerts WHERE user_id = ?', (persona['id'],))
        for alert in persona.get('alerts', []):
            db.execute('''
                INSERT INTO alerts (user_id, ticker, target_price, direction)
                VALUES (?,?,?,?)
            ''', (persona['id'], alert['ticker'], alert['target_price'], alert['direction']))

        db.commit()
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════════════════════
# PAGE ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/')
def landing():
    return render_template('landing.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = sanitize(request.form.get('email', ''))
        persona = PERSONA_BY_EMAIL.get(email)
        if persona:
            session['user_id'] = persona['id']
            session['user_data'] = {
                'id': persona['id'],
                'name': persona['name'],
                'email': persona['email'],
                'age': persona['age'],
                'risk_category': persona['risk_category'],
                'risk_score': persona['risk_score'],
                'experience_level': persona['experience_level'],
                'monthly_investable': persona['monthly_investable'],
                'goal': persona['goal'],
                'horizon_years': persona['horizon_years'],
            }
            load_persona_to_db(persona)
            return redirect(url_for('dashboard'))
        else:
            new_id = str(uuid.uuid4())
            session['user_id'] = new_id
            session['user_data'] = {
                'id': new_id, 'email': email, 'name': '',
                'risk_category': None, 'age': None,
            }
            return redirect(url_for('onboard'))
    return render_template('login.html', personas=PERSONAS)


@app.route('/onboard')
def onboard():
    return render_template('onboarding.html')


@app.route('/onboard/submit', methods=['POST'])
def onboard_submit():
    data = request.get_json()
    answers = {
        'crash_reaction': sanitize(data.get('crash_reaction', 'hold')),
        'age': max(18, min(80, int(data.get('age', 30)))),
        'goal': sanitize(data.get('goal', 'balanced')),
        'horizon': sanitize(data.get('horizon', '3to7')),
        'monthly_amount': max(0, int(data.get('monthly_amount', 5000))),
        'experience': sanitize(data.get('experience', 'some')),
    }
    risk_score, risk_category, experience_level = risk_engine.calculate_risk_score_from_answers(answers)

    user_id = session.get('user_id')
    user_data = session.get('user_data', {})
    user_data.update({
        'age': answers['age'],
        'risk_score': risk_score,
        'risk_category': risk_category,
        'experience_level': experience_level,
        'monthly_investable': answers['monthly_amount'],
        'goal': answers['goal'],
    })
    session['user_data'] = user_data

    db = get_db()
    try:
        db.execute('''
            INSERT OR REPLACE INTO users
            (id, email, age, risk_category, risk_score, experience_level, monthly_investable, goal)
            VALUES (?,?,?,?,?,?,?,?)
        ''', (user_id, user_data.get('email', ''), answers['age'],
              risk_category, risk_score, experience_level, answers['monthly_amount'], answers['goal']))
        db.commit()
    finally:
        db.close()

    return jsonify({
        'success': True,
        'data': {
            'risk_category': risk_category,
            'risk_score': risk_score,
            'experience_level': experience_level,
        }
    })


@app.route('/dashboard')
def dashboard():
    return render_template('dashboard.html', user=session.get('user_data', {}))


@app.route('/portfolio')
def portfolio():
    return render_template('portfolio.html', user=session.get('user_data', {}))


@app.route('/simulator')
def simulator():
    return render_template('simulator.html', user=session.get('user_data', {}))


@app.route('/tools')
def tools():
    return render_template('tools.html', user=session.get('user_data', {}))


@app.route('/watchlist')
def watchlist():
    return render_template('watchlist.html', user=session.get('user_data', {}))


@app.route('/status')
def status():
    return render_template('status.html', user=session.get('user_data', {}))


# ═══════════════════════════════════════════════════════════════════════════════
# API — MACRO & MARKET
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/macro')
def api_macro():
    try:
        macro = data_fetch.get_macro_signals()
        if not macro:
            return error_json('Market data temporarily unavailable', 'YFINANCE_ERROR')
        return jsonify({'success': True, 'data': macro})
    except Exception as e:
        logger.error(f"api_macro error: {e}")
        return error_json(str(e), 'YFINANCE_ERROR')


@app.route('/api/regime')
def api_regime():
    try:
        macro = data_fetch.get_macro_signals() or {}
        vix = macro.get('india_vix', {}).get('value')
        nifty = macro.get('nifty50', {}).get('value')
        nifty_200dma = macro.get('nifty_200dma')

        regime, mmi_score = risk_engine.get_market_regime(vix, nifty, nifty_200dma)
        mmi_label = risk_engine.get_mmi_label(mmi_score)
        _, adjustments = risk_engine.apply_macro_adjustment(
            session.get('user_data', {}).get('risk_category', 'Balanced'), macro)

        return jsonify({
            'success': True,
            'data': {
                'regime': regime,
                'mmi_score': mmi_score,
                'mmi_label': mmi_label,
                'vix': vix,
                'nifty': nifty,
                'nifty_200dma': nifty_200dma,
                'macro_adjustments': adjustments,
                'summary': risk_engine.get_regime_summary(regime, mmi_label),
            }
        })
    except Exception as e:
        logger.error(f"api_regime error: {e}")
        return error_json(str(e), 'YFINANCE_ERROR')


@app.route('/api/predictions')
def api_predictions():
    try:
        poly = data_fetch.get_polymarket_signals()
        meta = data_fetch.get_metaculus_signals()
        return jsonify({
            'success': True,
            'data': {
                'polymarket': poly,
                'metaculus': meta,
                'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            }
        })
    except Exception as e:
        logger.error(f"api_predictions error: {e}")
        return jsonify({'success': True, 'data': {'polymarket': [], 'metaculus': [], 'fetched_at': ''}})


@app.route('/api/news')
def api_news():
    try:
        headlines = data_fetch.get_news_headlines()
        return jsonify({'success': True, 'data': headlines})
    except Exception as e:
        logger.error(f"api_news error: {e}")
        return jsonify({'success': True, 'data': []})


# ═══════════════════════════════════════════════════════════════════════════════
# API — FUNDS & GENIE
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/funds')
def api_funds():
    try:
        user_data = session.get('user_data', {})
        risk_cat = user_data.get('risk_category', 'Balanced')
        investment_type = request.args.get('type', 'SIP')
        monthly_sip = int(user_data.get('monthly_investable', 5000))

        macro = data_fetch.get_macro_signals() or {}
        db = get_db()
        result = risk_engine.recommend_funds(
            risk_cat, investment_type, macro, db_conn=db,
            user_id=session.get('user_id'))
        db.close()

        # Build SIP projection
        years = [1, 3, 5, 10, 15, 20]
        projection = {
            'monthly_sip': monthly_sip,
            'years': years,
            'worst': [calc.future_value_sip(monthly_sip, 8, y * 12) for y in years],
            'base': [calc.future_value_sip(monthly_sip, 12, y * 12) for y in years],
            'best': [calc.future_value_sip(monthly_sip, 15, y * 12) for y in years],
        }
        for key in ['worst', 'base', 'best']:
            projection[key] = [round(v) for v in projection[key]]

        # Health summary
        funds = result['funds']
        avg_er = round(sum(f.get('expense_ratio', 0) for f in funds) / max(1, len(funds)), 2)
        result['projection'] = projection
        result['health'] = {
            'avg_expense_ratio': avg_er,
            'diversification_score': 78,
            'tax_efficiency': 'Good' if risk_cat in ('Conservative', 'Moderate') else 'Moderate',
        }

        return jsonify({'success': True, 'data': result})
    except Exception as e:
        logger.error(f"api_funds error: {e}")
        return error_json(str(e), 'UNKNOWN_ERROR')


@app.route('/api/genie', methods=['POST'])
def api_genie():
    try:
        body = request.get_json() or {}
        user_message = sanitize(body.get('message', ''))
        if not user_message:
            return error_json('Message is required', 'MISSING_PARAM')
        if len(user_message) > 500:
            return error_json('Message too long', 'INPUT_TOO_LONG')

        conversation_history = body.get('conversation_history', [])[-6:]
        user_data = session.get('user_data', {})

        macro = data_fetch.get_macro_signals() or {}
        news = data_fetch.get_news_headlines()
        poly = data_fetch.get_polymarket_signals()
        vix = macro.get('india_vix', {}).get('value')
        nifty = macro.get('nifty50', {}).get('value')
        nifty_200dma = macro.get('nifty_200dma')
        regime, mmi_score = risk_engine.get_market_regime(vix, nifty, nifty_200dma)
        mmi_label = risk_engine.get_mmi_label(mmi_score)
        regime_data = {'regime': regime, 'mmi_score': mmi_score, 'mmi_label': mmi_label}

        macro_ctx = build_macro_context(macro, regime_data, news, poly)
        user_ctx = build_user_profile_context(user_data)

        db = get_db()
        result = call_genie(
            user_message, conversation_history,
            macro_ctx, user_ctx,
            user_id=session.get('user_id'), db_conn=db)
        db.close()

        if result.get('model_used') == 'fallback':
            return jsonify({'success': False, 'error': result['response'], 'code': 'GEMINI_UNAVAILABLE'})

        return jsonify({
            'success': True,
            'data': {
                'response': result['response'],
                'macro_context_used': {
                    'vix': vix, 'nifty': nifty, 'regime': regime, 'mmi_score': mmi_score,
                },
                'bias_detected': result.get('bias_detected'),
                'model_used': result.get('model_used'),
            }
        })
    except Exception as e:
        logger.error(f"api_genie error: {e}")
        return error_json('Our AI advisor is momentarily unavailable. Please try again in a few seconds.', 'GEMINI_UNAVAILABLE')


# ═══════════════════════════════════════════════════════════════════════════════
# API — PORTFOLIO
# ═══════════════════════════════════════════════════════════════════════════════

def _enrich_holding(h, prices):
    """Adds current_price, pnl, tax_label to a holding dict."""
    ticker = h['ticker']
    price_info = prices.get(ticker, {})
    current_price = price_info.get('price')
    
    purchase_price = h.get('purchase_price')
    quantity = h.get('quantity', 0)
    tax_label, days_held = calc.classify_tax(h.get('purchase_date', '2020-01-01'))

    pnl_abs = None
    pnl_pct = None
    if current_price and purchase_price:
        pnl_abs = round((current_price - purchase_price) * quantity, 2)
        pnl_pct = round(((current_price - purchase_price) / purchase_price) * 100, 2)

    return {
        **dict(h),
        'current_price': current_price,
        'pnl_abs': pnl_abs,
        'pnl_pct': pnl_pct,
        'tax_label': tax_label,
        'days_held': days_held,
        'change': price_info.get('change', 0),
        'change_abs': price_info.get('change_abs', 0),
    }


@app.route('/api/portfolio/upload', methods=['POST'])
def api_portfolio_upload():
    try:
        user_id = session.get('user_id')
        if 'file' not in request.files:
            return error_json('No file uploaded', 'MISSING_PARAM')

        file = request.files['file']
        content = file.read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(content))
        required_cols = {'ticker', 'quantity', 'purchase_date', 'type', 'name'}

        if not required_cols.issubset(set(reader.fieldnames or [])):
            return error_json('CSV missing required columns: ' + ', '.join(required_cols), 'CSV_INVALID')

        db = get_db()
        db.execute('DELETE FROM holdings WHERE user_id = ?', (user_id,))

        imported, skipped, skipped_rows = 0, 0, []
        holdings_raw = []

        for i, row in enumerate(reader):
            if i >= 200:
                break
            try:
                ticker = sanitize(row.get('ticker', '').strip(), 30)
                name = sanitize(row.get('name', '').strip(), 100)
                quantity = float(row.get('quantity', 0))
                purchase_date = row.get('purchase_date', '').strip()
                h_type = row.get('type', 'stock').strip().lower()
                purchase_price_raw = row.get('purchase_price', '').strip()

                if h_type not in ('stock', 'etf', 'mf'):
                    skipped += 1; skipped_rows.append(f"Row {i+2}: invalid type"); continue
                datetime.strptime(purchase_date, '%Y-%m-%d')

                purchase_price = float(purchase_price_raw) if purchase_price_raw else None
                if purchase_price is None and h_type == 'mf':
                    nav_data = data_fetch.get_fund_nav(ticker)
                    purchase_price = nav_data['nav'] if nav_data else None

                db.execute('''
                    INSERT INTO holdings (user_id, ticker, name, quantity, purchase_price, purchase_date, type)
                    VALUES (?,?,?,?,?,?,?)
                ''', (user_id, ticker, name, quantity, purchase_price, purchase_date, h_type))

                holdings_raw.append({
                    'ticker': ticker, 'name': name, 'quantity': quantity,
                    'purchase_price': purchase_price, 'purchase_date': purchase_date, 'type': h_type,
                })
                imported += 1
            except Exception as row_err:
                skipped += 1
                skipped_rows.append(f"Row {i+2}: {str(row_err)}")

        db.commit()

        # Enrich with live prices
        tickers = [h['ticker'] for h in holdings_raw]
        prices = data_fetch.get_live_prices(tickers)
        enriched = [_enrich_holding(h, prices) for h in holdings_raw]
        db.close()

        return jsonify({
            'success': True,
            'data': {
                'imported_count': imported,
                'skipped_count': skipped,
                'skipped_rows': skipped_rows,
                'holdings': enriched,
            }
        })
    except Exception as e:
        logger.error(f"portfolio_upload error: {e}")
        return error_json('Could not parse CSV file', 'CSV_PARSE_ERROR')


@app.route('/api/portfolio/holdings')
def api_portfolio_holdings():
    try:
        user_id = session.get('user_id')
        db = get_db()
        rows = db.execute(
            'SELECT * FROM holdings WHERE user_id = ?', (user_id,)
        ).fetchall()
        db.close()

        holdings_raw = [dict(r) for r in rows]
        if not holdings_raw:
            return jsonify({'success': True, 'data': {'holdings': [], 'summary': {}, 'tlh_opportunities': []}})

        tickers = [h['ticker'] for h in holdings_raw]
        prices = data_fetch.get_live_prices(tickers)
        enriched = [_enrich_holding(h, prices) for h in holdings_raw]

        total_invested = sum(
            (h.get('purchase_price') or 0) * h.get('quantity', 0) for h in enriched
        )
        current_value = sum(
            (h.get('current_price') or h.get('purchase_price') or 0) * h.get('quantity', 0)
            for h in enriched
        )
        total_pnl = current_value - total_invested
        total_pnl_pct = (total_pnl / total_invested * 100) if total_invested else 0

        health_score = calc.portfolio_health_score(enriched)

        # TLH opportunities — STCG holdings with a loss
        tlh = []
        for h in enriched:
            if h.get('tax_label') == 'STCG' and h.get('pnl_abs') and h['pnl_abs'] < 0:
                days_held = h.get('days_held', 0)
                days_to_ltcg = max(0, 365 - days_held)
                tax_saving = abs(h['pnl_abs']) * 0.20
                tlh.append({
                    'ticker': h['ticker'],
                    'name': h['name'],
                    'unrealised_loss': round(h['pnl_abs'], 2),
                    'tax_label': 'STCG',
                    'tax_rate': 20,
                    'estimated_tax_saving': round(tax_saving, 2),
                    'days_held': days_held,
                    'days_to_ltcg': days_to_ltcg,
                    'approaching_ltcg': days_to_ltcg <= 30,
                })

        return jsonify({
            'success': True,
            'data': {
                'holdings': enriched,
                'summary': {
                    'total_invested': round(total_invested, 2),
                    'current_value': round(current_value, 2),
                    'total_pnl': round(total_pnl, 2),
                    'total_pnl_pct': round(total_pnl_pct, 2),
                    'health_score': health_score,
                    'days_to_march31': calc.days_to_march31(),
                },
                'tlh_opportunities': tlh,
            }
        })
    except Exception as e:
        logger.error(f"portfolio_holdings error: {e}")
        return error_json(str(e), 'UNKNOWN_ERROR')


@app.route('/api/portfolio/prices')
def api_portfolio_prices():
    try:
        user_id = session.get('user_id')
        db = get_db()
        rows = db.execute('SELECT ticker FROM holdings WHERE user_id = ?', (user_id,)).fetchall()
        db.close()
        tickers = [r['ticker'] for r in rows]
        prices = data_fetch.get_live_prices(tickers)
        from datetime import datetime
        now_ist = datetime.utcnow()
        hour = now_ist.hour
        minute = now_ist.minute
        weekday = now_ist.weekday()
        ist_hour = (hour + 5) % 24
        ist_minute = (minute + 30) % 60
        market_open = (weekday < 5 and
                       (ist_hour * 60 + ist_minute) >= 555 and
                       (ist_hour * 60 + ist_minute) <= 930)
        return jsonify({
            'success': True,
            'data': prices,
            'market_open': market_open,
            'fetched_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        })
    except Exception as e:
        logger.error(f"portfolio_prices error: {e}")
        return error_json(str(e), 'YFINANCE_ERROR')


# ═══════════════════════════════════════════════════════════════════════════════
# API — SIMULATOR
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/simulator/calculate', methods=['POST'])
def api_simulator_calculate():
    try:
        body = request.get_json() or {}
        monthly_sip = max(100, min(200000, int(body.get('monthly_sip', 10000))))
        years = max(1, min(40, int(body.get('years', 20))))
        fd_rate = max(1, min(20, float(body.get('fd_rate', 7.0))))
        nifty_rate = max(1, min(25, float(body.get('nifty_rate', 12.0))))
        inflation = max(0, min(15, float(body.get('inflation', 6.5))))
        job_loss_months = max(0, min(24, int(body.get('job_loss_months', 0))))
        crash_pct = max(0, min(60, float(body.get('crash_pct', 0))))

        year_list = list(range(1, years + 1))

        def build_series(rate, months_sip, crash):
            series = []
            for y in year_list:
                months = y * 12
                active_months = max(0, months - job_loss_months)
                fv = calc.future_value_sip(monthly_sip, rate, active_months)
                if crash > 0 and y >= int(body.get('crash_at_year', 10)):
                    fv *= (1 - crash / 100)
                series.append({'year': y, 'nominal': round(fv),
                               'real': round(fv / ((1 + inflation / 100) ** y))})
            return series

        fd_series = build_series(fd_rate, year_list, 0)
        nifty_series = build_series(nifty_rate, year_list, 0)
        worst = build_series(8, year_list, crash_pct)
        base = build_series(12, year_list, crash_pct)
        best = build_series(15, year_list, crash_pct)

        # Impact of job loss
        no_loss_fv = calc.future_value_sip(monthly_sip, nifty_rate, years * 12)
        with_loss_fv = calc.future_value_sip(monthly_sip, nifty_rate, max(0, years * 12 - job_loss_months))
        impact_job_loss = round(with_loss_fv - no_loss_fv)

        final_fd = fd_series[-1]['nominal']
        final_nifty = nifty_series[-1]['nominal']
        real_final_nifty = nifty_series[-1]['real']

        return jsonify({
            'success': True,
            'data': {
                'fd_corpus': fd_series,
                'nifty_corpus': nifty_series,
                'scenario_worst': worst,
                'scenario_base': base,
                'scenario_best': best,
                'impact_job_loss': impact_job_loss,
                'impact_crash': round(-final_nifty * crash_pct / 100) if crash_pct else 0,
                'final_fd': final_fd,
                'final_nifty': final_nifty,
                'real_final_nifty': real_final_nifty,
            }
        })
    except Exception as e:
        logger.error(f"simulator_calculate error: {e}")
        return error_json(str(e), 'UNKNOWN_ERROR')


# ═══════════════════════════════════════════════════════════════════════════════
# API — TOOLS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/tools/calculate', methods=['POST'])
def api_tools_calculate():
    try:
        body = request.get_json() or {}
        calc_type = sanitize(body.get('type', 'sip'), 20)
        inflation = max(0, min(15, float(body.get('inflation', 6.5))))

        if calc_type == 'sip':
            pmt = max(100, float(body.get('pmt', 5000)))
            rate = max(0.1, float(body.get('rate', 12)))
            years = max(1, int(body.get('years', 10)))
            months = years * 12
            result = calc.future_value_sip(pmt, rate, months)
            real = result / ((1 + inflation / 100) ** years)
            sensitivity = calc.sensitivity_analysis(pmt, rate, months)
            return jsonify({'success': True, 'data': {
                'type': 'sip', 'result': round(result), 'real_result': round(real),
                'sensitivity': sensitivity,
            }})

        elif calc_type == 'lump':
            pv = max(1000, float(body.get('pv', 100000)))
            rate = max(0.1, float(body.get('rate', 7)))
            years = max(1, int(body.get('years', 5)))
            result = calc.future_value_lump(pv, rate, years)
            real = result / ((1 + inflation / 100) ** years)
            return jsonify({'success': True, 'data': {
                'type': 'lump', 'result': round(result), 'real_result': round(real),
                'sensitivity': {},
            }})

        elif calc_type == 'cagr':
            start = max(1, float(body.get('start_value', 100000)))
            end = max(1, float(body.get('end_value', 200000)))
            years = max(1, int(body.get('years', 5)))
            result = calc.cagr(start, end, years)
            return jsonify({'success': True, 'data': {
                'type': 'cagr', 'result': round(result * 100, 2), 'real_result': None,
                'sensitivity': {},
            }})

        elif calc_type == 'goalseek':
            fv = max(10000, float(body.get('fv', 1000000)))
            rate = max(0.1, float(body.get('rate', 12)))
            years = max(1, int(body.get('years', 10)))
            pmt = calc.goal_seek_sip(fv, rate, years * 12)
            return jsonify({'success': True, 'data': {
                'type': 'goalseek', 'result': round(pmt), 'real_result': None,
                'sensitivity': {},
            }})

        return error_json('Invalid calculation type', 'MISSING_PARAM')
    except Exception as e:
        logger.error(f"tools_calculate error: {e}")
        return error_json(str(e), 'UNKNOWN_ERROR')


@app.route('/api/tools/stock')
def api_tools_stock():
    try:
        ticker = sanitize(request.args.get('ticker', ''), 30)
        if not ticker:
            return error_json('Ticker is required', 'MISSING_TICKER')
        info = data_fetch.get_stock_fundamentals(ticker)
        if not info:
            return error_json(f'No data found for {ticker}', 'TICKER_NOT_FOUND')
        return jsonify({'success': True, 'data': info})
    except Exception as e:
        logger.error(f"tools_stock error: {e}")
        return error_json(str(e), 'YFINANCE_ERROR')


# ═══════════════════════════════════════════════════════════════════════════════
# API — WATCHLIST & ALERTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/watchlist/add', methods=['POST'])
def add_to_watchlist():
    try:
        user_id = session.get('user_id')
        body = request.get_json() or {}
        ticker = sanitize(body.get('ticker', '').upper(), 20)
        if not ticker:
            return error_json('Ticker is required', 'MISSING_TICKER')
        db = get_db()
        db.execute('INSERT OR IGNORE INTO watchlist (user_id, ticker) VALUES (?,?)', (user_id, ticker))
        db.commit()
        db.close()
        return jsonify({'success': True, 'data': {'ticker': ticker}})
    except Exception as e:
        logger.error(f"watchlist_add error: {e}")
        return error_json(str(e), 'DB_ERROR')


@app.route('/api/watchlist/remove', methods=['POST'])
def remove_from_watchlist():
    try:
        user_id = session.get('user_id')
        body = request.get_json() or {}
        ticker = sanitize(body.get('ticker', '').upper(), 20)
        db = get_db()
        db.execute('DELETE FROM watchlist WHERE user_id = ? AND ticker = ?', (user_id, ticker))
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return error_json(str(e), 'DB_ERROR')


@app.route('/api/watchlist/prices')
def api_watchlist_prices():
    try:
        user_id = session.get('user_id')
        db = get_db()
        rows = db.execute('SELECT ticker FROM watchlist WHERE user_id = ?', (user_id,)).fetchall()
        db.close()
        tickers = [r['ticker'] for r in rows]
        if not tickers:
            return jsonify({'success': True, 'data': {}})

        prices = data_fetch.get_live_prices(tickers)
        result = {}
        for ticker, info in prices.items():
            sparkline = data_fetch.get_sparkline(ticker, 30)
            result[ticker] = {**info, 'sparkline': sparkline}
        return jsonify({'success': True, 'data': result})
    except Exception as e:
        logger.error(f"watchlist_prices error: {e}")
        return error_json(str(e), 'YFINANCE_ERROR')


@app.route('/api/alerts/set', methods=['POST'])
def api_alerts_set():
    try:
        user_id = session.get('user_id')
        body = request.get_json() or {}
        ticker = sanitize(body.get('ticker', '').upper(), 20)
        target_price = float(body.get('target_price', 0))
        direction = sanitize(body.get('direction', 'above'), 10)
        if direction not in ('above', 'below'):
            return error_json('Direction must be above or below', 'MISSING_PARAM')
        db = get_db()
        db.execute('''
            INSERT INTO alerts (user_id, ticker, target_price, direction)
            VALUES (?,?,?,?)
        ''', (user_id, ticker, target_price, direction))
        db.commit()
        db.close()
        return jsonify({'success': True, 'data': {'ticker': ticker, 'target_price': target_price, 'direction': direction}})
    except Exception as e:
        return error_json(str(e), 'DB_ERROR')


@app.route('/api/alerts/check')
def api_alerts_check():
    try:
        user_id = session.get('user_id')
        db = get_db()
        active = db.execute(
            'SELECT * FROM alerts WHERE user_id = ? AND is_triggered = 0', (user_id,)
        ).fetchall()

        if not active:
            unread = db.execute(
                'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', (user_id,)
            ).fetchone()['c']
            db.close()
            return jsonify({'success': True, 'data': {
                'triggered_this_check': [],
                'active_alerts_remaining': 0,
                'unread_notifications': unread,
            }})

        tickers = list({a['ticker'] for a in active})
        prices = data_fetch.get_live_prices(tickers)
        triggered = []

        for alert in active:
            ticker = alert['ticker']
            current = (prices.get(ticker) or {}).get('price')
            if current is None:
                continue
            hit = (alert['direction'] == 'above' and current >= alert['target_price']) or \
                  (alert['direction'] == 'below' and current <= alert['target_price'])
            if hit:
                msg = f"{ticker} hit ₹{current:,.2f} — your target of ₹{alert['target_price']:,.2f} was reached."
                db.execute('''
                    UPDATE alerts SET is_triggered = 1, triggered_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                ''', (alert['id'],))
                db.execute('''
                    INSERT INTO notifications (user_id, message, ticker)
                    VALUES (?,?,?)
                ''', (user_id, msg, ticker))
                triggered.append({
                    'ticker': ticker,
                    'target_price': alert['target_price'],
                    'current_price': current,
                    'direction': alert['direction'],
                    'message': msg,
                })

        db.commit()
        remaining = db.execute(
            'SELECT COUNT(*) as c FROM alerts WHERE user_id = ? AND is_triggered = 0', (user_id,)
        ).fetchone()['c']
        unread = db.execute(
            'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0', (user_id,)
        ).fetchone()['c']
        db.close()

        return jsonify({'success': True, 'data': {
            'triggered_this_check': triggered,
            'active_alerts_remaining': remaining,
            'unread_notifications': unread,
        }})
    except Exception as e:
        logger.error(f"alerts_check error: {e}")
        return error_json(str(e), 'DB_ERROR')


@app.route('/api/alerts/notifications')
def api_alerts_notifications():
    try:
        user_id = session.get('user_id')
        db = get_db()
        notifs = db.execute('''
            SELECT id, message, ticker, is_read, created_at
            FROM notifications WHERE user_id = ?
            ORDER BY created_at DESC LIMIT 20
        ''', (user_id,)).fetchall()
        unread = sum(1 for n in notifs if not n['is_read'])
        db.close()
        return jsonify({'success': True, 'data': {
            'notifications': [dict(n) for n in notifs],
            'unread_count': unread,
        }})
    except Exception as e:
        return error_json(str(e), 'DB_ERROR')


@app.route('/api/alerts/mark-read', methods=['POST'])
def api_alerts_mark_read():
    try:
        user_id = session.get('user_id')
        db = get_db()
        db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', (user_id,))
        db.commit()
        db.close()
        return jsonify({'success': True})
    except Exception as e:
        return error_json(str(e), 'DB_ERROR')


# ═══════════════════════════════════════════════════════════════════════════════
# API — RESEARCH INTENTIONS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/research_intentions/set', methods=['POST'])
def set_research_intention():
    try:
        user_id = session.get('user_id')
        body = request.get_json() or {}
        ticker = sanitize(body.get('ticker', ''), 20)
        intention = sanitize(body.get('intention', ''), 100)
        note = sanitize(body.get('note', ''), 500)
        db = get_db()
        db.execute('''
            INSERT INTO research_intentions (user_id, ticker, intention, note, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, ticker) DO UPDATE SET
              intention = excluded.intention,
              note = excluded.note,
              updated_at = CURRENT_TIMESTAMP
        ''', (user_id, ticker, intention, note))
        db.commit()
        db.close()
        return jsonify({'success': True, 'data': {'ticker': ticker, 'intention': intention}})
    except Exception as e:
        return error_json(str(e), 'DB_ERROR')


# ═══════════════════════════════════════════════════════════════════════════════
# API — STATUS
# ═══════════════════════════════════════════════════════════════════════════════

@app.route('/api/status/check')
def api_status_check():
    results = {}

    # yfinance
    t0 = time.time()
    try:
        macro = data_fetch._fetch_macro_raw()
        valid = sum(1 for k in ['nifty50', 'sensex', 'india_vix', 'usd_inr', 'brent', 'gold']
                    if macro and macro.get(k, {}).get('value') is not None)
        results['yfinance'] = {'ok': valid >= 4, 'detail': f'{valid}/6 tickers returned valid prices',
                               'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['yfinance'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # AMFI
    t0 = time.time()
    try:
        nav_data = data_fetch.get_fund_nav('119551')
        ok = nav_data is not None and nav_data.get('nav', 0) > 0
        results['amfi'] = {'ok': ok, 'detail': f"NAV: {nav_data['nav'] if ok else 'N/A'}",
                           'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['amfi'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # Polymarket
    t0 = time.time()
    try:
        poly = data_fetch.get_polymarket_signals()
        results['polymarket'] = {'ok': isinstance(poly, list), 
                                 'detail': f'{len(poly)} India-relevant markets fetched',
                                 'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['polymarket'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # Metaculus
    t0 = time.time()
    try:
        meta = data_fetch.get_metaculus_signals()
        results['metaculus'] = {'ok': isinstance(meta, list),
                                'detail': f'{len(meta)} signals fetched',
                                'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['metaculus'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # Google News
    t0 = time.time()
    try:
        news = data_fetch.get_news_headlines()
        results['google_news'] = {'ok': len(news) >= 1,
                                  'detail': f'{len(news)} headlines fetched',
                                  'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['google_news'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # Gemini
    t0 = time.time()
    try:
        from engine.gemini_client import call_genie
        resp = call_genie('Say hello in 10 words.', [], 'Test context', 'Test profile')
        words = len(resp.get('response', '').split())
        results['gemini'] = {'ok': words > 3,
                             'detail': f'Response: {words} words. Model: {resp.get("model_used")}',
                             'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['gemini'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # SQLite
    t0 = time.time()
    try:
        db = get_db()
        db.execute("INSERT INTO audit_log (user_id, action) VALUES ('__test__', 'status_check')")
        result = db.execute("SELECT id FROM audit_log WHERE user_id='__test__' LIMIT 1").fetchone()
        db.execute("DELETE FROM audit_log WHERE user_id='__test__'")
        db.commit()
        db.close()
        results['sqlite'] = {'ok': result is not None, 'detail': 'Read/write test passed',
                             'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['sqlite'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    # Risk Engine
    t0 = time.time()
    try:
        tests = [
            (risk_engine.calculate_risk_category(2) == 'Conservative'),
            (risk_engine.calculate_risk_category(5) == 'Balanced'),
            (risk_engine.calculate_risk_category(9) == 'Aggressive'),
        ]
        passed = sum(tests)
        results['risk_engine'] = {'ok': passed == 3, 'detail': f'{passed}/3 profile assertions passed',
                                  'latency_ms': round((time.time() - t0) * 1000)}
    except Exception as e:
        results['risk_engine'] = {'ok': False, 'detail': str(e), 'latency_ms': round((time.time() - t0) * 1000)}

    results['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return jsonify({'success': True, 'data': results})


# ═══════════════════════════════════════════════════════════════════════════════
# STARTUP
# ═══════════════════════════════════════════════════════════════════════════════

with app.app_context():
    init_db()

# Pre-warm macro cache in background
threading.Thread(target=lambda: data_fetch.get_macro_signals(), daemon=True).start()

if __name__ == '__main__':
    app.run(host='localhost', port=5000, debug=False)
