// Taber-animationen: vises på tabernes skærm. Vinderne står på podiet med kongekroner og
// jubler med pokalen, mens taberne står nedenfor og banker sig selv i hovedet med et bat.
import { esc, reducedMotion } from './core.js?v=dev';
import { DRINKS, drinkSvg } from './drinks.js?v=dev';

let uid = 0;
const JERSEYS = ['#003858', '#0b5b86'];
const SKIN = ['#f2c9a0', '#e0ac7e', '#c68b5e', '#f6d5b5'];

const initials = (name) =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
const skinFor = (name) => SKIN[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % SKIN.length];

// Kongekrone: guldkrone med fem takker, perler, juveler, rød fløjl og et kors på toppen.
function crown(id) {
  return `<g class="crown">
    <defs>
      <linearGradient id="cg${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#b8780a"/><stop offset=".4" stop-color="#ffe08a"/><stop offset=".7" stop-color="#e8b23a"/><stop offset="1" stop-color="#a86d08"/>
      </linearGradient>
    </defs>
    <path d="M-15 -6q15 -22 30 0Z" fill="#a3172a"/>
    <path d="M-20 0 -23 -22 -14 -11 -8 -26 0 -13 8 -26 14 -11 23 -22 20 0Z" fill="url(#cg${id})" stroke="#8a5a06" stroke-width=".8" stroke-linejoin="round"/>
    <circle cx="-23" cy="-23.5" r="2.4" fill="#fff6dc" stroke="#c9a24a" stroke-width=".6"/>
    <circle cx="-8" cy="-27.5" r="2.4" fill="#fff6dc" stroke="#c9a24a" stroke-width=".6"/>
    <circle cx="8" cy="-27.5" r="2.4" fill="#fff6dc" stroke="#c9a24a" stroke-width=".6"/>
    <circle cx="23" cy="-23.5" r="2.4" fill="#fff6dc" stroke="#c9a24a" stroke-width=".6"/>
    <path d="M0 -13v-20M-4.5 -28h9" stroke="url(#cg${id})" stroke-width="3" stroke-linecap="round"/>
    <rect x="-21" y="-6" width="42" height="7" rx="2" fill="url(#cg${id})" stroke="#8a5a06" stroke-width=".6"/>
    <circle cx="-12" cy="-2.5" r="2" fill="#c9372c"/><circle cx="0" cy="-2.5" r="2.4" fill="#1b6f9e"/><circle cx="12" cy="-2.5" r="2" fill="#2fa36b"/>
    <path d="M-17 -18l3 -1" stroke="#fff" stroke-opacity=".7" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;
}

function trophy(id) {
  return `<g class="held-trophy">
    <defs>
      <linearGradient id="tg${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#c98a12"/><stop offset=".45" stop-color="#ffd66b"/><stop offset="1" stop-color="#b8780a"/>
      </linearGradient>
    </defs>
    <path d="M-14 -40h28v12a14 14 0 0 1-28 0Z" fill="url(#tg${id})"/>
    <path d="M-14 -36h-7q0 10 9 12M14 -36h7q0 10-9 12" fill="none" stroke="url(#tg${id})" stroke-width="3" stroke-linecap="round"/>
    <rect x="-3" y="-14" width="6" height="8" fill="url(#tg${id})"/>
    <rect x="-10" y="-7" width="20" height="5" rx="1.5" fill="url(#tg${id})"/>
    <path d="M-7 -37v9" stroke="#fff" stroke-opacity=".6" stroke-width="2.5" stroke-linecap="round"/>
  </g>`;
}

// En figur med fødderne i (0,0). pose: 'cheer' (vinder) eller 'sad' (taber).
function figure(name, { pose, jersey, withTrophy = false }) {
  const id = ++uid;
  const skin = skinFor(name);
  const cheer = pose === 'cheer';
  const face = cheer
    ? `<circle cx="-5" cy="-92" r="2" fill="#0f2533"/><circle cx="5" cy="-92" r="2" fill="#0f2533"/>
       <path d="M-7 -85q7 9 14 0" fill="#0f2533"/><path d="M-5 -84q5 4 10 0" fill="#fff"/>
       <circle cx="-10" cy="-86" r="2.6" fill="#ff8a8a" opacity=".5"/><circle cx="10" cy="-86" r="2.6" fill="#ff8a8a" opacity=".5"/>`
    : `<path d="M-8 -93l5 2M8 -93l-5 2" stroke="#0f2533" stroke-width="1.6" stroke-linecap="round"/>
       <circle cx="-5" cy="-89" r="1.7" fill="#0f2533"/><circle cx="5" cy="-89" r="1.7" fill="#0f2533"/>
       <path d="M-6 -80q6 -6 12 0" fill="none" stroke="#0f2533" stroke-width="1.8" stroke-linecap="round"/>
       <path class="tear" d="M7 -86q2 4 0 6q-2 -2 0 -6Z" fill="#7cc0e8"/>`;
  // Arme: vinderne med hænderne i vejret, taberen med hængende arme.
  const arms = cheer
    ? `<g class="arm arm-l"><path d="M-14 -62 -30 -96" stroke="${jersey}" stroke-width="9" stroke-linecap="round"/>
         ${withTrophy ? `<g transform="translate(-31 -97) scale(.9)">${trophy(id)}</g>` : ''}<circle cx="-31" cy="-99" r="5.5" fill="${skin}"/></g>
       <g class="arm arm-r"><path d="M14 -62 30 -96" stroke="${jersey}" stroke-width="9" stroke-linecap="round"/><circle cx="31" cy="-99" r="5.5" fill="${skin}"/></g>`
    : `<g class="arm arm-l"><path d="M-13 -60 -18 -32" stroke="${jersey}" stroke-width="8" stroke-linecap="round"/><circle cx="-18" cy="-29" r="5" fill="${skin}"/></g>
       <g class="bonk-arm">
         <path d="M13 -60 24 -84" stroke="${jersey}" stroke-width="8" stroke-linecap="round"/>
         <path d="M25 -88 28.5 -96" stroke="#b07a46" stroke-width="5" stroke-linecap="round"/>
         <ellipse cx="31" cy="-106" rx="11" ry="12.5" transform="rotate(12 31 -106)" fill="#c9372c" stroke="#3a1a12" stroke-width="2"/>
         <path d="M25 -111q4 -4 9 -2" stroke="#fff" stroke-opacity=".45" stroke-width="1.8" fill="none" stroke-linecap="round"/>
         <circle cx="24" cy="-86" r="5" fill="${skin}"/>
       </g>`;
  return `<g class="fig ${cheer ? 'winner' : 'loser'}">
    <g class="body">
      <path d="M-8 -26v24M8 -26v24" stroke="#0f2533" stroke-width="7" stroke-linecap="round"/>
      <path d="M-15 -66q0-6 6-6h18q6 0 6 6v40q0 4-4 4h-22q-4 0-4-4Z" fill="${jersey}"/>
      <text x="0" y="-40" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="9" font-weight="800"
        fill="#ffffff" opacity=".9">${esc(initials(name))}</text>
      ${arms}
      <g class="head">
        <circle cx="0" cy="-88" r="15" fill="${skin}"/>
        <path d="M-15 -90q2 -16 15 -16t15 16q-6 -7 -15 -7t-15 7Z" fill="#3b2a20" opacity=".85"/>
        ${face}
        ${cheer ? `<g class="crown-wrap" transform="translate(0 -100)">${crown(id)}</g>` : ''}
      </g>
      ${cheer ? '' : `<g class="stars" aria-hidden="true">
        <path d="M-16 -112l1.5 3.5 3.5 .5-2.6 2.4.7 3.6-3.1-1.8-3.1 1.8.7-3.6-2.6-2.4 3.5-.5Z" fill="#ffd66b"/>
        <path d="M2 -121l1.5 3.5 3.5 .5-2.6 2.4.7 3.6-3.1-1.8-3.1 1.8.7-3.6-2.6-2.4 3.5-.5Z" fill="#ffe08a"/>
        <path d="M-2 -110l1 2.4 2.4 .3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3Z" fill="#fff"/>
      </g>`}
    </g>
    <text class="fig-name" x="0" y="16" text-anchor="middle">${esc(name)}</text>
  </g>`;
}

function scene({ winners, losers, myName, myDrink }) {
  const W = 360;
  const podiumW = winners.length > 1 ? 150 : 96;
  const px = (W - podiumW) / 2;
  const top = 168;
  const wx = winners.length > 1 ? [W / 2 - 36, W / 2 + 36] : [W / 2];
  // Dig selv forrest; øvrige tabere ved siden af.
  const sorted = [...losers].sort((a, b) => (b.toLowerCase() === myName ? 1 : 0) - (a.toLowerCase() === myName ? 1 : 0));
  const lx = sorted.length > 1 ? [62, W - 62] : [70];
  const rain = Array.from(
    { length: 9 },
    (_, i) => `<path class="drop" style="--d:${(i * 0.17) % 1}s" d="M${-26 + i * 6.5} 6 l-2 8" stroke="#7cc0e8" stroke-width="2" stroke-linecap="round"/>`,
  ).join('');

  return `<svg class="taunt-scene" viewBox="0 0 ${W} 300" role="img" aria-label="Vinderne jubler på podiet">
    <defs>
      <linearGradient id="pod" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stop-color="#ffd66b"/><stop offset="1" stop-color="#c98a12"/>
      </linearGradient>
      <radialGradient id="spot" cx=".5" cy="0" r="1">
        <stop offset="0" stop-color="#fff6c9" stop-opacity=".55"/><stop offset="1" stop-color="#fff6c9" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <g class="spots">
      <path class="spot spot-l" d="M20 -20 L${W / 2 - 70} 290 L${W / 2 + 20} 290Z" fill="url(#spot)"/>
      <path class="spot spot-r" d="M${W - 20} -20 L${W / 2 - 20} 290 L${W / 2 + 70} 290Z" fill="url(#spot)"/>
    </g>
    <rect x="0" y="268" width="${W}" height="32" fill="#002538"/>
    <g class="podium-g">
      <rect x="${px}" y="${top}" width="${podiumW}" height="100" rx="6" fill="url(#pod)"/>
      <rect x="${px}" y="${top}" width="${podiumW}" height="8" rx="4" fill="#fff" opacity=".35"/>
      <text x="${W / 2}" y="${top + 72}" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="56" font-weight="800" fill="#9a6a08" opacity=".55">1</text>
    </g>
    ${winners.map((n, i) => `<g class="win-g w${i}" transform="translate(${wx[i]} ${top})">${figure(n, { pose: 'cheer', jersey: JERSEYS[i % 2], withTrophy: i === 0 })}</g>`).join('')}
    ${sorted
      .map(
        (n, i) => `<g class="lose-g l${i}" transform="translate(${lx[i]} 268)">
          ${figure(n, { pose: 'sad', jersey: '#6b7d89' })}
          ${i === 0 && myDrink ? `<g class="owed" transform="translate(-30 -54) rotate(-8)">${drinkSvg(myDrink, { size: 34 })}</g>` : ''}
          <g class="cloud" transform="translate(0 -138)">
            <path d="M-26 0q-10 0-10-9t11-9q2-10 13-10 9 0 12 7 3-3 8-3 10 0 11 10 10 1 10 9t-10 5Z" fill="#8a9aa6"/>
            <g class="rain">${rain}</g>
          </g>
        </g>`,
      )
      .join('')}
  </svg>`;
}

export function showTaunt({ winners, losers, myName, myDebts = [], score }) {
  const me = myName.toLowerCase();
  const reduce = reducedMotion();
  const myDrink = myDebts[0]?.stake || null;
  const owe = myDebts.length
    ? myDebts.map((d) => `<b>${esc(d.creditor)}</b> en ${esc(DRINKS[d.stake].inline)}`).join(' og ')
    : null;
  const root = document.createElement('div');
  root.className = 'taunt';
  root.innerHTML = `
    <div class="taunt-card" role="dialog" aria-modal="true" aria-label="Du tabte">
      <p class="taunt-kicker">Øv, du tabte${score ? ` ${score[1]}–${score[0]}` : ''}</p>
      <h2 class="taunt-title">👑 ${winners.map(esc).join(' &amp; ')} er bordets ${winners.length > 1 ? 'konger' : 'konge'}</h2>
      ${scene({ winners, losers, myName: me, myDrink })}
      <p class="taunt-owe">${owe ? `Du skylder ${owe}. Køleskabet venter 🧊` : 'Bedre held næste gang!'}</p>
      <div class="taunt-actions">
        <button type="button" class="ghost taunt-ok">Det tager jeg… 😩</button>
        <button type="button" class="primary taunt-rematch">Revanche! 🏓</button>
      </div>
    </div>`;
  document.body.append(root);
  const q = (s) => root.querySelector(s);
  const qa = (s) => [...root.querySelectorAll(s)];

  root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, fill: 'both' });
  if (!reduce) {
    root.classList.add('playing');
    const spring = 'cubic-bezier(.2,1.35,.4,1)';
    q('.taunt-card').animate(
      [{ transform: 'translateY(40px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 600, easing: spring, fill: 'both' },
    );
    q('.podium-g').animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
      duration: 700,
      delay: 200,
      easing: spring,
      fill: 'both',
    });
    qa('.win-g').forEach((el, i) =>
      el.firstElementChild.animate(
        [
          { transform: 'translateY(-260px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(-14px)', offset: 0.78 },
          { transform: 'translateY(0)' },
        ],
        { duration: 900, delay: 600 + i * 160, easing: 'cubic-bezier(.33,0,.67,1)', fill: 'both' },
      ),
    );
    // Kronerne falder ned på hovederne.
    qa('.crown').forEach((el, i) =>
      el.animate(
        [
          { transform: 'translateY(-120px) rotate(-40deg)', opacity: 0 },
          { transform: 'translateY(0) rotate(8deg)', opacity: 1, offset: 0.7 },
          { transform: 'rotate(0)' },
        ],
        { duration: 700, delay: 1400 + i * 220, easing: spring, fill: 'both' },
      ),
    );
    q('.held-trophy')?.animate(
      [{ transform: 'translateY(40px) scale(.2)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 600, delay: 1900, easing: spring, fill: 'both' },
    );
    qa('.lose-g').forEach((el, i) =>
      el.firstElementChild.animate(
        [{ transform: `translateX(${i ? 80 : -80}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
        { duration: 1200, delay: 900 + i * 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
      ),
    );
    qa('.cloud').forEach((el) =>
      el.animate([{ transform: 'translate(0,-138px) scale(0)' }, { transform: 'translate(0,-138px) scale(1)' }], {
        duration: 500,
        delay: 2100,
        easing: spring,
        fill: 'both',
      }),
    );
    for (const [sel, delay] of [
      ['.taunt-kicker', 150],
      ['.taunt-title', 300],
      ['.taunt-owe', 2400],
      ['.taunt-actions', 2600],
    ]) {
      q(sel).animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
        duration: 500,
        delay,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'both',
      });
    }
  }

  return new Promise((resolve) => {
    const close = (rematch) => {
      document.removeEventListener('keydown', onKey);
      const a = root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
      a.onfinish = () => {
        root.remove();
        resolve(rematch);
      };
    };
    const onKey = (e) => e.key === 'Escape' && close(false);
    document.addEventListener('keydown', onKey);
    q('.taunt-ok').addEventListener('click', () => close(false));
    q('.taunt-rematch').addEventListener('click', () => close(true));
    q('.taunt-rematch').focus({ preventScroll: true });
  });
}
