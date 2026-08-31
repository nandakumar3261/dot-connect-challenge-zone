// Light / dark toggle shared by the public pages (§ user request #1).
// The no-flash <head> script already set data-theme before paint; here we just
// keep the toggle button's icon in sync and persist the user's choice.
(function () {
  function current() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('dcz_theme', theme); } catch (e) {}
    const btn = document.getElementById('themeToggle');
    if (btn) {
      // Show the icon for the mode you'd switch TO.
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    apply(current());
    const btn = document.getElementById('themeToggle');
    if (btn) btn.addEventListener('click', () => apply(current() === 'dark' ? 'light' : 'dark'));
  });
})();
