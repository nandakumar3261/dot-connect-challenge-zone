// ============================================================================
// lib/mask.js — mobile-number masking (§5, §7, §15).
//
// Mobile numbers are collected for prize communication but must NEVER appear on
// public/student boards, and volunteers only need enough to confirm identity.
// Admins get the full number (they need it for prize contact, §16).
// ============================================================================

// "9876543210" -> "98••••••10"  (first 2 and last 2 kept, middle masked).
function maskMobile(mobile) {
  if (!mobile) return '';
  const s = String(mobile).trim();
  if (s.length <= 4) return '•'.repeat(s.length);
  const head = s.slice(0, 2);
  const tail = s.slice(-2);
  return `${head}${'•'.repeat(s.length - 4)}${tail}`;
}

module.exports = { maskMobile };
