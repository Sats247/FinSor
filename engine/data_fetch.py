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

TICKERS = ['^NSEI', '^BSESN', '^INDIAVIX', 'USDINR=X', 'BZ=F', 'GC=F',
           '^GSPC', '^NDX', '^STOXX50E']
TICKER_KEYS = ['nifty50', 'sensex', 'india_vix', 'usd_inr', 'brent', 'gold',
               'sp500', 'nasdaq100', 'eurostoxx50']


def _get_cached(key, ttl_key, fetch_fn, force_refresh=False):
    """Generic TTL cache. Returns stale data rather than crashing on fetch failure."""
    now = time.time()
    ttl = CACHE_TTL.get(ttl_key, 60)
    if not force_refresh and key in _cache and (now - _cache[key]['ts']) < ttl:
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


def get_macro_signals(force_refresh=False):
    """Returns macro signals dict with 60s cache."""
    return _get_cached('macro', 'macro', _fetch_macro_raw, force_refresh=force_refresh)


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


# ─── Polymarket (Predictions) ───────────────────────────────────────────────────

import json as _json

POLYMARKET_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json",
}

FINANCE_KEYWORDS = [
    "india", "nifty", "sensex", "rbi", "rupee", "inflation", "fed", "rate",
    "recession", "war", "ukraine", "russia", "china", "oil", "gold", "bitcoin",
    "economy", "gdp", "election", "budget", "market", "stock", "tariff", "trump",
    "pakistan", "nuclear", "conflict", "nato", "iran"
]

def fetch_predictions():
    try:
        url = "https://gamma-api.polymarket.com/markets"
        params = {
            "limit": 100,
            "active": "true",
            "closed": "false",
            "order": "volume24hr",
            "ascending": "false",
        }
        resp = requests.get(url, params=params, headers=POLYMARKET_HEADERS, timeout=10)
        resp.raise_for_status()
        markets = resp.json()

        results = []
        for m in markets:
            question = m.get("question", "") or m.get("title", "") or ""
            if not any(kw in question.lower() for kw in FINANCE_KEYWORDS):
                continue
            try:
                prices_raw = m.get("outcomePrices") or "[]"
                prices = _json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                probability = round(float(prices[0]) * 100) if prices else 0
            except Exception:
                probability = 0
            try:
                volume = round(float(m.get("volume24hr") or m.get("volume") or 0))
            except Exception:
                volume = 0
            slug = m.get("slug", "")
            results.append({
                "title": question[:80] + ("..." if len(question) > 80 else ""),
                "probability": probability,
                "volume": volume,
                "url": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
                "source": "Polymarket",
            })
            if len(results) >= 8:
                break

        if not results:
            return _fetch_polymarket_fallback()
        return results

    except Exception as e:
        logger.warning(f"Polymarket primary fetch failed: {e}")
        return _fetch_polymarket_fallback()


def _fetch_polymarket_fallback():
    try:
        url = "https://gamma-api.polymarket.com/events"
        params = {"limit": 50, "active": "true", "order": "volume", "ascending": "false"}
        resp = requests.get(url, params=params, headers=POLYMARKET_HEADERS, timeout=10)
        resp.raise_for_status()
        events = resp.json()
        results = []
        for event in events:
            title = event.get("title", "") or ""
            if not any(kw in title.lower() for kw in FINANCE_KEYWORDS):
                continue
            try:
                markets = event.get("markets", [])
                prices_raw = markets[0].get("outcomePrices", "[]") if markets else "[]"
                prices = _json.loads(prices_raw) if isinstance(prices_raw, str) else prices_raw
                probability = round(float(prices[0]) * 100) if prices else 0
            except Exception:
                probability = 0
            try:
                volume = round(float(event.get("volume") or 0))
            except Exception:
                volume = 0
            slug = event.get("slug", "")
            results.append({
                "title": title[:80] + ("..." if len(title) > 80 else ""),
                "probability": probability,
                "volume": volume,
                "url": f"https://polymarket.com/event/{slug}" if slug else "https://polymarket.com",
                "source": "Polymarket",
            })
            if len(results) >= 8:
                break
        return results
    except Exception as e:
        logger.error(f"Polymarket fallback also failed: {e}")
        return []


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
