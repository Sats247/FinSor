<div align="center">

<svg width="120" height="120" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="120" rx="28" fill="#1F4E79"/>
  <path d="M28 82 L28 38 L58 38" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="M28 60 L52 60" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" fill="none"/>
  <path d="M65 72 C65 72 72 50 80 42 C88 34 96 58 96 58" stroke="#4FC3F7" stroke-width="4.5" stroke-linecap="round" fill="none"/>
  <circle cx="96" cy="58" r="5" fill="#4FC3F7"/>
  <path d="M65 72 L96 72" stroke="#4FC3F7" stroke-width="2" stroke-dasharray="3 3" opacity="0.6"/>
</svg>

# **FinSor**

**Precision AI Investment Advisor for Indian Retail Investors**

[![Python](https://img.shields.io/badge/Python-3.10+-1F4E79?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.x-1F4E79?style=flat-square&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Groq](https://img.shields.io/badge/Groq-Llama_3.3_70B-4FC3F7?style=flat-square)](https://groq.com)
[![License](https://img.shields.io/badge/License-MIT-grey?style=flat-square)](LICENSE)

</div>

---

## What is FinSor?

FinSor is a web app that gives Indian retail investors a personal AI-powered investment research platform — combining live market data, risk-based fund recommendations, a portfolio health scanner, and an AI chat advisor, all in one place. It's built for real investor workflows: SIP planning, tax-loss harvesting, watchlist alerts, and scenario simulation.

> 🎥 **[Watch the video walkthrough →](YOUR_VIDEO_LINK_HERE)**

---

## Features at a Glance

| Feature | What it does |
|---|---|
| **AI Research Genie** | Ask anything about Indian markets — Llama 3.3 70B answers with live context (VIX, Nifty, news, predictions) baked in. Detects cognitive biases like herd behaviour or loss aversion and gently addresses them. |
| **Market Mood Gauge** | A 0–100 Fear → Greed score computed from India VIX and Nifty vs its 200-day moving average. Refreshes every minute. |
| **Risk Profiling** | A short onboarding questionnaire scores you 1–10 across age, goal, horizon, experience, and crash reaction — then maps you to a risk category (Conservative → Aggressive). |
| **Fund Recommendations** | Curated mutual funds filtered to your risk profile, with live NAVs from AMFI. Recommendations auto-adjust when VIX spikes or Nifty breaks below its 200DMA. |
| **Portfolio Health** | Import your holdings via CSV. Scores your portfolio 0–100 on Sharpe ratio, concentration risk, and goal alignment. Flags tax-loss harvesting opportunities. |
| **SIP Simulator** | Model your wealth over 40 years with job loss periods, market crashes, and inflation — see both nominal and real corpus. |
| **ETF SIP Allocator** | Get a personalised split across Nifty, Bank Nifty, Gold, and Silver ETFs based on your age and risk score. Upgrades to a RandomForest model if you upload real ETF data. |
| **Watchlist & Alerts** | Track any NSE/BSE stock with 30-day sparklines. Set price alerts — above or below — and get notified when they trigger. |
| **Financial Calculators** | SIP future value, lump-sum growth, CAGR, and goal-seek (how much do I need to invest to reach ₹X?). |
| **System Status** | One-click health check on all 8 data integrations — yfinance, AMFI, Groq, SQLite, Polymarket, and more. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, Flask 3.x |
| AI | Groq API — Llama 3.3 70B (primary), Llama 3.1 8B (fallback) |
| ML | scikit-learn RandomForestRegressor |
| Database | SQLite with WAL mode |
| Market Data | yfinance, AMFI mfapi.in, Google News RSS, Polymarket |
| Frontend | Vanilla JS, Jinja2 templates, custom CSS |

---

## Running FinSor From Scratch

Never run a Python project before? No problem. Follow these steps exactly and you'll have FinSor running in under 10 minutes.

### Step 1 — Install Python

You need Python 3.10 or newer. Check if you already have it:

```bash
python3 --version
```

If the output says `Python 3.10.x` or higher, skip to Step 2. Otherwise download and install it from **[python.org/downloads](https://www.python.org/downloads/)** — use the latest stable release and tick **"Add Python to PATH"** during installation on Windows.

### Step 2 — Download the project

Click **Code → Download ZIP** on this page, then unzip it. Or if you have Git:

```bash
git clone <your-repo-url>
```

Then open a terminal and navigate into the folder:

```bash
cd FinSor-main
```

> **Windows tip:** Open the folder in File Explorer, click the address bar, type `cmd`, and press Enter — this opens a terminal directly in that folder.

### Step 3 — Create a virtual environment

A virtual environment keeps FinSor's dependencies isolated from the rest of your computer. Run:

```bash
# macOS / Linux
python3 -m venv venv
source venv/bin/activate

# Windows
python -m venv venv
venv\Scripts\activate
```

Your terminal prompt should now show `(venv)` at the start. This means it's active. **Keep this terminal open for all remaining steps.**

### Step 4 — Install dependencies

```bash
pip install -r requirements.txt
```

This downloads all the libraries FinSor needs. It takes about a minute on a normal connection.

### Step 5 — Get a free Groq API key

FinSor's AI features run on Groq (it's free):

1. Go to **[console.groq.com](https://console.groq.com)** and sign up
2. Click **API Keys → Create API Key**
3. Copy the key — you won't be able to see it again

### Step 6 — Create your `.env` file

In the `FinSor-main` folder, create a file called exactly `.env` (note the dot at the start) and paste this in:

```
GROQ_API_KEY=paste_your_key_here
FLASK_SECRET_KEY=make_up_any_long_random_string
```

> **Can't see the file after saving?** On macOS press `Cmd + Shift + .` in Finder to show hidden files. On Windows, enable "Show hidden items" in File Explorer's View menu.

### Step 7 — Launch

```bash
python app.py
```

You should see:

```
 * Running on http://localhost:5000
```

Open **[http://localhost:5000](http://localhost:5000)** in your browser. FinSor is running.

### Step 8 — Log in

On the login page you'll see demo investor profiles — click any one to jump straight into the app with a pre-loaded portfolio, watchlist, and risk profile. No password needed for demo accounts.

---

> **To stop the app:** press `Ctrl + C` in the terminal.
> **Next time you run it:** just activate the venv (`source venv/bin/activate`) and run `python app.py` again — you don't need to repeat Steps 1–6.

---

## Quick Start (for developers)

Already have Python set up? The short version:

```bash
git clone <your-repo-url> && cd FinSor-main
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then add your GROQ_API_KEY
python app.py
```

Open **http://localhost:5000**.

---

## Project Structure

```
FinSor-main/
├── app.py                  # All routes and API endpoints
├── config.py               # App configuration
├── engine/
│   ├── calc.py             # Financial math (SIP, CAGR, goal-seek, portfolio scoring)
│   ├── risk_engine.py      # Market regime, MMI score, fund recommendations
│   ├── data_fetch.py       # Live data (yfinance, AMFI, news, Polymarket)
│   ├── groq_client.py      # AI Genie — RAG pipeline, bias detection, retry logic
│   └── sip_model.py        # ETF allocation model (interpolation or RandomForest)
├── data/
│   ├── funds.json          # Curated fund database
│   ├── personas.json       # Demo investor profiles
│   └── nse_tickers.json    # NSE ticker reference
├── static/                 # CSS and JS
└── templates/              # HTML pages
```

---

## Demo Personas

The app ships with pre-built investor profiles so you can explore every feature immediately — a 28-year-old aggressive investor, a 52-year-old conservative retiree, a balanced mid-career professional, and more. Select any on the login page.

---

Built for **Megahackathon 2026** · MIT License
