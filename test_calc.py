"""
test_calc.py — Pytest assertions for engine/calc.py.
All 5 known test values from Section 5.1 and Section 11 must pass.
"""

import pytest
from engine.calc import future_value_sip, future_value_lump, real_return_rate, goal_seek_sip, cagr


def test_sip():
    """SIP ₹5,000/month at 12% for 10 years → ~₹11.5 lakhs"""
    result = future_value_sip(5000, 12, 120)
    assert 1_100_000 <= result <= 1_200_000, f"Expected ~₹11.5L, got {result:,.0f}"


def test_lump():
    """Lump sum ₹1L at 7% for 5 years → ~₹1.40 lakhs"""
    result = future_value_lump(100_000, 7, 5)
    assert 138_000 <= result <= 143_000, f"Expected ~₹1.4L, got {result:,.0f}"


def test_real_return():
    """Nominal 12%, inflation 6.5% → real return ~5.16%"""
    result = real_return_rate(12, 6.5)
    assert 0.050 <= result <= 0.053, f"Expected ~5.16%, got {result:.4f}"


def test_goal_seek():
    """PMT for ₹10L target at 12% over 5 years — round-trip within ₹100"""
    target = 1_000_000
    rate = 12
    months = 60
    pmt = goal_seek_sip(target, rate, months)
    fv = future_value_sip(pmt, rate, months)
    assert abs(fv - target) < 100, f"Round-trip error: {abs(fv - target):.2f}"


def test_cagr():
    """₹1L grows to ₹2L in 5 years → CAGR ~14.87%"""
    result = cagr(100_000, 200_000, 5)
    assert abs(result - 0.1487) < 0.001, f"Expected ~14.87%, got {result:.4f}"
