const API = '/api';

function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// Load the controlled gender list from the same config the leaderboard uses.
(async () => {
  try {
    const config = await fetch(`${API}/config`).then(r => r.json());
    const g = document.getElementById('regGender');
    g.innerHTML = '<option value="">Select…</option>' + config.genders.map(x => `<option>${esc(x)}</option>`).join('');
  } catch (err) {
    // Non-blocking — the form still works, just without a pre-filled list.
  }
})();

// Keep the mobile field digits-only as the user types (max 10).
document.getElementById('regMobile').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
});

document.getElementById('registerBtn').addEventListener('click', async () => {
  const msg = document.getElementById('registerMsg');
  msg.textContent = ''; msg.className = 'form-msg';

  const payload = {
    name: document.getElementById('regName').value.trim(),
    mobile: document.getElementById('regMobile').value.trim(),
    gender: document.getElementById('regGender').value,
    branch: document.getElementById('regBranch').value.trim(),
    section: document.getElementById('regSection').value.trim(),
    rollNumber: document.getElementById('regRoll').value.trim()
  };
  if (!payload.name || !payload.mobile || !payload.gender || !payload.branch || !payload.section) {
    msg.textContent = 'Name, mobile, gender, branch and section are required.';
    msg.className = 'form-msg err';
    return;
  }
  if (!/^[0-9]{10}$/.test(payload.mobile)) {
    msg.textContent = 'Mobile number must be exactly 10 digits.';
    msg.className = 'form-msg err';
    return;
  }

  const btn = document.getElementById('registerBtn');
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/public-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Could not register.';
      msg.className = 'form-msg err';
      return;
    }
    msg.textContent = `Registered! Your DoTT Connect ID is ${data.dotId}${data.rollNumber ? ' (roll ' + data.rollNumber + ')' : ''}. Keep this for check-in at each challenge.`;
    msg.className = 'form-msg ok';
    ['regName', 'regMobile', 'regBranch', 'regSection', 'regRoll'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('regGender').value = '';
  } catch (err) {
    msg.textContent = 'Could not reach the server. Please try again.';
    msg.className = 'form-msg err';
  } finally {
    btn.disabled = false;
  }
});
