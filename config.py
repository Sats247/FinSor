import os
from dotenv import load_dotenv

load_dotenv(override=True)

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
FLASK_SECRET_KEY = os.environ.get('FLASK_SECRET_KEY')
GEMINI_MODEL_PRIMARY   = 'gemini-2.5-flash'
GEMINI_MODEL_FALLBACK  = 'gemini-2.0-flash'
# Ordered list tried by call_genie / get_smart_regime if primary is exhausted
GEMINI_MODEL_CHAIN = [
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
    'gemini-flash-latest',
]
DB_PATH = 'finsor.db'
CACHE_TTL_MACRO = 60        # seconds
CACHE_TTL_FUNDS = 300       # seconds
CACHE_TTL_POLYMARKET = 180  # seconds
CACHE_TTL_METACULUS = 600   # seconds
CACHE_TTL_NEWS = 120        # seconds
MAX_CHAT_HISTORY = 6        # messages
MAX_INPUT_LENGTH = 500      # characters
NSE_MARKET_OPEN = '09:15'
NSE_MARKET_CLOSE = '15:30'
