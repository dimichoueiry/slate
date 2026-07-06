// Global chrome for the MCP bridge: the "⚡ Agent connected" indicator with
// its disconnect menu, and the one-time pairing dialog (PRD §6.1, §8.3).

import { useState } from 'react';
import {
  useBridge,
  submitPairingCode,
  dismissPairing,
  disconnectBridge,
  reconnectBridge,
  forgetPairing,
  bridgeEnabled,
} from './bridge';

const pill: React.CSSProperties = {
  position: 'fixed',
  right: 12,
  // the bottom-right corner stacks: zoom bar (12) → usage meter (56) → this
  bottom: 100,
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: 'var(--panel, #fff)',
  color: 'var(--ink, #1a1a1a)',
  border: '1px solid rgba(0,0,0,0.12)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  cursor: 'pointer',
  userSelect: 'none',
};

export default function BridgeUI() {
  const status = useBridge((s) => s.status);
  const pairRequested = useBridge((s) => s.pairRequested);
  const pairError = useBridge((s) => s.pairError);
  const [menuOpen, setMenuOpen] = useState(false);
  const [code, setCode] = useState('');

  return (
    <>
      {status === 'connected' && (
        <div style={pill} onClick={() => setMenuOpen((o) => !o)} title="An MCP agent is connected to this Slate">
          <span>⚡ Agent connected</span>
          {menuOpen && (
            <div
              style={{ position: 'absolute', right: 0, bottom: 40, background: 'var(--panel, #fff)', border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.16)', overflow: 'hidden', minWidth: 160 }}
              onClick={(e) => e.stopPropagation()}
            >
              <MenuItem
                label="Disconnect"
                onClick={() => {
                  disconnectBridge();
                  setMenuOpen(false);
                }}
              />
              <MenuItem
                label="Forget pairing"
                danger
                onClick={() => {
                  forgetPairing();
                  setMenuOpen(false);
                }}
              />
            </div>
          )}
        </div>
      )}
      {status === 'off' && !bridgeEnabled() && (
        <div style={{ ...pill, opacity: 0.7 }} onClick={reconnectBridge} title="Agent bridge is off — click to re-enable">
          <span>⚡ Agent off</span>
        </div>
      )}

      {pairRequested && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={dismissPairing}
        >
          <div
            style={{ background: 'var(--panel, #fff)', color: 'var(--ink, #1a1a1a)', borderRadius: 14, padding: 24, width: 340, boxShadow: '0 16px 48px rgba(0,0,0,0.25)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 17 }}>Connect your agent</h3>
            <p style={{ margin: '0 0 14px', fontSize: 13, opacity: 0.75, lineHeight: 1.45 }}>
              A local MCP agent wants to draw on your canvas. Enter the pairing code your agent showed you.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) submitPairingCode(code);
              }}
              style={{ display: 'flex', gap: 8 }}
            >
              <input
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="0000"
                inputMode="numeric"
                style={{ flex: 1, fontSize: 22, letterSpacing: 8, textAlign: 'center', padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.2)', fontFamily: 'inherit' }}
              />
              <button type="submit" disabled={code.length !== 4} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1a1a1a', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: code.length === 4 ? 1 : 0.4 }}>
                Pair
              </button>
            </form>
            {pairError && <p style={{ margin: '10px 0 0', fontSize: 12, color: '#e03131' }}>{pairError}</p>}
            <p style={{ margin: '12px 0 0', fontSize: 11, opacity: 0.55 }}>Only pair with an agent you started yourself.</p>
          </div>
        </div>
      )}
    </>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: '9px 14px', fontSize: 13, cursor: 'pointer', color: danger ? '#e03131' : 'inherit' }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.05)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      {label}
    </div>
  );
}
