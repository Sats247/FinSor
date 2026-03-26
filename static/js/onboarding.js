/* onboarding.js — 6-step risk profiling wizard */
const QUESTIONS = [
  {
    id: 'crash_reaction',
    text: 'If your portfolio dropped 25% in a month, what would you do?',
    context: 'This helps us understand your emotional response to volatility.',
    type: 'choice',
    options: [
      { value: 'sell_all',  label: 'Sell everything to prevent further loss' },
      { value: 'sell_some', label: 'Sell some to reduce exposure' },
      { value: 'hold',      label: 'Hold and wait for recovery' },
      { value: 'buy_more',  label: 'Buy more — great discount!' },
    ],
  },
  {
    id: 'age',
    text: 'How old are you?',
    context: 'Your age affects how much time you have to recover from any losses.',
    type: 'number',
    default: 30, min: 18, max: 80, unit: 'years',
  },
  {
    id: 'goal',
    text: 'What is your primary investment goal?',
    context: '',
    type: 'choice',
    options: [
      { value: 'preservation', label: 'Capital Preservation — Keep my money safe' },
      { value: 'income',       label: 'Regular Income — Monthly dividends or returns' },
      { value: 'balanced',     label: 'Balanced Growth — Mix of both' },
      { value: 'wealth',       label: 'Long-term Wealth Creation' },
    ],
  },
  {
    id: 'horizon',
    text: 'What is your investment time horizon?',
    context: 'Longer horizon = higher ability to ride out market cycles.',
    type: 'choice',
    options: [
      { value: 'lt1',   label: 'Less than 1 year' },
      { value: '1to3',  label: '1–3 years' },
      { value: '3to7',  label: '3–7 years' },
      { value: 'gt7',   label: '7+ years' },
    ],
  },
  {
    id: 'monthly_amount',
    text: 'How much can you invest monthly?',
    context: 'This helps us set realistic SIP projections for you.',
    type: 'number',
    default: 5000, min: 500, max: 200000, unit: '₹', step: 500,
  },
  {
    id: 'experience',
    text: 'How experienced are you with investing?',
    context: '',
    type: 'choice',
    options: [
      { value: 'beginner',     label: 'Beginner — I\'m just starting out' },
      { value: 'some',         label: 'Some experience — I have a few investments' },
      { value: 'comfortable',  label: 'Comfortable — I manage my own portfolio' },
      { value: 'experienced',  label: 'Experienced — I actively trade / invest' },
    ],
  },
];

let currentStep = 0;
const answers = {};

function renderStep(idx) {
  const q = QUESTIONS[idx];
  const card = document.getElementById('question-card');
  const content = document.getElementById('question-content');
  const counter = document.getElementById('step-counter');
  const bar = document.getElementById('progress-bar');
  const btnBack = document.getElementById('btn-back');
  const btnNext = document.getElementById('btn-next');

  // Transition
  card.classList.add('transitioning');
  setTimeout(() => {
    counter.textContent = `Step ${idx + 1} of ${QUESTIONS.length}`;
    bar.style.width = `${((idx + 1) / QUESTIONS.length) * 100}%`;

    if (q.type === 'choice') {
      content.innerHTML = `
        <div class="question-text">${q.text}</div>
        ${q.context ? `<p class="question-context">${q.context}</p>` : ''}
        ${q.options.map(o => `
          <button class="option-row ${answers[q.id] === o.value ? 'selected' : ''}"
            onclick="selectOption('${q.id}', '${o.value}', this)">
            <div class="option-dot"><div class="option-dot-inner"></div></div>
            <span class="option-text">${o.label}</span>
          </button>`).join('')}`;
    } else if (q.type === 'number') {
      const val = answers[q.id] || q.default;
      const fmt = q.unit === '₹' ? '₹' + val.toLocaleString('en-IN') : val + ' ' + q.unit;
      content.innerHTML = `
        <div class="question-text">${q.text}</div>
        ${q.context ? `<p class="question-context">${q.context}</p>` : ''}
        <div class="number-input-wrap" style="justify-content:center;margin-top:12px;">
          <button class="stepper-btn" onclick="stepNumber('${q.id}', -1)">−</button>
          <div style="text-align:center;min-width:160px;">
            <div style="font-family:var(--font-display);font-weight:700;font-size:var(--text-3xl);color:var(--on-surface);" id="num-display">${fmt}</div>
          </div>
          <button class="stepper-btn" onclick="stepNumber('${q.id}', 1)">+</button>
        </div>
        <input type="range" class="range-slider" id="num-slider"
          min="${q.min}" max="${q.max}" step="${q.step || 1}" value="${val}"
          oninput="sliderInput('${q.id}', this.value)"
          style="margin-top:24px;">
        <div class="slider-minmax"><span>${q.unit === '₹' ? '₹' + q.min.toLocaleString('en-IN') : q.min + ' ' + q.unit}</span><span>${q.unit === '₹' ? '₹' + q.max.toLocaleString('en-IN') : q.max + ' ' + q.unit}</span></div>`;
      if (!answers[q.id]) answers[q.id] = q.default;
    }

    btnBack.style.display = idx === 0 ? 'none' : 'flex';
    btnNext.disabled = q.type === 'choice' ? !answers[q.id] : false;
    btnNext.textContent = idx === QUESTIONS.length - 1 ? 'Get My Profile →' : 'Next →';
    card.classList.remove('transitioning');
    lucide.createIcons();
  }, 200);
}

function selectOption(id, value, el) {
  answers[id] = value;
  document.querySelectorAll('.option-row').forEach(r => r.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('btn-next').disabled = false;
}

function stepNumber(id, delta) {
  const q = QUESTIONS.find(q => q.id === id);
  const step = q.step || 1;
  answers[id] = Math.max(q.min, Math.min(q.max, (answers[id] || q.default) + delta * step));
  updateNumDisplay(id);
  document.getElementById('num-slider').value = answers[id];
}

function sliderInput(id, val) {
  answers[id] = parseInt(val);
  updateNumDisplay(id);
}

function updateNumDisplay(id) {
  const q = QUESTIONS.find(q => q.id === id);
  const el = document.getElementById('num-display');
  if (!el) return;
  const val = answers[id];
  el.textContent = q.unit === '₹' ? '₹' + val.toLocaleString('en-IN') : val + ' ' + q.unit;
}

function nextStep() {
  if (currentStep < QUESTIONS.length - 1) {
    currentStep++;
    renderStep(currentStep);
  } else {
    submitAnswers();
  }
}

function prevStep() {
  if (currentStep > 0) { currentStep--; renderStep(currentStep); }
}

async function submitAnswers() {
  const btn = document.getElementById('btn-next');
  btn.textContent = 'Analysing...'; btn.disabled = true;
  try {
    const res = await fetch('/onboard/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(answers),
    });
    const data = await res.json();
    if (data.success) showResult(data.data);
    else { btn.textContent = 'Try Again'; btn.disabled = false; }
  } catch { btn.textContent = 'Try Again'; btn.disabled = false; }
}

const RISK_DETAILS = {
  Conservative: { color: '#0891b2', desc: 'You prioritise capital safety over aggressive growth. Debt funds, liquid funds, and gold ETFs align well with your profile.' },
  Moderate:     { color: '#0058be', desc: 'You seek stable growth with limited volatility. A mix of balanced funds and short-duration debt is ideal.' },
  Balanced:     { color: '#7c3aed', desc: 'You can take measured risks for above-average returns. Balanced advantage funds and diversified equity suit you.' },
  Growth:       { color: '#b45309', desc: 'You seek strong returns and can withstand significant volatility. Mid-caps and flexi-cap funds are your territory.' },
  Aggressive:   { color: '#c0392b', desc: 'You are comfortable with high risk for potentially high returns. Small caps, sectoral funds, and direct equity fit your profile.' },
};

function showResult(data) {
  document.getElementById('question-card').style.display = 'none';
  const rc = document.getElementById('result-card');
  rc.style.display = 'block';
  const cat = data.risk_category;
  const details = RISK_DETAILS[cat] || RISK_DETAILS['Balanced'];
  const circle = document.getElementById('result-circle');
  circle.textContent = data.risk_score;
  circle.style.background = `linear-gradient(135deg, ${details.color}, ${details.color}cc)`;
  document.getElementById('result-category').textContent = cat;
  document.getElementById('result-description').textContent = details.desc;
  // Animate sub-scores
  setTimeout(() => {
    document.getElementById('sub-willingness').style.width = `${data.risk_score * 10}%`;
    document.getElementById('sub-capacity').style.width = `${Math.max(20, (10 - (answers.age - 18) / 62 * 5) * 10)}%`;
  }, 300);
  lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', () => { renderStep(0); lucide.createIcons(); });
