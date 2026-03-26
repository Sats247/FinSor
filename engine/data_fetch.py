"""
data_fetch.py — All external data fetching with module-level caching.
No LLM involvement. On failure, returns stale cache or empty/None — never crashes.
"""

import time
import logging
import requests
import yfinance as yf
import feedparser
import html as html_module

logger = logging.getLogger(__name__)

# ─── Module-Level Cache ────────────────────────────────────────────────────────
_cache = {}

CACHE_TTL = {
    'macro': 60,
    'amfi': 300,
    'polymarket': 180,
    'metaculus': 600,
    'news': 120,
}

TICKERS = ['^NSEI', '^BSESN', '^INDIAVIX', 'USDINR=X', 'BZ=F', 'GC=F']
TICKER_KEYS = ['nifty50', 'sensex', 'india_vix', 'usd_inr', 'brent', 'gold']


def _get_cached(key, ttl_key, fetch_fn):
    """Generic TTL cache. Returns stale data rather than crashing on fetch failure."""
    now = time.time()
    ttl = CACHE_TTL.get(ttl_key, 60)
    if key in _cache and (now - _cache[key]['ts']) < ttl:
        return _cache[key]['data']
    try:
        result = fetch_fn()
        if result is not None:
            _cache[key] = {'data': result, 'ts': now}
        return result
    except Exception as e:
        logger.error(f"Fetch failed for {key}: {e}")
        if key in _cache:
            return _cache[key]['data']
        return None


# ─── Macro Signals ─────────────────────────────────────────────────────────────

def _fetch_macro_raw():
    """Batch-fetch all 6 tickers in one yf.download call."""
    try:
        data = yf.download(
            TICKERS,
            period='5d',
            interval='1d',
            progress=False,
            group_by='ticker',
            auto_adjust=True
        )
    except Exception as e:
        logger.error(f"yfinance batch download failed: {e}")
        return None

    result = {}
    for ticker, key in zip(TICKERS, TICKER_KEYS):
        try:
            closes = data[ticker]['Close'].dropna()
            if len(closes) < 2:
                result[key] = {'value': None, 'change': 0, 'change_abs': 0}
                continue
            latest = float(closes.iloc[-1])
            prev = float(closes.iloc[-2])
            change_pct = ((latest - prev) / prev) * 100 if prev else 0
            result[key] = {
                'value': round(latest, 2),
                'change': round(change_pct, 2),
                'change_abs': round(latest - prev, 2),
            }
        except Exception as e:
            logger.warning(f"Failed to parse {ticker}: {e}")
            result[key] = {'value': None, 'change': 0, 'change_abs': 0}

    # 200-day moving average for Nifty 50
    try:
        nifty = yf.Ticker('^NSEI')
        hist = nifty.history(period='220d', interval='1d')
        if len(hist) >= 200:
            result['nifty_200dma'] = round(float(hist['Close'].tail(200).mean()), 2)
        else:
            result['nifty_200dma'] = result.get('nifty50', {}).get('value') or 0
    except Exception as e:
        logger.warning(f"200DMA fetch failed: {e}")
        result['nifty_200dma'] = result.get('nifty50', {}).get('value') or 0

    result['fetched_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    return result


def get_macro_signals():
    """Returns macro signals dict with 60s cache."""
    return _get_cached('macro', 'macro', _fetch_macro_raw)


# ─── AMFI NAV ──────────────────────────────────────────────────────────────────

def _fetch_amfi_nav(amfi_code):
    url = f"https://api.mfapi.in/mf/{amfi_code}"
    resp = requests.get(url, timeout=8)
    resp.raise_for_status()
    data = resp.json()
    nav = float(data['data'][0]['nav'])
    nav_date = data['data'][0]['date']
    return {'nav': nav, 'nav_date': nav_date}


def get_fund_nav(amfi_code):
    """Fetches NAV for a single fund. Cached per fund for 5 minutes."""
    key = f"amfi_{amfi_code}"
    return _get_cached(key, 'amfi', lambda: _fetch_amfi_nav(amfi_code))


# ─── Polymarket ───────────────────────────────────────────────────────────────

INDIA_KEYWORDS = ['india', 'rbi', 'sebi', 'nifty', 'bse', 'nse', 'inr', 'rupee',
                  'sensex', 'modi', 'mumbai', 'delhi', 'chennai', 'bengaluru']


def _fetch_polymarket():
    url = "https://gamma-api.polymarket.com/markets?limit=50&active=true"
    resp = requests.get(url, timeout=8)
    resp.raise_for_status()
    markets = resp.json()

    india_relevant = []
    for m in markets:
        question = (m.get('question') or '').lower()
        description = (m.get('description') or '').lower()
        combined = question + ' ' + description
        if any(kw in combined for kw in INDIA_KEYWORDS):
            try:
                prob = float(m.get('outcomePrices', ['0.5'])[0])
            except Exception:
                prob = 0.5
            india_relevant.append({
                'question': m.get('question', 'Unknown'),
                'probability': round(prob, 2),
                'volume_usd': int(float(m.get('volume', 0))),
            })
        if len(india_relevant) >= 3:
            break

    return india_relevant


def get_polymarket_signals():
    import requests
from datetime import datetime

def get_polymarket_signals():
    """
    Fetches active, India-relevant prediction market signals from Polymarket Gamma API.
    """
    # Use /events for better grouped metadata, or /search for keyword precision
    BASE_URL = "https://gamma-api.polymarket.com/events"
    
    # Strict 2026 Parameters
    params = {
        "active": "true",     # Only current markets
        "closed": "false",    # Only open for trading
        "limit": 500          # Scan top 500 to catch Indian events
    }
    
    try:
        response = requests.get(BASE_URL, params=params, timeout=5)
        if response.status_code != 200:
            return []
            
        events = response.json()
        india_signals = []
        
        # Keywords for India-relevant research
        keywords = ['India', 'RBI', 'Nifty', 'Sensex', 'Modi', 'INR', 'BSE']
        
        for event in events:
            # Check if title or description mentions India
            title = event.get('title', '')
            if any(k.lower() in title.lower() for k in keywords):
                # Events usually have a 'markets' list; we grab the primary one
                markets = event.get('markets', [])
                if not markets: continue
                
                market = markets[0]
                # Probability is usually outcomePrices[0] for the 'Yes' outcome
                import json
                try:
                    prices_raw = market.get('outcomePrices', '["0.5", "0.5"]')
                    if not prices_raw or prices_raw == 'None':
                        prices_raw = '["0.5", "0.5"]'
                    prices = json.loads(prices_raw)
                    prob = float(prices[0])
                    
                    vol_val = event.get('volume24hr')
                    vol = float(vol_val) if vol_val is not None else 0.0
                    
                    india_signals.append({
                        "question": title,
                        "probability": prob,
                        "volume_usd": vol
                    })
                except Exception as e:
                    logger.warning(f"Polymarket Parsing Error: {title} | {e}")
                    continue
        
        # Sort by volume and return top 3
        return sorted(india_signals, key=lambda x: x['volume_usd'], reverse=True)[:3]
        
    except Exception as e:
        print(f"Polymarket Fetch Error: {e}")
        return []


# ─── Metaculus ────────────────────────────────────────────────────────────────

def _fetch_metaculus():
    url = "https://www.metaculus.com/api2/questions/?limit=5&order_by=-activity&search=India+economy"
    resp = requests.get(url, timeout=8, headers={'Accept': 'application/json'})
    resp.raise_for_status()
    data = resp.json()
    results = []
    for q in data.get('results', [])[:2]:
        pred = q.get('community_prediction', {})
        mid = pred.get('full', {}).get('q2') if isinstance(pred, dict) else None
        results.append({
            'title': q.get('title', 'Unknown'),
            'community_prediction': round(float(mid), 2) if mid else None,
            'url': f"https://www.metaculus.com/questions/{q.get('id', '')}/"
        })
    return results


def get_metaculus_signals():
    """Returns up to 2 Metaculus India economy signals."""
    result = _get_cached('metaculus', 'metaculus', _fetch_metaculus)
    return result if result else []


# ─── Google News RSS ──────────────────────────────────────────────────────────

CATEGORY_KEYWORDS = {
    'economy': ['gdp', 'rbi', 'repo', 'inflation', 'budget', 'fiscal', 'sebi', 'tax'],
    'tech': ['tcs', 'infosys', 'wipro', 'tech', 'it sector', 'hcltech'],
    'energy': ['oil', 'crude', 'brent', 'energy', 'coal', 'ongc', 'gas'],
    'global': ['fed', 'usd', 'dollar', 'china', 'us market', 'global', 'foreign'],
}


def _classify_news(title):
    title_lower = title.lower()
    for cat, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in title_lower for kw in keywords):
            return cat
    return 'market'


def _relative_time(published_parsed):
    """Convert feedparser time tuple to relative string."""
    if not published_parsed:
        return 'Recently'
    try:
        import calendar
        pub_ts = calendar.timegm(published_parsed)
        diff = int(time.time()) - pub_ts
        if diff < 3600:
            return f"{diff // 60}m ago"
        elif diff < 86400:
            return f"{diff // 3600}h ago"
        else:
            return f"{diff // 86400}d ago"
    except Exception:
        return 'Recently'


def _fetch_news():
    url = 'https://news.google.com/rss/search?q=Indian+stock+market+NSE+BSE&hl=en-IN&gl=IN&ceid=IN:en'
    feed = feedparser.parse(url)
    headlines = []
    for entry in feed.entries[:5]:
        title = html_module.unescape(entry.get('title', ''))
        # Strip any HTML tags
        import re
        title = re.sub(r'<[^>]+>', '', title)
        source = entry.get('source', {}).get('title', 'News') if isinstance(entry.get('source'), dict) else 'News'
        headlines.append({
            'title': title,
            'source': source,
            'published': _relative_time(entry.get('published_parsed')),
            'link': entry.get('link', ''),
            'category': _classify_news(title),
        })
    return headlines


def get_news_headlines():
    """Returns up to 5 Google News RSS headlines about Indian markets."""
    result = _get_cached('news', 'news', _fetch_news)
    return result if result else []


# ─── Portfolio Prices ─────────────────────────────────────────────────────────

def get_live_prices(tickers):
    """
    Fetches current prices for a list of tickers.
    Returns dict: { ticker: { price, change, change_abs } }
    For MF AMFI codes (numeric), fetches via AMFI API instead.
    """
    if not tickers:
        return {}

    results = {}
    stock_tickers = []
    mf_tickers = []

    for t in tickers:
        if str(t).isdigit():
            mf_tickers.append(t)
        else:
            stock_tickers.append(t)

    # Fetch stocks + ETFs via yfinance
    if stock_tickers:
        try:
            data = yf.download(
                stock_tickers,
                period='5d',
                interval='1d',
                progress=False,
                group_by='ticker',
                auto_adjust=True
            )
            for ticker in stock_tickers:
                try:
                    if len(stock_tickers) == 1:
                        closes = data['Close'].dropna()
                    else:
                        closes = data[ticker]['Close'].dropna()
                    if len(closes) < 2:
                        results[ticker] = {'price': None, 'change': 0, 'change_abs': 0}
                        continue
                    latest = float(closes.iloc[-1])
                    prev = float(closes.iloc[-2])
                    change_pct = ((latest - prev) / prev) * 100 if prev else 0
                    results[ticker] = {
                        'price': round(latest, 2),
                        'change': round(change_pct, 2),
                        'change_abs': round(latest - prev, 2),
                    }
                except Exception:
                    results[ticker] = {'price': None, 'change': 0, 'change_abs': 0}
        except Exception as e:
            logger.error(f"Live price fetch failed: {e}")
            for t in stock_tickers:
                results[t] = {'price': None, 'change': 0, 'change_abs': 0}

    # Fetch MF NAVs
    for code in mf_tickers:
        try:
            nav_data = get_fund_nav(str(code))
            if nav_data:
                results[code] = {
                    'price': nav_data['nav'],
                    'change': 0,
                    'change_abs': 0,
                }
        except Exception:
            results[code] = {'price': None, 'change': 0, 'change_abs': 0}

    return results


def get_sparkline(ticker, days=30):
    """Returns last `days` daily closing prices as a list of floats."""
    try:
        t = yf.Ticker(ticker)
        hist = t.history(period=f"{days + 5}d", interval='1d')
        closes = hist['Close'].dropna().tail(days).tolist()
        return [round(float(c), 2) for c in closes]
    except Exception:
        return []


def get_stock_fundamentals(ticker):
    """Returns fundamental data dict for a given ticker via yfinance."""
    try:
        t = yf.Ticker(ticker)
        info = t.info
        return {
            'ticker': ticker,
            'name': info.get('longName') or info.get('shortName'),
            'pe_ratio': info.get('trailingPE'),
            'pb_ratio': info.get('priceToBook'),
            'eps': info.get('trailingEps'),
            'market_cap_cr': round(info.get('marketCap', 0) / 1e7, 0) if info.get('marketCap') else None,
            'week_52_high': info.get('fiftyTwoWeekHigh'),
            'week_52_low': info.get('fiftyTwoWeekLow'),
            'volume': info.get('averageVolume'),
            'dividend_yield': round(info.get('dividendYield', 0) * 100, 2) if info.get('dividendYield') else None,
            'sector': info.get('sector'),
        }
    except Exception as e:
        logger.error(f"Fundamentals fetch failed for {ticker}: {e}")
        return None

# ─── Yahoo Live Search ────────────────────────────────────────────────────────
def search_yahoo_stocks(query):
    """Hits the Yahoo Finance autocomplete endpoint for live stock ticker searches."""
    url = 'https://query2.finance.yahoo.com/v1/finance/search'
    params = {'q': query, 'quotesCount': 6, 'newsCount': 0}
    headers = {'User-Agent': 'Mozilla/5.0'}
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        results = []
        for quote in data.get('quotes', []):
            if quote.get('quoteType') in ['EQUITY', 'MUTUALFUND', 'ETF']:
                results.append({
                    'ticker': quote.get('symbol', ''),
                    'name': quote.get('longname') or quote.get('shortname') or quote.get('symbol', ''),
                    'sector': quote.get('sectorDisp') or quote.get('quoteType') or ''
                })
        return results
    except Exception as e:
        logger.error(f"Yahoo Search failed: {e}")
        return []
