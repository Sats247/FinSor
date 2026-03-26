import os
from dotenv import load_dotenv

load_dotenv(override=True)

GROQ_API_KEY = os.environ.get('GROQ_API_KEY')
FLASK_SECRET_KEY = os.environ.get('FLASK_SECRET_KEY')

# Primary chat model — 70B for quality answers, still very fast on Groq hardware
GROQ_MODEL_PRIMARY  = 'llama-3.3-70b-versatile'
# Fallback chat model — 8B instant, fires in ~200ms
GROQ_MODEL_FALLBACK = 'llama-3.1-8b-instant'
# Model chain tried in order by call_genie
GROQ_MODEL_CHAIN = [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
]
# Dedicated fast model for regime JSON detection (pure speed, small output)
GROQ_MODEL_REGIME = 'llama-3.1-8b-instant'

DB_PATH = 'finsor.db'
CACHE_TTL_MACRO      = 60        # seconds
CACHE_TTL_FUNDS      = 300       # seconds
CACHE_TTL_POLYMARKET = 180       # seconds
CACHE_TTL_METACULUS  = 600       # seconds
CACHE_TTL_NEWS       = 120       # seconds
MAX_CHAT_HISTORY     = 6         # messages
MAX_INPUT_LENGTH     = 500       # characters
NSE_MARKET_OPEN      = '09:15'
NSE_MARKET_CLOSE     = '15:30'
