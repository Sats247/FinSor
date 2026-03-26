# FinSor — Precision AI Investment Advisor

FinSor is a full-stack AI-powered investment research and advisory web application for Indian retail investors.

## 🚀 How to Run

### 1. Requirements
Ensure you have Python 3.10+ installed.

### 2. Setup
- **Virtual Environment**: Use `venv` (the folder should already exist).
  ```bash
  source venv/bin/activate
  ```
- **Dependencies**: Install them using `pip`.
  ```bash
  pip install -r requirements.txt
  ```

### 3. Environment Variables
Create a `.env` file from the `.env.example` template:
```bash
GEMINI_API_KEY=your_key
FLASK_SECRET_KEY=yoursecret
```
**Note**: The Gemini API key needs to be valid for the Genie chat and diagnostic checks to work.

### 4. Direct Start
Once the environment is active, start the Flask application:
```bash
python app.py
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

## 🛠️ Features
- **Market Mood Gauge**: Real-time greedy/fear indicator.
- **AI Research Genie**: Gemini-powered RAG for Indian equity.
- **Portfolio Health Dashboard**: Scans for risk and tax-loss opportunities.
- **System Status Check**: Instant health check for all 8 data integrations.

---
Built with Flask, Vanilla JS, and Google Gemini.
