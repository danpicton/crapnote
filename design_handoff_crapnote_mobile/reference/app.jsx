// Crapnote mobile — design tokens, icons, chrome
// All visual choices live here. Dark/light controlled by `dark` prop.

const cnTokens = (dark) => ({
  bg:        dark ? '#1A1816' : '#F5F1EA',
  surface:   dark ? '#211E1B' : '#FBF7F0',
  surface2:  dark ? '#272320' : '#EFE9DC',
  text:      dark ? '#F0EAE0' : '#1F1B16',
  text2:     dark ? '#C7BEB1' : '#4A423A',
  muted:     dark ? '#7C7468' : '#9C9489',
  faint:     dark ? '#48433D' : '#C9C0B2',
  hair:      dark ? 'rgba(255,255,255,0.07)' : 'rgba(31,27,22,0.08)',
  accent:    '#E15A3C',
  accentSoft:dark ? 'rgba(225,90,60,0.18)' : 'rgba(225,90,60,0.12)',
  star:      '#E15A3C',
  serif:     '"Newsreader", "Iowan Old Style", "Apple Garamond", Georgia, serif',
  sans:      '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  mono:      '"SF Mono", ui-monospace, Menlo, monospace',
  // semantic action colours for swipe gestures
  pin:       '#C99A2E',
  archive:   '#5E8E6E',
  danger:    '#C0432A',
});

// ─────────────────────────────────────────
// Wordmark (no overlap with page title)
// ─────────────────────────────────────────
function CnWordmark({ size = 22, t }) {
  return (
    <span style={{
      fontFamily: t.serif, fontWeight: 700, fontSize: size,
      letterSpacing: -0.2, color: t.text, lineHeight: 1,
      display: 'inline-flex', alignItems: 'baseline',
    }}>
      Crapnote<span style={{ color: t.accent }}>.</span>
    </span>
  );
}

// ─────────────────────────────────────────
// Stroke icons — 24px grid, 1.7 stroke
// ─────────────────────────────────────────
const Icon = ({ d, size = 24, stroke = 'currentColor', fill = 'none', sw = 1.7, children, vb = 24 }) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill} stroke={stroke}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    {d ? <path d={d}/> : children}
  </svg>
);

const I = {
  plus:    (p) => <Icon {...p}><path d="M12 5v14M5 12h14"/></Icon>,
  search:  (p) => <Icon {...p}><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></Icon>,
  back:    (p) => <Icon {...p}><path d="M15 5l-7 7 7 7"/></Icon>,
  more:    (p) => <Icon {...p} fill="currentColor" stroke="none"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></Icon>,
  star:    (p) => <Icon {...p}><path d="M12 3.5l2.7 5.5 6 .9-4.4 4.3 1 6-5.4-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"/></Icon>,
  starF:   (p) => <Icon {...p} fill="currentColor"><path d="M12 3.5l2.7 5.5 6 .9-4.4 4.3 1 6-5.4-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"/></Icon>,
  pin:     (p) => <Icon {...p}><path d="M14 3l7 7-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4z"/></Icon>,
  pinF:    (p) => <Icon {...p} fill="currentColor"><path d="M14 3l7 7-3 1-4 4-1 5-2-2-4 4-1-1 4-4-2-2 5-1 4-4z"/></Icon>,
  archive: (p) => <Icon {...p}><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4"/></Icon>,
  trash:   (p) => <Icon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13M10 11v6M14 11v6"/></Icon>,
  tag:     (p) => <Icon {...p}><path d="M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9z"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/></Icon>,
  settings:(p) => <Icon {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></Icon>,
  signout: (p) => <Icon {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></Icon>,
  archiveT:(p) => <Icon {...p}><rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4"/></Icon>,
  notes:   (p) => <Icon {...p}><path d="M5 3h11l3 3v15a0 0 0 010 0H5a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M16 3v3h3M8 11h8M8 15h8M8 19h5"/></Icon>,
  sync:    (p) => <Icon {...p}><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></Icon>,
  bold:    (p) => <Icon {...p}><path d="M6 4h6.5a3.5 3.5 0 010 7H6zm0 7h7.5a3.5 3.5 0 010 7H6z"/></Icon>,
  italic:  (p) => <Icon {...p}><path d="M19 4h-9M14 20H5M15 4l-6 16"/></Icon>,
  under:   (p) => <Icon {...p}><path d="M6 3v8a6 6 0 0012 0V3M5 21h14"/></Icon>,
  link:    (p) => <Icon {...p}><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></Icon>,
  quote:   (p) => <Icon {...p}><path d="M7 7h4v6H7c-1 0-2-1-2-2V9c0-1 1-2 2-2zM15 7h4v6h-4c-1 0-2-1-2-2V9c0-1 1-2 2-2z"/></Icon>,
  code:    (p) => <Icon {...p}><path d="M9 8l-5 4 5 4M15 8l5 4-5 4"/></Icon>,
  list:    (p) => <Icon {...p}><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" sw={2}/></Icon>,
  olist:   (p) => <Icon {...p}><path d="M10 6h10M10 12h10M10 18h10M4 4l1-1v4M4 11h2.5l-2.5 3h2.5M4 16h2v1H5v1h1v1H4"/></Icon>,
  hr:      (p) => <Icon {...p}><path d="M4 12h16"/></Icon>,
  undo:    (p) => <Icon {...p}><path d="M3 7l4-4 4 4M7 3v10a4 4 0 004 4h7"/></Icon>,
  redo:    (p) => <Icon {...p}><path d="M21 7l-4-4-4 4M17 3v10a4 4 0 01-4 4H6"/></Icon>,
  H:       (p) => <Icon {...p}><path d="M6 4v16M18 4v16M6 12h12"/></Icon>,
  check:   (p) => <Icon {...p}><path d="M5 12l5 5L20 7"/></Icon>,
  chev:    (p) => <Icon {...p}><path d="M9 6l6 6-6 6"/></Icon>,
  eye:     (p) => <Icon {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></Icon>,
  x:       (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18"/></Icon>,
};

// ─────────────────────────────────────────
// App-bar pattern. Tiny wordmark + page title (NO overlap).
// ─────────────────────────────────────────
function CnAppBar({ t, title, leading, trailing, onBack, dark }) {
  return (
    <div style={{
      padding: '54px 8px 10px',
      background: t.bg,
      borderBottom: `1px solid ${t.hair}`,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 44 }}>
          {onBack ? (
            <button onClick={onBack} style={iconBtn(t)} aria-label="Back">
              <I.back size={22} stroke={t.text2}/>
            </button>
          ) : leading || <div style={{ width: 12, height: 1 }}/>}
        </div>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 44, justifyContent: 'flex-end' }}>
          {trailing}
        </div>
      </div>
      {title && (
        <h1 style={{
          margin: '8px 8px 2px',
          fontFamily: t.serif, fontWeight: 700, fontSize: 30, lineHeight: 1.1,
          color: t.text, letterSpacing: -0.4,
        }}>{title}<span style={{ color: t.accent }}>.</span></h1>
      )}
    </div>
  );
}

const iconBtn = (t) => ({
  width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 'none', background: 'transparent', color: t.text2, cursor: 'pointer',
  borderRadius: 10, padding: 0,
});

// ─────────────────────────────────────────
// Bottom tab bar — Notes / Archive / Settings / Sign out
// ─────────────────────────────────────────
function CnTabBar({ t, active, onTab, user = 'dadmin' }) {
  const tabs = [
    { k: 'notes',    label: 'Notes',    icon: I.notes },
    { k: 'archive',  label: 'Archive',  icon: I.archive },
    { k: 'settings', label: 'Settings', icon: I.settings },
  ];
  return (
    <div style={{
      flexShrink: 0,
      borderTop: `1px solid ${t.hair}`,
      background: t.bg,
      padding: '6px 8px 10px',
      display: 'flex', alignItems: 'stretch', justifyContent: 'space-around',
    }}>
      {tabs.map(tab => {
        const isActive = active === tab.k;
        const Icn = tab.icon;
        return (
          <button key={tab.k} onClick={() => onTab && onTab(tab.k)} style={{
            flex: 1, border: 'none', background: 'transparent', cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '8px 0', color: isActive ? t.accent : t.muted,
            fontFamily: t.sans, fontSize: 11, letterSpacing: 0.2,
          }}>
            <Icn size={22} stroke={isActive ? t.accent : t.muted}/>
            <span>{tab.label}</span>
          </button>
        );
      })}
      <button onClick={() => onTab && onTab('signout')} style={{
        flex: 1, border: 'none', background: 'transparent', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        padding: '8px 0', color: t.muted,
        fontFamily: t.sans, fontSize: 11, letterSpacing: 0.2,
      }}>
        <I.signout size={22} stroke={t.muted}/>
        <span>Sign out</span>
      </button>
    </div>
  );
}

Object.assign(window, { cnTokens, CnWordmark, CnAppBar, CnTabBar, iconBtn, I });
