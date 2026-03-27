# 🛡️ FinSor — AI Investment Research & Advisory

**FinSor** is an institutional-grade investment research platform reimagined for the Indian retail investor. Built for a hackathon MVP, it combines real-time market signals, deterministic financial engines, and advanced LLM-powered advisory to provide a professional terminal experience.

DISCLAIMER - PLEASE DOWNLOAD THIS CSV FILE WHICH CONTAINS TRAINING DATA FOR OUR RECOMENDATION ENGINE ML MODEL, WHICH CAN BE UPLOADED FOR A WORKING DEMONSTRATION. - - 📈 **[Download trainingdataset.csv](./trainingdataset.csv)** — *Historical price dataset used to train the SIP allocation model.

---

## 📺 Demo Video
> [!NOTE]
> *Developer Note: I'll add the demo video link here shortly once finalized.*
> 

---

## 🚀 Phase 1: Building & running the Application

To get the FinSor MVP running locally for evaluation, follow these steps:

### 1. Prerequisites
- **Python 3.9+**
- **pip** (Python package manager)

### 2. Installation & Setup
```bash
# 1. Clone or navigate to the repository
# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 3. Install dependencies
cd finsor
pip install -r requirements.txt
```

### 3. Environment Configuration
We have included a **temporary Groq API Key** for the judges to ensure the AI Advisor ("Genie") and Smart Regime analysis work out-of-the-box. 

Rename `.env.example` to `.env` in the `finsor/` directory:
```bash
mv .env.example .env
```
*(The key is already pre-filled in `.env.example` for your convenience.)*

### 4. Direct Execution
```bash
python app.py
```
Visit `http://127.0.0.1:5000` in your browser.

---

## 🛠️ Comprehensive Tech Stack

| Category | Technology | Usage Details |
| :--- | :--- | :--- |
| **Backend** | `Flask`, `Flask-CORS` | Core server logic, secure API routing, and session management. |
| **Database** | `SQLite3` | Local persistent storage for user personas, portfolios, and audit logs (`finsor.db`). |
| **Machine Learning** | `scikit-learn` | **RandomForestRegressor** in `sip_model.py` for dynamic ETF SIP allocation. |
| **AI / NLP Advisor** | `Groq` (Llama 3.3/3.1) | Powers the "FinSor Genie" RAG chatbot and Smart Market Regime analysis. |
| **Market Data** | `yfinance` | Real-time fetching of High-frequency indicators (Nifty, VIX, Brent, Gold). |
| **Data Analytics** | `Pandas`, `NumPy` | Financial math, portfolio health scoring, and dataset manipulation. |
| **Macro Intelligence**| `feedparser` | Dynamic ingestion of financial News feeds for AI contextualization. |
| **Embedded UI** | *TradingView Widget* | **Institutional `<iframe>` Integration** for advanced technical charting. |
| **Charts** | *Chart.js* | Interactive `<canvas>` rendering for portfolio distribution and sensitivity. |
| **Security** | `python-dotenv` | Handling secure environment variables and API credentials. |

---

## 📊 Evaluation Assets (Direct Download)

To test the platform's advanced features like Portfolio Import and ML Training, use these sample assets:

- 📋 **[Download port.csv](./port.csv)** — *Sample 1 user holdings for testing P&L and Tax-Loss Harvesting.*
- - 📋 **[Download port 2.csv](./port%202.csv)** — *Sample 2 user holdings for testing P&L and Tax-Loss Harvesting.*
- 📈 **[Download trainingdataset.csv](./trainingdataset.csv)** — *Historical price dataset used to train the SIP allocation model.  USE THIS FOR A WORKING DEMONSTRATION OF OUR ML MODEL*

---

## 🔑 Groq API Key & Policy
While we have provided a temporary key in `.env.example`, the system also contains a **deterministic fallback engine**. If the API key is missing or over-limit, the application will automatically switch to rule-based logic to ensure the judges never see a broken UI.

---

*This project is a hackathon MVP submission. For educational purposes only.*
# PHASE - 2 (Product summary):

# Why FinSor

---

## 1. Stress-Tested Wealth Simulation (Not Just Projections):

We move beyond linear “happy-path” calculators by modeling adverse conditions:

- Job Disruption Modeling: Simulates pauses in SIPs due to income shocks  
- Market Shock Simulation: Recreates downturn scenarios (e.g., 2008/2020 analogs)  
- Inflation-Adjusted Outputs: Displays real purchasing power, not nominal returns  
- Probabilistic Outcomes: Provides worst / likely / best-case bands instead of a single misleading estimate  

**Outcome:**  
Users understand downside risk before it happens.  

Brands like zerodha, groww only have sip calculators with data like monthly investment, expected return and time period. They do not possess "DISASTER SCENARIO" simulators like how we have implemented.

---

## 2. Hybrid Intelligence: ML + RAG (Not a Chatbot)

FinSor separates mathematical decisioning from contextual reasoning:

### 📊 ML Engine (Deterministic)

- RandomForestRegressor model trained on ETF + SIP historical data (Kaggle + enriched features(finetuned by us))  
- Incorporates risk score, age, and investment horizon  
- Outputs pure numerical recommendations (non-LLM, no token-based inference)  
- Eliminates ambiguity seen in typical chatbot suggestions and gpt wrappers  

### 🧠 RAG Research Genie (Advisory Layer)

- Built on a Groq-powered Retrieval-Augmented Generation pipeline (RAG PIPELINE)  

**Integrates:**
- Portfolio + user profile context  
- Yahoo Finance API (market data)  
- Google RSS (news sentiment)  
- Polymarket (forward-looking signals)  

- Performs bias detection (FOMO, loss aversion)  
- Enforces grounded responses only (no hallucinated metrics)  

**Outcome:**
- ML = what you should do mathematically  
- RAG = why it makes sense in current conditions - explanations to the user  

---

## 3. True Personalization (State-Aware System)

Decisions are based on:

- Portfolio composition  
- Risk tolerance  
- Age & financial goals  

No static outputs — every response is state-dependent and user-specific  

---

## 4. Data Ownership & Portability

- CSV Import with validation (symbols, quantities)  
- Full export capability (no vendor lock-in)  

**Outcome:**  
Users retain control over their financial data.

---

## 5. Action-Oriented Tooling (Not Just Insights)

- SIP, Lumpsum, CAGR, and Goal-Seek calculators  
- Tax-loss harvesting insights  
- Graph-based financial visualization  

All of this is based on mathematical and statistical formulas, not just blind LLM usage.

---

## 6. Structured User Flow

Login → Risk Profiling → Dashboard → Portfolio Upload → Actionable Insights

---

## Key Differentiator

Most platforms rely solely on LLMs for advisory, which produce probabilistic, language-based outputs.  

FinSor instead:

- Uses ML for deterministic financial computation  
- Uses RAG for real-time, context-aware reasoning  

This hybrid architecture ensures:

- Accuracy (heavily math-driven, using statistical formulas to deal with calculations.)  
- Relevance (live data-driven)  
- Reliability (no knowledge cutoff limitations)  

---

## Bottom Line

FinSor is not a calculator or a chatbot.  

It is a decision-support system for anyone and everyone interested in trading, and is operating under uncertainity.
"""


