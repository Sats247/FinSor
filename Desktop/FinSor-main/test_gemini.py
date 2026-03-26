"""
test_groq.py — Quick smoke-test for the Groq API connection and groq_client module.
Run: python test_groq.py
"""
import os
from dotenv import load_dotenv
load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
print(f"API Key loaded: {'YES — ' + api_key[:12] + '...' if api_key else 'NO — THIS IS YOUR PROBLEM'}")

from groq import Groq

client = Groq(api_key=api_key)

# ── Test 1: Raw Groq API call ─────────────────────────────────────────────────
print("\n[Test 1] Raw Groq API call (llama-3.3-70b-versatile)...")
try:
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": "Say hello in one sentence."}],
        max_tokens=50,
    )
    print("SUCCESS:", response.choices[0].message.content)
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")

# ── Test 2: Fast regime model ─────────────────────────────────────────────────
print("\n[Test 2] Regime detection (llama-3.1-8b-instant, JSON mode)...")
import json
try:
    response = client.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": "Return ONLY valid JSON: {\"regime\": \"Bull\", \"reason\": \"test\"}"},
            {"role": "user", "content": "Test input."},
        ],
        max_tokens=60,
        response_format={"type": "json_object"},
    )
    data = json.loads(response.choices[0].message.content)
    print("SUCCESS:", data)
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")

# ── Test 3: Full groq_client.call_genie ───────────────────────────────────────
print("\n[Test 3] groq_client.call_genie() end-to-end...")
try:
    from engine.groq_client import call_genie
    result = call_genie(
        user_message="What is a mutual fund?",
        conversation_history=[],
        macro_context="Nifty 50: 22,400. VIX: 14. Regime: Bull.",
        user_profile="Name: Test User. Risk: Balanced. Goal: Wealth creation.",
    )
    words = len(result.get('response', '').split())
    print(f"SUCCESS: {words} words. Model: {result.get('model_used')}. Bias: {result.get('bias_detected')}")
    print("Snippet:", result['response'][:200], "...")
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")
