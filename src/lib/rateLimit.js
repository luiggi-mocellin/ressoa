'use strict';
// Janela fixa por chave, guardada no próprio objeto (uma conexão).
function hit(holder, key, { windowMs, max }) {
  const now = Date.now();
  const rate = (holder.rate ||= {});
  const b = (rate[key] ||= { start: now, n: 0 });
  if (now - b.start >= windowMs) { b.start = now; b.n = 0; }
  return ++b.n <= max;
}

module.exports = { hit };
