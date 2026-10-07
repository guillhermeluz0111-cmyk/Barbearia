/* Galeria circular: anel 3D de fotos. Gira ao tocar nas fotos/setas das laterais, arrastando (ou deslizando o dedo)
   e com as setas do teclado. Estrutura: #cg-stage > #cg-ring > figure.cg-card, botões [data-cg-prev|next], #cg-dots. */
(function () {
  const stage = document.getElementById('cg-stage'), ring = document.getElementById('cg-ring');
  if (!stage || !ring) return;
  const dotsBox = document.getElementById('cg-dots'), hint = document.getElementById('cg-hint');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cards = [], n = 0, step = 0, radius = 0, current = 0, target = 0, raf = 0;
  let drag = null, moved = false;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const mod = (v, m) => ((v % m) + m) % m;
  const active = () => mod(Math.round(current / step), n);

  function layout() {
    cards = Array.from(ring.children); n = cards.length; if (!n) return;
    step = 360 / n; radius = Math.round((ring.offsetWidth / 2) / Math.tan(Math.PI / Math.max(n, 3)) * 1.3);
    cards.forEach((card, i) => { card.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`; });
    if (dotsBox) {
      dotsBox.innerHTML = cards.map((_, i) => `<button type="button" data-cg-dot="${i}" aria-label="Ver foto ${i + 1}"></button>`).join('');
    }
    draw();
  }
  function draw() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(-4deg) rotateY(${-current}deg)`;
    cards.forEach((card, i) => {
      const f = Math.cos((i * step - current) * Math.PI / 180);                 // 1 = de frente, -1 = de costas
      card.style.opacity = String(Math.pow(clamp((f + 0.1) / 1.1, 0, 1), 1.2).toFixed(3));
      card.style.pointerEvents = f > 0.15 ? 'auto' : 'none';
      card.classList.toggle('front', f > 0.97);
    });
    if (dotsBox) { const a = active(); Array.from(dotsBox.children).forEach((d, i) => d.classList.toggle('on', i === a)); }
  }
  function frame() {
    raf = 0; const diff = target - current;
    current = reduce || Math.abs(diff) < 0.05 ? target : current + diff * 0.14;
    draw(); if (current !== target) raf = requestAnimationFrame(frame);
  }
  const go = angle => { target = angle; if (hint) hint.classList.add('gone'); if (!raf) raf = requestAnimationFrame(frame); };
  const goStep = dir => go((Math.round(target / step) + dir) * step);
  const goCard = i => { const delta = mod(i * step - current + 180, 360) - 180; go(Math.round((current + delta) / step) * step); };

  // Arrastar / deslizar (a rolagem vertical da página continua funcionando)
  stage.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { x: e.clientX, t: performance.now(), start: current, lastX: e.clientX, lastT: performance.now(), v: 0 }; moved = false;
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return; const dx = e.clientX - drag.x;
    if (!moved && Math.abs(dx) > 6) { moved = true; stage.classList.add('dragging'); try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
    if (!moved) return;
    const now = performance.now(); drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.lastT); drag.lastX = e.clientX; drag.lastT = now;
    current = target = drag.start - dx * 0.32; draw();
  });
  const endDrag = () => {
    if (!drag) return; const d = drag; drag = null; stage.classList.remove('dragging');
    if (moved) go(Math.round((current - d.v * 120 * 0.32) / step) * step);
  };
  stage.addEventListener('pointerup', endDrag); stage.addEventListener('pointercancel', endDrag);

  // Toque nas fotos laterais, setas e bolinhas
  ring.addEventListener('click', e => { if (moved) { moved = false; return; } const card = e.target.closest('.cg-card'); if (card) goCard(cards.indexOf(card)); });
  stage.addEventListener('click', e => {
    const dot = e.target.closest('[data-cg-dot]'); if (dot) return goCard(Number(dot.dataset.cgDot));
    if (e.target.closest('[data-cg-prev]')) goStep(-1); else if (e.target.closest('[data-cg-next]')) goStep(1);
  });
  stage.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); goStep(-1); } else if (e.key === 'ArrowRight') { e.preventDefault(); goStep(1); } });

  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  ring.querySelectorAll('img').forEach(img => img.addEventListener('error', () => setTimeout(layout, 0)));
  layout();
})();
