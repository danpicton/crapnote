// Crapnote mobile screens
// Note: these render INSIDE an IOSDevice, so root size is the device viewport.

const { useState, useRef, useEffect } = React;

// ─────────────────────────────────────────
// Note-list row with swipe gestures
// Right-swipe (drag right) → reveals Pin + Star on the LEFT
// Left-swipe (drag left)  → reveals Archive + Delete on the RIGHT
// Always shows the actions partially when `revealed` prop set (for stills).
// ─────────────────────────────────────────
function NoteRow({ t, note, onTap, revealed = 0, onAction }) {
  // revealed: -1 = left actions exposed, 0 = closed, 1 = right actions exposed
  const [drag, setDrag] = useState(0);
  const startX = useRef(null);
  const dragging = useRef(false);

  const onStart = (e) => {
    startX.current = (e.touches ? e.touches[0].clientX : e.clientX);
    dragging.current = true;
  };
  const onMove = (e) => {
    if (!dragging.current) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    const dx = x - startX.current;
    setDrag(Math.max(-180, Math.min(180, dx)));
  };
  const onEnd = () => {
    dragging.current = false;
    if (Math.abs(drag) < 60) setDrag(0);
    else if (drag > 0) setDrag(140);
    else setDrag(-140);
  };

  // For stills, force reveal value via prop:
  const offset = revealed ? revealed * 110 : drag;
  const showLeft = offset > 4;
  const showRight = offset < -4;

  const ActionPill = ({ bg, label, icon: Ic, side }) => (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: 72, background: bg, color: '#FBF7F0', gap: 4,
      fontFamily: t.sans, fontSize: 11, letterSpacing: 0.3, fontWeight: 600,
    }}>
      <Ic size={20} stroke="#FBF7F0"/>
      <span>{label}</span>
    </div>
  );

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      borderBottom: `1px solid ${t.hair}`,
      background: t.bg,
    }}>
      {/* LEFT actions (revealed by right-swipe) */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, display: 'flex',
        opacity: showLeft ? 1 : 0, transition: 'opacity .15s',
      }}>
        <ActionPill bg={t.pin} label={note.pinned ? 'Unpin' : 'Pin'} icon={I.pin}/>
        <ActionPill bg={'#B9923A'} label={note.starred ? 'Unstar' : 'Star'} icon={I.star}/>
      </div>
      {/* RIGHT actions */}
      <div style={{
        position: 'absolute', right: 0, top: 0, bottom: 0, display: 'flex',
        opacity: showRight ? 1 : 0, transition: 'opacity .15s',
      }}>
        <ActionPill bg={t.archive} label="Archive" icon={I.archive}/>
        <ActionPill bg={t.danger} label="Delete" icon={I.trash}/>
      </div>
      {/* Row body */}
      <div
        onClick={onTap}
        onMouseDown={onStart} onMouseMove={onMove} onMouseUp={onEnd} onMouseLeave={onEnd}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging.current ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)',
          background: t.bg, padding: '16px 20px',
          display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
          userSelect: 'none',
        }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: t.serif, fontSize: 18, fontWeight: 700, color: t.text,
            lineHeight: 1.25, letterSpacing: -0.1, marginBottom: 4,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{note.title}</div>
          {note.preview && (
            <div style={{
              fontFamily: t.sans, fontSize: 14, color: t.text2,
              lineHeight: 1.4, marginBottom: 6,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}>{note.preview}</div>
          )}
          <div style={{
            fontFamily: t.sans, fontSize: 12, color: t.muted, letterSpacing: 0.1,
          }}>{note.date}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, paddingTop: 2 }}>
          {note.starred && <I.starF size={16} stroke={t.muted}/>}
          {note.pinned && <I.pinF size={16} stroke={t.muted}/>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// NOTE LIST
// ─────────────────────────────────────────
function NoteList({ t, dark, state = 'default', notes, onOpen, onTab, activeTab = 'notes', initialTab = 'all', syncStatus = 'synced' }) {
  // state: 'default' | 'pulling' | 'syncing' | 'searching' | 'left-swipe' | 'right-swipe' | 'tags-tab'
  const [tab, setTab] = useState(state === 'tags-tab' ? 'tags' : initialTab);
  const [search, setSearch] = useState('');
  const showSearch = state === 'searching';
  const showPull = state === 'pulling' || state === 'syncing';
  const pullOffset = state === 'pulling' ? 56 : state === 'syncing' ? 44 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg }}>
      {/* Top header */}
      <div style={{ padding: '54px 20px 6px', background: t.bg, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <CnWordmark size={26} t={t}/>
          <button style={{
            ...iconBtn(t), border: `1px solid ${t.hair}`, borderRadius: 22, width: 40, height: 40,
            color: t.text2,
          }} aria-label="New note">
            <I.plus size={20} stroke={t.text2}/>
          </button>
        </div>
        {/* Search bar — bigger on mobile */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '11px 14px', background: t.surface2,
          borderRadius: 12, border: `1px solid ${t.hair}`,
        }}>
          <I.search size={16} stroke={t.muted}/>
          <span style={{
            flex: 1, fontFamily: t.sans, fontSize: 16, color: showSearch ? t.text : t.muted,
          }}>{showSearch ? 'mobile' : `Search ${notes.length} notes`}</span>
          {showSearch && <I.x size={16} stroke={t.muted}/>}
        </div>
      </div>
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 24, padding: '6px 20px 0', borderBottom: `1px solid ${t.hair}`,
        flexShrink: 0, background: t.bg,
      }}>
        {['all', 'starred', 'tags'].map(k => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: 'none', background: 'transparent', cursor: 'pointer',
            padding: '12px 0 14px', position: 'relative',
            fontFamily: t.sans, fontSize: 13, fontWeight: 700, letterSpacing: 1.2,
            color: tab === k ? t.text : t.muted, textTransform: 'uppercase',
          }}>
            {k.toUpperCase()}
            {tab === k && (
              <div style={{
                position: 'absolute', left: 0, right: 0, bottom: -1, height: 2,
                background: t.accent, borderRadius: 2,
              }}/>
            )}
          </button>
        ))}
      </div>
      {/* Pull-to-sync indicator */}
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {showPull && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: pullOffset,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            color: t.muted, fontFamily: t.sans, fontSize: 13,
            background: t.bg, zIndex: 1,
          }}>
            <I.sync size={16} stroke={t.muted}/>
            <span>{state === 'pulling' ? 'Release to sync…' : 'Syncing…'}</span>
          </div>
        )}
        <div style={{ transform: `translateY(${pullOffset}px)`, transition: 'transform .2s' }}>
          {tab === 'tags' ? (
            <TagFilterList t={t}/>
          ) : (
            (tab === 'starred' ? notes.filter(n => n.starred) : notes).map((n, i) => (
              <NoteRow key={i} t={t} note={n} onTap={() => onOpen && onOpen(n)}
                revealed={state === 'left-swipe' && i === 0 ? -1
                        : state === 'right-swipe' && i === 1 ? 1 : 0}/>
            ))
          )}
        </div>
      </div>
      {/* Sync status row above tab bar */}
      <SyncStatusRow t={t} status={syncStatus}/>
      {/* Bottom tab bar */}
      <CnTabBar t={t} active={activeTab} onTab={onTab}/>
    </div>
  );
}

// ─────────────────────────────────────────
// FORMATTING TOOLBAR (single row, scrollable)
// docked above keyboard. variant: 'full' | 'compact' | 'markdown'
// ─────────────────────────────────────────
function FormatBar({ t, variant = 'full', active = ['bold'] }) {
  const all = [
    { k: 'H', icon: I.H, label: 'Heading' },
    { k: 'bold', icon: I.bold, label: 'Bold' },
    { k: 'italic', icon: I.italic, label: 'Italic' },
    { k: 'under', icon: I.under, label: 'Underline' },
    { k: 'link', icon: I.link, label: 'Link' },
    { k: 'quote', icon: I.quote, label: 'Quote' },
    { k: 'code', icon: I.code, label: 'Code' },
    { k: 'list', icon: I.list, label: 'List' },
    { k: 'olist', icon: I.olist, label: 'Numbered list' },
    { k: 'check', icon: I.check, label: 'Checklist' },
    { k: 'hr', icon: I.hr, label: 'Divider' },
    { k: 'undo', icon: I.undo, label: 'Undo' },
    { k: 'redo', icon: I.redo, label: 'Redo' },
  ];
  const items = variant === 'compact' ? all.slice(0, 6) : all;
  if (variant === 'markdown') {
    return (
      <div style={{
        background: t.surface, borderTop: `1px solid ${t.hair}`,
        padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: t.mono, fontSize: 13, color: t.muted, flexShrink: 0,
      }}>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>#</span>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>**</span>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>_</span>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>[ ]</span>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>{'>'}</span>
        <span style={{ padding: '4px 8px', background: t.surface2, borderRadius: 6 }}>`</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontFamily: t.sans, fontSize: 12, color: t.muted }}>Markdown</span>
      </div>
    );
  }
  return (
    <div style={{
      background: t.surface, borderTop: `1px solid ${t.hair}`,
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', gap: 2, overflowX: 'auto',
        padding: '6px 6px', scrollbarWidth: 'none',
      }}>
        {items.map(it => {
          const isOn = active.includes(it.k);
          const Icn = it.icon;
          return (
            <button key={it.k} aria-label={it.label} style={{
              flex: '0 0 auto', width: 42, height: 42, borderRadius: 9, border: 'none',
              background: isOn ? t.accentSoft : 'transparent',
              color: isOn ? t.accent : t.text2,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}>
              <Icn size={20} stroke={isOn ? t.accent : t.text2}/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// NOTE EDIT
// state: 'reading' | 'editing' | 'menu' | 'tags'
// toolbarMode: 'full' | 'compact' | 'markdown'
// ─────────────────────────────────────────
function NoteEdit({ t, dark, state = 'reading', toolbarMode = 'full', onBack }) {
  const editing = state === 'editing';
  const showMenu = state === 'menu';
  const showTags = state === 'tags';
  const tags = ['mobile', 'design', 'wip'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg, position: 'relative' }}>
      {/* Top bar — back + actions only (no wordmark on subpages) */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '54px 8px 10px', background: t.bg, borderBottom: `1px solid ${t.hair}`, flexShrink: 0,
      }}>
        <button onClick={onBack} style={iconBtn(t)} aria-label="Back">
          <I.back size={22} stroke={t.text2}/>
        </button>
        <div style={{ flex: 1 }}/>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button style={iconBtn(t)} aria-label="Star">
            <I.starF size={20} stroke={t.muted}/>
          </button>
          <button style={iconBtn(t)} aria-label="More">
            <I.more size={22} stroke={t.text2}/>
          </button>
        </div>
      </div>
      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 22px 8px', flexShrink: 0 }}>
          <h1 style={{
            margin: 0, fontFamily: t.serif, fontWeight: 700, fontSize: 28,
            lineHeight: 1.15, color: t.text, letterSpacing: -0.4,
          }}>Issues so far</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {tags.map(tag => (
              <span key={tag} style={{
                fontFamily: t.sans, fontSize: 12, padding: '4px 10px',
                background: t.accentSoft, color: t.accent, borderRadius: 999,
                fontWeight: 600, letterSpacing: 0.2,
              }}>{tag}</span>
            ))}
            <button style={{
              fontFamily: t.sans, fontSize: 12, padding: '4px 10px',
              background: 'transparent', color: t.muted, border: `1px dashed ${t.faint}`,
              borderRadius: 999, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <I.plus size={12} stroke={t.muted}/> tag
            </button>
          </div>
        </div>
        <div style={{
          flex: 1, overflowY: 'auto', padding: '4px 22px 24px',
          fontFamily: t.serif, fontSize: 17, lineHeight: 1.55, color: t.text,
        }}>
          <ul style={{ paddingLeft: 22, margin: 0 }}>
            <li>Tool bars and buttons of all types are too small — possibly in wrong place</li>
            <li>Swipe gestures on note list</li>
            <li>Pull down refresh</li>
            <li>Archive and settings screens have title overlapping crapnote type mark</li>
            <li>URL bar visible on installed app</li>
            <li>Keyboard shortcuts — should these be visible on mobile?</li>
            <li>There is no longer a trashcan</li>
            <li>Formatting buttons don't remain "clicked" when their formatting is active</li>
            <li>Tag selection in mobile view is ugly</li>
            <li>Scroll bar appears in mobile view when you open a note</li>
          </ul>
        </div>
        <div style={{
          padding: '8px 22px', borderTop: `1px solid ${t.hair}`,
          fontFamily: t.sans, fontSize: 11, color: t.muted, letterSpacing: 0.3,
          display: 'flex', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <span>4 May · 21:08</span>
          <span>94 words · saved</span>
        </div>
      </div>
      {/* Format bar above keyboard, only when editing */}
      {editing && <FormatBar t={t} variant={toolbarMode} active={['bold', 'list']}/>}

      {/* ⋯ menu sheet */}
      {showMenu && (
        <Sheet t={t} title="Note actions">
          {[
            { i: I.pin, l: 'Pin to top' },
            { i: I.starF, l: 'Unstar', accent: true },
            { i: I.tag, l: 'Edit tags' },
            { i: I.archive, l: 'Archive' },
            { i: I.sync, l: 'Force sync' },
            { i: I.trash, l: 'Delete', danger: true },
          ].map(it => (
            <button key={it.l} style={menuRow(t, it.danger, it.accent)}>
              <it.i size={20} stroke={it.danger ? t.danger : it.accent ? t.accent : t.text2}/>
              <span>{it.l}</span>
            </button>
          ))}
        </Sheet>
      )}
      {/* Tag sheet */}
      {showTags && (
        <Sheet t={t} title="Tags">
          <div style={{ padding: '6px 18px 12px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {['mobile', 'design', 'wip'].map((tag, i) => (
                <span key={tag} style={{
                  fontFamily: t.sans, fontSize: 14, padding: '8px 14px',
                  background: t.accentSoft, color: t.accent, borderRadius: 999,
                  fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6,
                }}>{tag}<I.x size={12} stroke={t.accent}/></span>
              ))}
            </div>
            <div style={{
              fontFamily: t.sans, fontSize: 11, color: t.muted, letterSpacing: 1,
              marginBottom: 8, fontWeight: 600,
            }}>SUGGESTED</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {['todo', 'reading', 'work', 'idea', 'recipe'].map(tag => (
                <span key={tag} style={{
                  fontFamily: t.sans, fontSize: 14, padding: '8px 14px',
                  background: t.surface2, color: t.text2, borderRadius: 999,
                  border: `1px solid ${t.hair}`,
                }}>{tag}</span>
              ))}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px', background: t.surface2,
              borderRadius: 12, border: `1px solid ${t.hair}`,
            }}>
              <span style={{ color: t.muted, fontFamily: t.sans }}>#</span>
              <span style={{ flex: 1, fontFamily: t.sans, fontSize: 16, color: t.text2 }}>new tag</span>
              <button style={{
                width: 32, height: 32, borderRadius: 8, border: 'none', background: t.accent,
                color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}><I.plus size={16} stroke="#fff"/></button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}

const menuRow = (t, danger, accent) => ({
  width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
  padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14,
  fontFamily: t.sans, fontSize: 16,
  color: danger ? t.danger : accent ? t.accent : t.text,
  cursor: 'pointer',
  borderBottom: `1px solid ${t.hair}`,
});

function Sheet({ t, title, children }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 5 }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.32)' }}/>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: t.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
        boxShadow: '0 -10px 30px rgba(0,0,0,0.18)',
        paddingBottom: 16, maxHeight: '70%',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: t.faint }}/>
        </div>
        {title && <div style={{
          padding: '6px 20px 12px',
          fontFamily: t.serif, fontWeight: 700, fontSize: 18, color: t.text,
        }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// SETTINGS — note: keyboard shortcuts section is REMOVED on mobile
// ─────────────────────────────────────────
function Settings({ t, onBack, onTab, syncStatus = 'synced' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg }}>
      <CnAppBar t={t} title="Settings" onBack={onBack}/>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0 16px' }}>
        <Section t={t} title="Export" subtitle="Everything you've written, as Markdown.">
          <Field t={t} placeholder="Password (optional)"/>
          <PrimaryBtn t={t}>Export notes</PrimaryBtn>
          <Hint t={t}>A ZIP of individual <Mono t={t}>.md</Mono> files. Password-protected if supplied.</Hint>
        </Section>
        <Section t={t} title="Administration" subtitle="Users and who can do what.">
          <button style={{
            ...rowButton(t),
          }}>
            <span>User management</span>
            <I.chev size={16} stroke={t.muted}/>
          </button>
        </Section>
        <Section t={t} title="Change password" subtitle="For this account. Signs you out of other sessions.">
          <Label t={t}>CURRENT PASSWORD</Label>
          <Field t={t} password/>
          <Label t={t}>NEW PASSWORD</Label>
          <Field t={t} password/>
          <Label t={t}>CONFIRM NEW PASSWORD</Label>
          <Field t={t} password/>
          <PrimaryBtn t={t}>Update password</PrimaryBtn>
        </Section>
        <Section t={t} title="Sync" subtitle="Last synced 2 minutes ago over Wi-Fi.">
          <button style={rowButton(t)}>
            <span>Force sync now</span>
            <I.sync size={16} stroke={t.muted}/>
          </button>
        </Section>
        <Section t={t} title="Appearance">
          <Toggle t={t} label="Dark mode" on={t.bg.startsWith('#1')}/>
          <Toggle t={t} label="Use system theme" on={true}/>
        </Section>
        <div style={{
          padding: '24px 22px 8px', textAlign: 'center',
          fontFamily: t.sans, fontSize: 12, color: t.muted,
        }}>Crapnote 2.4.1 · dadmin</div>
      </div>
      <CnTabBar t={t} active="settings" onTab={onTab}/>
    </div>
  );
}

const rowButton = (t) => ({
  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 16px', borderRadius: 12, border: `1px solid ${t.hair}`, background: t.surface,
  fontFamily: t.sans, fontSize: 16, color: t.text, cursor: 'pointer', textAlign: 'left',
  marginBottom: 8,
});

function Section({ t, title, subtitle, children }) {
  return (
    <div style={{
      padding: '20px 22px 18px', borderBottom: `1px solid ${t.hair}`,
    }}>
      <div style={{
        fontFamily: t.serif, fontWeight: 700, fontSize: 19, color: t.text, marginBottom: 4,
      }}>{title}</div>
      {subtitle && <div style={{
        fontFamily: t.sans, fontSize: 14, color: t.muted, marginBottom: 14, lineHeight: 1.4,
      }}>{subtitle}</div>}
      {children}
    </div>
  );
}
function Field({ t, placeholder, password, value }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 14px', borderRadius: 10, border: `1px solid ${t.hair}`,
      background: t.surface, marginBottom: 10,
    }}>
      <span style={{ flex: 1, fontFamily: t.sans, fontSize: 16, color: value ? t.text : t.muted }}>
        {value || placeholder || (password ? '••••••••' : '')}
      </span>
      {password && <I.eye size={18} stroke={t.muted}/>}
    </div>
  );
}
function Label({ t, children }) {
  return <div style={{
    fontFamily: t.sans, fontSize: 11, fontWeight: 700, letterSpacing: 1.2,
    color: t.muted, marginBottom: 6, marginTop: 6,
  }}>{children}</div>;
}
function Hint({ t, children }) {
  return <div style={{
    fontFamily: t.sans, fontSize: 13, color: t.muted, marginTop: 8, lineHeight: 1.4,
  }}>{children}</div>;
}
function Mono({ t, children }) {
  return <span style={{
    fontFamily: t.mono, fontSize: 12, padding: '1px 6px',
    background: t.surface2, borderRadius: 4, color: t.text2,
  }}>{children}</span>;
}
function PrimaryBtn({ t, children }) {
  return <button style={{
    width: '100%', padding: '13px 16px', border: 'none', borderRadius: 10,
    background: t.accent, color: '#fff', fontFamily: t.sans, fontSize: 16, fontWeight: 600,
    cursor: 'pointer', marginTop: 4,
  }}>{children}</button>;
}
function Toggle({ t, label, on }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderBottom: `1px solid ${t.hair}`,
    }}>
      <span style={{ fontFamily: t.sans, fontSize: 16, color: t.text }}>{label}</span>
      <div style={{
        width: 46, height: 28, borderRadius: 14, background: on ? t.accent : t.faint,
        position: 'relative', transition: 'background .15s',
      }}>
        <div style={{
          position: 'absolute', top: 2, left: on ? 20 : 2, width: 24, height: 24,
          borderRadius: 12, background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left .15s',
        }}/>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// ARCHIVE
// ─────────────────────────────────────────
function Archive({ t, onBack, onTab, empty = false, syncStatus = 'synced' }) {
  const items = empty ? [] : [
    { title: 'Old project notes', date: '12 Apr', preview: 'Sprint planning · backlog grooming · retros' },
    { title: 'Weekly review template', date: '5 Apr', preview: 'What went well? What didn\'t? What next?' },
    { title: 'Trip to Lisbon', date: '22 Mar', preview: 'Belém pastry. Trams. Tile museum.' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg }}>
      <CnAppBar t={t} title="Archive" onBack={onBack}/>
      {empty ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 12, padding: 32, textAlign: 'center',
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: 32, background: t.surface2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <I.archive size={28} stroke={t.muted}/>
          </div>
          <div style={{ fontFamily: t.serif, fontSize: 20, color: t.text }}>Nothing archived</div>
          <div style={{ fontFamily: t.sans, fontSize: 14, color: t.muted, maxWidth: 240 }}>
            Swipe a note left and tap Archive to tuck it away here.
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto' }}>
          {items.map((n, i) => (
            <NoteRow key={i} t={t} note={{ ...n, starred: false, pinned: false }}/>
          ))}
        </div>
      )}
      <CnTabBar t={t} active="archive" onTab={onTab}/>
    </div>
  );
}

// ─────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────
function UserManagement({ t, onBack, onTab, syncStatus = 'synced' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: t.bg }}>
      <CnAppBar t={t} title="Users" onBack={onBack}/>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Section t={t} title="Create user" subtitle="Add someone to this Crapnote instance.">
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <RadioPill t={t} active label="Set password now"/>
            <RadioPill t={t} label="Send setup link"/>
          </div>
          <Field t={t} placeholder="Username"/>
          <Field t={t} placeholder="Password" password/>
          <Field t={t} placeholder="Confirm password" password/>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: 5, border: `1.5px solid ${t.faint}`,
            }}/>
            <span style={{ fontFamily: t.sans, fontSize: 15, color: t.text }}>Make admin</span>
          </div>
          <PrimaryBtn t={t}>+ Create user</PrimaryBtn>
        </Section>
        <Section t={t} title="Users" subtitle="Everyone with access.">
          {[
            { u: 'dadmin', role: 'Admin', status: 'ACTIVE', tokens: 'Always', date: '04/05/2026' },
            { u: 'rosa',   role: 'User',  status: 'ACTIVE', tokens: '2 active', date: '11/04/2026' },
            { u: 'kenji',  role: 'User',  status: 'INVITED', tokens: '—', date: '01/05/2026' },
          ].map(u => (
            <div key={u.u} style={{
              padding: '14px 0', borderBottom: `1px solid ${t.hair}`,
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 18, background: t.surface2,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: t.serif, fontWeight: 700, fontSize: 15, color: t.text2,
              }}>{u.u[0].toUpperCase()}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: t.sans, fontSize: 15, fontWeight: 600, color: t.text }}>{u.u}</span>
                  <span style={{
                    fontFamily: t.sans, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
                    padding: '2px 6px', borderRadius: 4,
                    background: u.status === 'ACTIVE' ? t.surface2 : t.accentSoft,
                    color: u.status === 'ACTIVE' ? t.text2 : t.accent,
                  }}>{u.status}</span>
                </div>
                <div style={{ fontFamily: t.sans, fontSize: 12, color: t.muted, marginTop: 2 }}>
                  {u.role} · {u.tokens} · {u.date}
                </div>
              </div>
              <I.chev size={16} stroke={t.muted}/>
            </div>
          ))}
        </Section>
      </div>
      <CnTabBar t={t} active="settings" onTab={onTab}/>
    </div>
  );
}
function RadioPill({ t, active, label }) {  return (
    <button style={{
      flex: 1, padding: '10px 12px', borderRadius: 10,
      border: `1px solid ${active ? t.accent : t.hair}`,
      background: active ? t.accentSoft : t.surface,
      color: active ? t.accent : t.text2,
      fontFamily: t.sans, fontSize: 14, fontWeight: 600, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: 7,
        border: `1.5px solid ${active ? t.accent : t.faint}`,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && <div style={{ width: 6, height: 6, borderRadius: 3, background: t.accent }}/>}
      </div>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────
// SYNC STATUS — green = synced, grey = not synced, red = offline
// Sits as a thin row above bottom tab bar (and a tiny dot in app-bar trailing slot)
// ─────────────────────────────────────────
function SyncStatusRow({ t, status = 'synced' }) {
  const cfg = {
    synced:    { color: '#5E8E6E', label: 'Synced',     icon: I.check, dim: false },
    pending:   { color: t.muted,   label: 'Not synced', icon: I.sync,  dim: true  },
    offline:   { color: '#C0432A', label: 'Offline',    icon: I.x,     dim: false },
    syncing:   { color: t.muted,   label: 'Syncing…',   icon: I.sync,  dim: true  },
  }[status] || { color: t.muted, label: 'Unknown', icon: I.sync };
  const Ic = cfg.icon;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 18px', background: t.bg,
      borderTop: `1px solid ${t.hair}`,
      fontFamily: t.sans, fontSize: 11, letterSpacing: 0.4,
      color: cfg.dim ? t.muted : cfg.color,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: cfg.color, opacity: cfg.dim ? 0.7 : 1 }}/>
      <Ic size={13} stroke={cfg.dim ? t.muted : cfg.color}/>
      <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{cfg.label}</span>
      <span style={{ flex: 1 }}/>
      <span style={{ color: t.muted, textTransform: 'none', letterSpacing: 0 }}>
        {status === 'synced' ? '· just now' : status === 'offline' ? '· last 14:02' : status === 'syncing' ? '' : '· last 14:02'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────
// TAG FILTER LIST — used inside Tags tab
// ─────────────────────────────────────────
function TagFilterList({ t }) {
  const tags = [
    { name: 'mobile',  count: 4, color: '#5E8E6E' },
    { name: 'design',  count: 7, color: '#C99A2E' },
    { name: 'wip',     count: 2, color: '#7A8AC4' },
    { name: 'recipe',  count: 9, color: '#B26A4F' },
    { name: 'reading', count: 5, color: '#8B6FAE' },
    { name: 'work',    count: 3, color: '#5E8E6E' },
  ];
  return (
    <div style={{ padding: '14px 0' }}>
      <div style={{
        padding: '0 22px 8px',
        fontFamily: t.sans, fontSize: 11, letterSpacing: 1.4,
        color: t.muted, fontWeight: 700,
      }}>FILTER BY TAG</div>
      {tags.map(tag => (
        <div key={tag.name} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 22px', borderBottom: `1px solid ${t.hair}`,
          cursor: 'pointer',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: tag.color }}/>
          <span style={{ flex: 1, fontFamily: t.sans, fontSize: 16, color: t.text }}>{tag.name}</span>
          <span style={{ fontFamily: t.sans, fontSize: 13, color: t.muted }}>{tag.count}</span>
        </div>
      ))}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 22px',
        fontFamily: t.sans, fontSize: 16, color: t.muted, cursor: 'pointer',
      }}>
        <span style={{ width: 8, display: 'inline-flex', justifyContent: 'center' }}>+</span>
        <span>New tag…</span>
      </div>
    </div>
  );
}

Object.assign(window, { NoteList, NoteEdit, Settings, Archive, UserManagement, FormatBar, NoteRow, SyncStatusRow, TagFilterList });