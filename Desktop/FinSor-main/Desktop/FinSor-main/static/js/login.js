/* login.js */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    const btn = form.querySelector('button[type=submit]');
    if (btn) { btn.disabled = true; btn.innerHTML = 'Signing in...'; }
  });
});
