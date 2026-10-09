// Illustrationer af det, vi spiller om. Tegnet som SVG (ingen rigtige logoer).
let uid = 0;

export const DRINKS = {
  monster: { name: 'Hvid Monster', inline: 'hvid Monster', short: 'Monster', color: '#cfe6f2' },
  arla: { name: 'Arla Protein kakao', inline: 'Arla Protein kakao', short: 'Protein kakao', color: '#8b5a3c' },
};

export const drinkName = (stake, count = 1) => `${count}× ${DRINKS[stake]?.name ?? stake}`;

function monsterCan(id) {
  return `
    <defs>
      <linearGradient id="body${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#cfd6dc"/><stop offset=".32" stop-color="#ffffff"/>
        <stop offset=".62" stop-color="#f1f4f6"/><stop offset="1" stop-color="#b9c3cb"/>
      </linearGradient>
      <linearGradient id="metal${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#8f9aa3"/><stop offset=".4" stop-color="#eef2f5"/>
        <stop offset=".7" stop-color="#b3bdc5"/><stop offset="1" stop-color="#7f8a93"/>
      </linearGradient>
      <linearGradient id="ice${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#9fd3ee"/><stop offset="1" stop-color="#e3f3fb"/>
      </linearGradient>
      <clipPath id="clip${id}"><rect x="10" y="16" width="40" height="90" rx="3"/></clipPath>
    </defs>
    <ellipse cx="30" cy="116" rx="19" ry="3" fill="#000" opacity=".12"/>
    <rect x="24" y="2.5" width="12" height="5" rx="2.5" fill="#a9b4bc"/>
    <path d="M13 9.5Q13 6 16.5 6h27Q47 6 47 9.5L50 16H10Z" fill="url(#metal${id})"/>
    <rect x="10" y="16" width="40" height="90" rx="3" fill="url(#body${id})"/>
    <g clip-path="url(#clip${id})">
      <path d="M10 62 50 42v14L10 76Z" fill="url(#ice${id})" opacity=".9"/>
      <path d="M10 80 50 60v4L10 84Z" fill="#9fd3ee" opacity=".55"/>
      <g class="fizz" fill="#ffffff" stroke="#bfe2f3" stroke-width=".6">
        <circle cx="20" cy="98" r="1.6"/><circle cx="31" cy="102" r="1.2"/><circle cx="40" cy="96" r="1.8"/>
        <circle cx="26" cy="90" r="1"/><circle cx="36" cy="88" r="1.3"/>
      </g>
      <rect x="15" y="16" width="5" height="90" fill="#fff" opacity=".75"/>
    </g>
    <text x="30" y="38" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="6.5"
      font-weight="800" letter-spacing="1.2" fill="#6f7f8b">ENERGY</text>
    <text x="30" y="46" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="4.5"
      font-weight="700" letter-spacing="1" fill="#9aa8b2">ZERO SUGAR</text>
    <path d="M10 104h40l-2.5 7.5Q46.5 114 44 114H16q-2.5 0-3.5-2.5Z" fill="url(#metal${id})"/>`;
}

function cocoaBottle(id) {
  return `
    <defs>
      <linearGradient id="cocoa${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#5a3221"/><stop offset=".35" stop-color="#8f5d3f"/>
        <stop offset=".7" stop-color="#7a4b31"/><stop offset="1" stop-color="#4c2a1b"/>
      </linearGradient>
      <linearGradient id="cap${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#2f1a10"/><stop offset=".45" stop-color="#6b4430"/><stop offset="1" stop-color="#2a170e"/>
      </linearGradient>
      <clipPath id="bclip${id}"><path d="M22 18h16l5 12q5 3 5 10v64q0 8-8 8H20q-8 0-8-8V40q0-7 5-10Z"/></clipPath>
    </defs>
    <ellipse cx="30" cy="116" rx="18" ry="3" fill="#000" opacity=".12"/>
    <rect x="20" y="4" width="20" height="14" rx="3" fill="url(#cap${id})"/>
    <path d="M22 7.5h16M22 11h16M22 14.5h16" stroke="#000" stroke-opacity=".25" stroke-width=".8"/>
    <path d="M22 18h16l5 12q5 3 5 10v64q0 8-8 8H20q-8 0-8-8V40q0-7 5-10Z" fill="url(#cocoa${id})"/>
    <g clip-path="url(#bclip${id})">
      <rect x="10" y="54" width="40" height="34" fill="#fbf7f2"/>
      <path d="M10 86q10-6 20 0t20 0v4H10Z" fill="#8f5d3f"/>
      <path d="M10 56q10 5 20 0t20 0v-3H10Z" fill="#8f5d3f"/>
      <rect x="16" y="22" width="4" height="86" fill="#fff" opacity=".22"/>
    </g>
    <text x="30" y="70" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="7.4"
      font-weight="800" letter-spacing=".6" fill="#003858">PROTEIN</text>
    <text x="30" y="79" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-size="5.6"
      font-weight="700" letter-spacing="1.4" fill="#8f5d3f">KAKAO</text>`;
}

export function drinkSvg(stake, { size = 48, cls = '' } = {}) {
  const id = `d${++uid}`;
  const art = stake === 'arla' ? cocoaBottle(id) : monsterCan(id);
  return `<svg class="drink drink-${stake} ${cls}" viewBox="0 0 60 120" width="${size / 2}" height="${size}"
    role="img" aria-label="${DRINKS[stake]?.name ?? ''}">${art}</svg>`;
}

export function trophySvg(size = 72) {
  const id = `t${++uid}`;
  return `<svg class="trophy" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs>
      <linearGradient id="gold${id}" x1="0" x2="1">
        <stop offset="0" stop-color="#c98a12"/><stop offset=".45" stop-color="#ffd66b"/><stop offset="1" stop-color="#b8780a"/>
      </linearGradient>
    </defs>
    <path d="M18 8h28v14a14 14 0 0 1-28 0Z" fill="url(#gold${id})"/>
    <path d="M18 12H9q0 13 11 15M46 12h9q0 13-11 15" fill="none" stroke="url(#gold${id})" stroke-width="4" stroke-linecap="round"/>
    <rect x="29" y="35" width="6" height="10" fill="url(#gold${id})"/>
    <rect x="20" y="45" width="24" height="6" rx="2" fill="url(#gold${id})"/>
    <rect x="16" y="51" width="32" height="7" rx="2" fill="#003858"/>
    <path d="M24 11v10" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
