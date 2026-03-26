/* landing.js */
document.addEventListener('DOMContentLoaded', async () => {
  // Fetch live Nifty from status endpoint
  try {
    const res = await fetch('/api/macro');
    const data = await res.json();
    if (data.success && data.data.nifty50 && data.data.nifty50.value) {
      const n = data.data.nifty50;
      const el = document.getElementById('landing-nifty');
      const chip = document.getElementById('landing-nifty-chip');
      if (el) el.textContent = '₹' + n.value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
      if (chip) {
        const sign = n.change >= 0 ? '+' : '';
        chip.textContent = `${sign}${n.change.toFixed(2)}%`;
        chip.className = `chip ${n.change >= 0 ? 'chip-gain' : 'chip-loss'}`;
        chip.style.display = 'inline-flex';
      }
    }
  } catch {}

  // Animate progress bars on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.querySelectorAll('.progress-fill[data-target]').forEach(el => {
          el.style.width = el.dataset.target + '%';
        });
      }
    });
  }, { threshold: 0.3 });
  document.querySelectorAll('.analysis-mockup').forEach(el => observer.observe(el));
  if (typeof lucide !== 'undefined') lucide.createIcons();
});
