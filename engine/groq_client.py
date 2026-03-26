"""
groq_client.py — Groq RAG pipeline with cognitive bias detection, context assembly,
retry logic, and audit logging. The model NEVER generates financial numbers.

Models used:
  - call_genie        : llama-3.3-70b-versatile  (primary) → llama-3.1-8b-instant (fallback)
  - get_smart_regime  : llama-3.1-8b-instant      (fast JSON, no chat needed)
"""

import html as html_module
import json
import logging
import time

from groq import Groq
from groq import RateLimitError, APITimeoutError, APIConnectionError

from config import (
    GROQ_API_KEY,
    GROQ_MODEL_CHAIN,
    GROQ_MODEL_REGIME,
    MAX_CHAT_HISTORY,
    MAX_INPUT_LENGTH,
)

logger = logging.getLogger(__name__)

client = Groq(api_key=GROQ_API_KEY)

# ─── System Prompt ─────────────────────────────────────────────────────────────

GENIE_SYSTEM_PROMPT = """You are FinSor Genie, an AI-powered investment research assistant for Indian retail investors. You operate within strict guidelines:

RULES:
1. NEVER generate specific numbers, projections, NAV values, or allocation percentages. All numerical data comes from the FinSor calculation engine. Your role is to explain what the math decided, not to generate new numbers.
2. ALWAYS use positive, ethical framing. Never shame users. Never use fear-based language.
3. ALWAYS hedge your output. Use phrases like "funds matching your profile include...", "based on your stated risk tolerance...", "for illustrative purposes...", "you may want to consider...". Never use "you should", "you must", "buy this", "sell this".
4. DETECT cognitive biases in user messages and address them gently:
   - Herd behavior ("everyone is buying X"): Acknowledge the trend, then explain valuation context and herd risk.
   - Loss aversion ("I can't sell, I'll lose money"): Explain opportunity cost and the sunk cost fallacy with empathy.
   - Anchoring ("I bought at ₹1000, won't sell below ₹900"): Gently redirect to current fundamentals rather than purchase price.
5. ALWAYS reference at least one live market signal in your response. The current macro context will be injected below.
6. Use plain language. Define any financial term you use. Speak like a knowledgeable friend, not a textbook.
7. Adjust your tone to the market regime: more cautious in Bear, more optimistic in Bull, alert in Overheated.
8. Frame all advice around the user's stated goal, time horizon, and tax implications.

LIVE MARKET CONTEXT (injected per request):
{macro_context}

USER PROFILE:
{user_profile}

CONVERSATION HISTORY (last 6 messages):
{conversation_history}
"""

FALLBACK_RESPONSE = (
    "I'm having a moment of reflection and can't respond right now. "
    "Please try again in a few seconds. In the meantime, the live macro signals "
    "above your dashboard can give you a quick market snapshot."
)

# ─── Cognitive Bias Detection ──────────────────────────────────────────────────

BIAS_PATTERNS = {
    'herd_behavior': [
        'everyone is buying', 'everyone is selling', 'all my friends',
        'trending', 'viral stock', 'hot stock', 'people are saying',
        'everyone says', 'all are investing', 'fomo',
    ],
    'loss_aversion': [
        "can't sell", "won't sell", 'lose money', 'book a loss',
        'waiting to recover', 'holding and hoping', 'break even first',
        'at a loss', 'down on this', 'sitting on loss',
    ],
    'anchoring': [
        'bought at', 'i paid', 'my buy price', "won't sell below",
        'target is my purchase price', 'waiting for it to come back',
        'my cost price', 'purchase price', 'average price',
    ],
}

BIAS_INSTRUCTIONS = {
    'herd_behavior': """
[BIAS NOTE — HERD BEHAVIOR DETECTED]: The user may be exhibiting herd behavior. 
Gently acknowledge the trend they mention, then provide historical context about 
what happens when crowds pile into an asset simultaneously. Reference PE ratios or 
valuation if relevant. Do not shame — educate with empathy.
""",
    'loss_aversion': """
[BIAS NOTE — LOSS AVERSION DETECTED]: The user may be anchoring to avoiding a 
realized loss. Gently explain the concept of opportunity cost and the sunk cost 
fallacy. Emphasize that the purchase price is not relevant to future returns. 
Be warm and empathetic — this is emotionally difficult.
""",
    'anchoring': """
[BIAS NOTE — ANCHORING BIAS DETECTED]: The user is anchoring to their purchase 
price rather than current fundamentals. Gently redirect to what the asset is worth 
today and what drives future returns. Do not dismiss their concern — validate it, 
then broaden the perspective.
""",
}


def detect_bias(message):
    """Returns bias type string or None."""
    msg_lower = message.lower()
    for bias_type, patterns in BIAS_PATTERNS.items():
        if any(pattern in msg_lower for pattern in patterns):
            return bias_type
    return None


# ─── Context Assembly ──────────────────────────────────────────────────────────

def build_macro_context(macro_signals, regime_data, news_headlines, polymarket_signals):
    """Assembles human-readable macro context string for injection into system prompt."""
    if not macro_signals:
        return "Live market data temporarily unavailable."

    vix = macro_signals.get('india_vix', {}).get('value', 'N/A')
    nifty = macro_signals.get('nifty50', {}).get('value', 'N/A')
    nifty_change = macro_signals.get('nifty50', {}).get('change', 0)
    usd_inr = macro_signals.get('usd_inr', {}).get('value', 'N/A')
    brent = macro_signals.get('brent', {}).get('value', 'N/A')
    gold = macro_signals.get('gold', {}).get('value', 'N/A')
    regime = regime_data.get('regime', 'Unknown') if regime_data else 'Unknown'
    mmi = regime_data.get('mmi_score', 'N/A') if regime_data else 'N/A'
    mmi_label = regime_data.get('mmi_label', 'Unknown') if regime_data else 'Unknown'

    sign = '+' if isinstance(nifty_change, (int, float)) and nifty_change >= 0 else ''
    nifty_str = f"{nifty:,.2f}" if isinstance(nifty, float) else str(nifty)
    vix_str = f"{vix:.2f}" if isinstance(vix, float) else str(vix)

    news_str = '\n'.join([
        f"[{i+1}] {h['title']} — {h['source']}"
        for i, h in enumerate((news_headlines or [])[:5])
    ]) or "No headlines available."

    poly_str = '\n'.join([
        f"[{i+1}] {p['question']} — {round(p['probability']*100)}% probability"
        for i, p in enumerate((polymarket_signals or [])[:3])
    ]) or "No prediction signals available."

    return f"""
LIVE MARKET CONTEXT (as of now):
Market Regime: {regime} | MMI Score: {mmi} ({mmi_label})
Nifty 50: {nifty_str} ({sign}{nifty_change}%)
India VIX: {vix_str} | USD/INR: {usd_inr} | Brent: ${brent} | Gold: ${gold}

TOP HEADLINES:
{news_str}

PREDICTION MARKET SIGNALS:
{poly_str}
"""


def build_user_profile_context(user_data):
    """Assembles user profile string for injection into system prompt."""
    if not user_data:
        return "User profile not available."
    return f"""
USER PROFILE:
Name: {user_data.get('name', 'User')}
Age: {user_data.get('age', 'Unknown')}
Risk Category: {user_data.get('risk_category', 'Unknown')}
Experience Level: {user_data.get('experience_level', 'Unknown')}
Investment Goal: {user_data.get('goal', 'Unknown')}
Time Horizon: {user_data.get('horizon_years', 'Unknown')} years
Monthly Investable: ₹{user_data.get('monthly_investable', 'Unknown')}
"""


# ─── Groq API Call ─────────────────────────────────────────────────────────────

def call_genie(user_message, conversation_history, macro_context, user_profile, user_id=None, db_conn=None):
    """
    Main Groq RAG call.
    1. Sanitize input
    2. Detect cognitive bias
    3. Build system prompt with injected context
    4. Try primary model, fallback to secondary
    5. Log to audit_log
    6. Return response dict
    """
    # Sanitize
    user_message = html_module.escape(str(user_message)[:MAX_INPUT_LENGTH])

    # Detect bias
    bias = detect_bias(user_message)
    bias_instruction = BIAS_INSTRUCTIONS.get(bias, '')

    # Cap history
    capped_history = (conversation_history or [])[-MAX_CHAT_HISTORY:]
    history_str = '\n'.join([
        f"{'USER' if m['role'] == 'user' else 'GENIE'}: {m['content']}"
        for m in capped_history
    ]) if capped_history else "No prior conversation."

    # Assemble system prompt
    system_prompt = GENIE_SYSTEM_PROMPT.format(
        macro_context=macro_context or "Live market data temporarily unavailable.",
        user_profile=user_profile or "User profile not available.",
        conversation_history=history_str,
    ) + bias_instruction

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"USER MESSAGE: {user_message}"},
    ]

    for model_name in GROQ_MODEL_CHAIN:
        for attempt in range(3):  # up to 3 attempts per model
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=1024,
                )
                text = response.choices[0].message.content

                # Audit log
                if db_conn and user_id:
                    try:
                        db_conn.execute(
                            '''INSERT INTO audit_log 
                               (user_id, action, risk_category, recommended_funds, macro_context, reason)
                               VALUES (?, 'genie_response', ?, ?, ?, ?)''',
                            (user_id, '', '', f"msg_len={len(user_message)}, model={model_name}", bias or 'none')
                        )
                        db_conn.commit()
                    except Exception as db_err:
                        logger.warning(f"Audit log write failed: {db_err}")

                return {
                    'response': text,
                    'model_used': model_name,
                    'bias_detected': bias,
                }

            except RateLimitError as e:
                wait = 2 ** attempt  # 1s, 2s, 4s backoff
                logger.warning(f"Groq rate limit on {model_name} (attempt {attempt+1}): waiting {wait}s")
                time.sleep(wait)
                continue
            except (APITimeoutError, APIConnectionError) as e:
                logger.warning(f"Groq connection issue on {model_name} (attempt {attempt+1}): {e}")
                time.sleep(1)
                continue
            except Exception as e:
                logger.error(f"Groq call failed with {model_name}: {type(e).__name__}: {e}")
                break  # non-retriable error, try next model

    # All models failed
    logger.error("All Groq models failed. Returning static fallback.")
    return {
        'response': FALLBACK_RESPONSE,
        'model_used': 'fallback',
        'bias_detected': bias,
    }


# ─── Smart Market Regime ───────────────────────────────────────────────────────
# Cache holds both ts (last success timestamp) and data (last good result)
_regime_cache = {'ts': 0, 'data': None}

def get_smart_regime(macro_signals):
    """
    Uses Groq (llama-3.1-8b-instant) to analyze real-time macro signals and output
    a JSON dict with 'regime' (Bull, Bear, Neutral, Overheated) and a 'reason' string.
    Caches the response for 15 minutes (900 seconds) to prevent quota exhaustion.
    """
    global _regime_cache
    if time.time() - _regime_cache['ts'] < 900 and _regime_cache['data'] is not None:
        return _regime_cache['data']

    if not macro_signals:
        return {'regime': 'Neutral', 'reason': 'Waiting for live market data...'}

    vix = macro_signals.get('india_vix', {}).get('value', 'N/A')
    nifty = macro_signals.get('nifty50', {}).get('value', 'N/A')
    nifty_200 = macro_signals.get('nifty_200dma', 'N/A')
    usd = macro_signals.get('usd_inr', {}).get('value', 'N/A')
    brent = macro_signals.get('brent', {}).get('value', 'N/A')

    system_prompt = (
        "You are an expert quantitative macro analyst. Based on the following live Indian market data, "
        "determine the current Market Regime. You MUST choose exactly one of: ['Bull', 'Bear', 'Neutral', 'Overheated'].\n"
        "Also provide a 1-sentence analytical reason for your choice (max 20 words).\n"
        "Return ONLY a valid JSON object in this exact format: {\"regime\": \"...\", \"reason\": \"...\"}"
    )
    user_prompt = (
        f"Nifty 50: {nifty}\n"
        f"Nifty 200DMA: {nifty_200}\n"
        f"India VIX: {vix}\n"
        f"USD/INR: {usd}\n"
        f"Brent Crude: {brent}"
    )

    try:
        response = client.chat.completions.create(
            model=GROQ_MODEL_REGIME,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.1,
            max_tokens=100,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
        data = json.loads(raw)

        # Sanitize regime value
        valid_regimes = ['Bull', 'Bear', 'Neutral', 'Overheated']
        if data.get('regime') not in valid_regimes:
            data['regime'] = 'Neutral'

        _regime_cache = {'ts': time.time(), 'data': data}
        return data

    except (RateLimitError, APITimeoutError, APIConnectionError) as e:
        logger.warning(f"Smart Regime transient error (Groq): {type(e).__name__}: {e}")
        # Serve stale cache if available rather than falling to deterministic fallback
        if _regime_cache['data'] is not None:
            logger.info("Serving stale regime cache due to transient Groq error")
            return _regime_cache['data']
    except Exception as e:
        logger.error(f"Smart Regime (Groq) failed: {type(e).__name__}: {e}")
        if _regime_cache['data'] is not None:
            return _regime_cache['data']

    # Deterministic fallback if AI fails completely
    fallback = {'regime': 'Neutral', 'reason': 'AI over limit. Base MMI metrics show neutral bias.'}
    if vix != 'N/A' and isinstance(vix, (int, float)):
        if vix > 22:
            fallback = {'regime': 'Bear', 'reason': 'High implied volatility suggests increased fear and downside risk.'}
        elif (
            nifty != 'N/A' and isinstance(nifty, (int, float))
            and nifty_200 != 'N/A' and isinstance(nifty_200, (int, float))
        ):
            if nifty > nifty_200 and vix < 15:
                fallback = {'regime': 'Bull', 'reason': 'Index trending above 200DMA amidst stable volatility.'}

    return fallback
