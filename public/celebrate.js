// Motion: fejring når et resultat gemmes, konfetti og "BETALT"-stempel.
import { esc, reducedMotion, teamName } from './core.js?v=dev';
import { drinkSvg, drinkName, trophySvg } from './drinks.js?v=dev';

const SPRING = 'cubic-bezier(.2, 1.35, .4, 1)';
const OUT = 'cubic-bezier(.16, 1, .3, 1)';
const PALETTE = ['#003858', '#1b6f9e', '#7cc0e8', '#ffffff', '#ffd66b', '#3ecf8e'];

// ───── Konfetti ─────

function confetti({ origins, count = 140, colors = PALETTE, power = 1 }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();

  const parts = [];
  for (let i = 0; i < count; i++) {
    const o = origins[i % origins.length];
    const angle = o.angle + (Math.random() - 0.5) * o.spread;
    const speed = (8 + Math.random() * 10) * power;
    const ball = Math.random() < 0.12; // små bordtennisbolde imellem papirstykkerne
    parts.push({
      x: o.x,
      y: o.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: ball ? 7 : 6 + Math.random() * 6,
      h: ball ? 7 : 3 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      tilt: Math.random() * Math.PI,
      vt: 0.08 + Math.random() * 0.12,
      color: ball ? '#ffffff' : colors[(Math.random() * colors.length) | 0],
      ball,
      life: 0,
    });
  }

  return new Promise((resolve) => {
    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 16.67, 2.5);
      last = now;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = 0;
      for (const p of parts) {
        p.life += dt;
        p.vx *= 0.985 ** dt;
        p.vy = p.vy * 0.985 ** dt + 0.32 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.tilt += p.vt * dt;
        if (p.y > innerHeight + 30) continue;
        alive++;
        const fade = Math.max(0, Math.min(1, (260 - p.life) / 60));
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.ball) {
          ctx.beginPath();
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,56,88,.35)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.scale(1, Math.cos(p.tilt)); // papiret "vender" i luften
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        }
        ctx.restore();
      }
      if (alive && parts[0].life < 320) requestAnimationFrame(frame);
      else {
        canvas.remove();
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

export function confettiAt(el, opts = {}) {
  if (reducedMotion()) return Promise.resolve();
  const r = el.getBoundingClientRect();
  return confetti({
    origins: [{ x: r.left + r.width / 2, y: r.top + r.height / 2, angle: -Math.PI / 2, spread: Math.PI * 1.1 }],
    count: 36,
    power: 0.55,
    ...opts,
  });
}

// ───── Hjælpere ─────

function countUp(el, to, duration = 700) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(to * (1 - (1 - t) ** 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Lad elementer glide ind én efter én.
export function stagger(elements, { delay = 0, gap = 45, y = 14 } = {}) {
  if (reducedMotion()) return;
  elements.forEach((el, i) =>
    el.animate(
      [
        { opacity: 0, transform: `translateY(${y}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 520, delay: delay + i * gap, easing: OUT, fill: 'backwards' },
    ),
  );
}

// ───── Fejring når et resultat er gemt ─────

export function celebrate({ winners, losers, stake, count, score }) {
  const reduce = reducedMotion();
  const words = `${winners.join(' & ')} vinder!`.split(' ');
  const root = document.createElement('div');
  root.className = 'celebrate';
  root.innerHTML = `
    <div class="cel-card" role="dialog" aria-modal="true" aria-label="Resultatet er gemt">
      <div class="cel-rays" aria-hidden="true"></div>
      <div class="cel-trophy">${trophySvg(88)}</div>
      <p class="cel-kicker">Kampen er afgjort</p>
      <h2 class="cel-title">${words.map((w) => `<span>${esc(w)}</span>`).join(' ')}</h2>
      ${score ? `<p class="cel-score"><span data-to="${score[0]}">0</span><i>–</i><span data-to="${score[1]}">0</span></p>` : ''}
      <div class="cel-drinks">${Array.from({ length: count }, () => `<div class="cel-drink">${drinkSvg(stake, { size: 104 })}</div>`).join('')}</div>
      <p class="cel-debt"><b>${teamName(losers)}</b> giver ${esc(drinkName(stake, count))}</p>
      <button type="button" class="primary cel-ok">Fedt! 🏓</button>
    </div>`;
  document.body.append(root);

  const card = root.querySelector('.cel-card');
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];

  root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, fill: 'both' });

  if (reduce) {
    qa('[data-to]').forEach((el) => (el.textContent = el.dataset.to));
  } else {
    card.animate(
      [
        { transform: 'translateY(60px) scale(.7)', opacity: 0 },
        { transform: 'translateY(-6px) scale(1.03)', opacity: 1, offset: 0.7 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 700, easing: OUT, fill: 'both' },
    );
    q('.cel-trophy').animate(
      [
        { transform: 'scale(0) rotate(-35deg)' },
        { transform: 'scale(1.25) rotate(10deg)', offset: 0.6 },
        { transform: 'scale(1) rotate(0)' },
      ],
      { duration: 800, delay: 180, easing: SPRING, fill: 'both' },
    );
    q('.cel-rays').animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }], {
      duration: 900,
      delay: 250,
      easing: OUT,
      fill: 'both',
    });
    q('.cel-kicker').animate([{ opacity: 0, letterSpacing: '.6em' }, { opacity: 1, letterSpacing: '.18em' }], {
      duration: 700,
      delay: 300,
      easing: OUT,
      fill: 'both',
    });
    qa('.cel-title span').forEach((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: 'translateY(26px) rotate(6deg)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 650, delay: 420 + i * 80, easing: SPRING, fill: 'both' },
      ),
    );
    const t0 = 560 + words.length * 80;
    qa('[data-to]').forEach((el) => setTimeout(() => countUp(el, Number(el.dataset.to)), t0));
    // Drikkevarerne falder ned og hopper på plads.
    qa('.cel-drink').forEach((el, i) => {
      const tilt = (Math.random() - 0.5) * 50;
      el.animate(
        [
          { transform: `translateY(-340px) rotate(${tilt}deg)`, opacity: 0 },
          { transform: 'translateY(0) rotate(0)', opacity: 1, offset: 0.5 },
          { transform: 'translateY(-34px) rotate(-4deg)', offset: 0.68 },
          { transform: 'translateY(0) rotate(0)', offset: 0.82 },
          { transform: 'translateY(-9px) rotate(2deg)', offset: 0.91 },
          { transform: 'none' },
        ],
        { duration: 1100, delay: t0 + 120 + i * 150, easing: 'cubic-bezier(.33,0,.67,1)', fill: 'both' },
      );
      el.classList.add('shine');
      el.style.setProperty('--shine-delay', `${t0 + 900 + i * 150}ms`);
    });
    const tDebt = t0 + 500 + count * 150;
    for (const [sel, delay] of [
      ['.cel-debt', tDebt],
      ['.cel-ok', tDebt + 150],
    ]) {
      q(sel).animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], {
        duration: 500,
        delay,
        easing: OUT,
        fill: 'both',
      });
    }
    // Konfetti fra to "kanoner" i bunden + et pust fra pokalen.
    const tr = q('.cel-trophy').getBoundingClientRect();
    setTimeout(
      () =>
        confetti({
          origins: [
            { x: 0, y: innerHeight, angle: -Math.PI / 3, spread: 0.6 },
            { x: innerWidth, y: innerHeight, angle: (-2 * Math.PI) / 3, spread: 0.6 },
            { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2, angle: -Math.PI / 2, spread: Math.PI * 1.4 },
          ],
          count: 170,
          power: Math.max(1, innerHeight / 700),
          colors: [...PALETTE, stake === 'arla' ? '#8f5d3f' : '#cfe6f2'],
        }),
      260,
    );
  }

  return new Promise((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      card.animate([{ transform: 'none' }, { transform: 'scale(.94)' }], { duration: 220, fill: 'forwards' });
      a.onfinish = () => {
        root.remove();
        resolve();
      };
    };
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    root.addEventListener('click', (e) => (e.target === root || e.target.closest('.cel-ok')) && close());
    q('.cel-ok').focus({ preventScroll: true });
  });
}

// ───── "BETALT"-stempel ─────

export function stampPaid(row) {
  const stamp = document.createElement('span');
  stamp.className = 'stamp';
  stamp.textContent = 'Betalt ✓';
  row.append(stamp);
  if (reducedMotion()) return;
  stamp.animate(
    [
      { transform: 'translate(-50%, -50%) scale(2.6) rotate(-28deg)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(.92) rotate(-11deg)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-50%, -50%) scale(1) rotate(-12deg)', opacity: 1 },
    ],
    { duration: 520, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' },
  );
  row.animate(
    [
      { transform: 'none' },
      { transform: 'translateY(3px)', offset: 0.55 },
      { transform: 'translateX(-2px)', offset: 0.7 },
      { transform: 'translateX(2px)', offset: 0.85 },
      { transform: 'none' },
    ],
    { duration: 520 },
  );
  setTimeout(() => confettiAt(stamp, { count: 22 }), 260);
}
