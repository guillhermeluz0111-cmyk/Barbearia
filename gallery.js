/* Galeria circular: as fotos ficam num anel 3D que gira conforme a rolagem da página.
   Estrutura esperada no HTML: #cg-scroll > .cg-stage > #cg-ring > figure.cg-card (uma por foto). */
(function () {
  const scroller = document.getElementById('cg-scroll'), ring = document.getElementById('cg-ring');
  if (!scroller || !ring) return;
  const hint = document.getElementById('cg-hint'), bar = document.getElementById('cg-bar');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cards = [], step = 0, radius = 0, target = 0, current = 0, raf = 0;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function layout() {
    cards = Array.from(ring.children); const n = cards.length; if (!n) return;
    step = 360 / n; radius = Math.round((ring.offsetWidth / 2) / Math.tan(Math.PI / Math.max(n, 3)) * 1.3);
    cards.forEach((card, i) => { card.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`; });
    measure(); draw();
  }
  function progress() {
    const total = scroller.offsetHeight - window.innerHeight;
    return total > 0 ? clamp(-scroller.getBoundingClientRect().top / total, 0, 1) : 0;
  }
  function measure() {
    const p = progress(), n = cards.length;
    target = p * 360 * (n - 1) / Math.max(n, 1);
    if (hint) hint.classList.toggle('gone', p > 0.03);
    if (bar) bar.style.transform = `scaleX(${p})`;
  }
  function draw() {
    ring.style.transform = `translateZ(${-radius}px) rotateX(-5deg) rotateY(${-current}deg)`;
    cards.forEach((card, i) => {
      const f = Math.cos((i * step - current) * Math.PI / 180);               // 1 = de frente, -1 = de costas
      card.style.opacity = String(Math.pow(clamp((f + 0.1) / 1.1, 0, 1), 1.4).toFixed(3));
    });
  }
  function frame() {
    raf = 0; const diff = target - current;
    current = reduce || Math.abs(diff) < 0.02 ? target : current + diff * 0.14;
    draw(); if (current !== target) raf = requestAnimationFrame(frame);
  }
  function onScroll() { measure(); if (!raf) raf = requestAnimationFrame(frame); }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  ring.querySelectorAll('img').forEach(img => img.addEventListener('error', () => setTimeout(layout, 0)));
  layout(); current = target; draw();
})();
