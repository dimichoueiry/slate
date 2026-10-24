// A side-docked chat panel that drives a real headless Claude Code (`claude -p`)
// running in the user's repo, via the slate-mcp bridge (see bridge.ts +
// slate-mcp `serve`). Assistant text streams in; tool uses show as traces;
// permission prompts appear as Allow/Deny chips. The board's session id is kept
// so reopening resumes the same conversation.

import { useEffect, useRef, useState } from 'react';
import {
  onAgentEvent,
  startAgentRun,
  sendAgentTurn,
  interruptAgentRun,
  useBridge,
  type AgentEventMsg,
} from '../bridge/bridge';
import { useAgentPerm, answerPermission } from '../bridge/agentStore';

const CSS = `
.slate-agent-toggle{position:fixed;top:64px;right:14px;z-index:44;border:none;border-radius:10px;height:34px;padding:0 12px;background:var(--surface);color:var(--text);border:1px solid var(--border);font-size:12.5px;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;gap:6px}
.slate-agent-toggle:hover{background:var(--surface-hover)}
.slate-agent{position:fixed;top:0;right:0;bottom:0;width:min(420px,96vw);z-index:60;display:flex;flex-direction:column;background:var(--surface);border-left:1px solid var(--border);box-shadow:-8px 0 32px rgba(0,0,0,.28)}
.slate-agent-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.slate-agent-head .title{font-size:13px;font-weight:600;flex:1}
.slate-agent-head select{background:var(--surface-hover);color:var(--text);border:1px solid var(--border);border-radius:7px;font-size:11px;padding:3px 6px}
.slate-agent-head button{background:none;border:none;color:var(--text-dim);font-size:15px;cursor:pointer;padding:2px 6px}
.slate-agent-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.slate-agent-msg{font-size:12.5px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.slate-agent-msg.user{align-self:flex-end;max-width:85%;background:var(--accent);color:#fff;padding:7px 11px;border-radius:12px 12px 3px 12px}
.slate-agent-msg.assistant{align-self:flex-start;max-width:92%;color:var(--text)}
.slate-agent-msg.system{align-self:center;font-size:11px;color:var(--text-dim);text-align:center}
.slate-agent-msg.system.err{color:#ff8787}
.slate-agent-trace{font-family:ui-monospace,monospace;font-size:11px;color:var(--text-dim);margin-top:3px;opacity:.85}
.slate-agent-perm{align-self:stretch;border:1px solid var(--accent);border-radius:10px;padding:9px 11px;font-size:12px;background:var(--surface-hover)}
.slate-agent-perm .tool{font-family:ui-monospace,monospace;font-weight:600;font-size:11.5px}
.slate-agent-perm .inp{font-family:ui-monospace,monospace;font-size:10.5px;color:var(--text-dim);margin:5px 0;max-height:80px;overflow:auto;white-space:pre-wrap}
.slate-agent-perm .row{display:flex;gap:8px;margin-top:6px}
.slate-agent-perm button{border:none;border-radius:7px;font-size:11.5px;padding:5px 12px;cursor:pointer}
.slate-agent-perm .allow{background:var(--accent);color:#fff}
.slate-agent-perm .deny{background:var(--surface);color:var(--text);border:1px solid var(--border)}
.slate-agent-foot{border-top:1px solid var(--border);padding:10px;display:flex;gap:8px;align-items:flex-end;flex-shrink:0}
.slate-agent-foot textarea{flex:1;resize:none;background:var(--surface-hover);color:var(--text);border:1px solid var(--border);border-radius:9px;font-size:12.5px;padding:8px 10px;font-family:inherit;max-height:120px;outline:none}
.slate-agent-foot button{border:none;border-radius:9px;background:var(--accent);color:#fff;font-size:12.5px;padding:8px 14px;cursor:pointer;flex-shrink:0}
.slate-agent-foot button:disabled{opacity:.5;cursor:default}
.slate-agent-hint{padding:12px;font-size:12px;color:var(--text-dim);line-height:1.5}
.slate-agent-hint code{font-family:ui-monospace,monospace;background:var(--surface-hover);padding:1px 5px;border-radius:4px}
`;

const PERMISSION_MODES = [
  { id: 'default', label: 'Ask each tool' },
  { id: 'acceptEdits', label: 'Auto-accept edits' },
  { id: 'plan', label: 'Plan (read-only)' },
  { id: 'bypassPermissions', label: 'Bypass (danger)' },
];

interface Msg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  trace?: string[];
  err?: boolean;
}

const mid = () => Math.random().toString(36).slice(2, 9);

export default function AgentChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [permMode, setPermMode] = useState('default');
  const [busy, setBusy] = useState(false);

  const bridgeStatus = useBridge((s) => s.status);
  const pending = useAgentPerm((s) => s.pending);
  const logRef = useRef<HTMLDivElement>(null);

  // the assistant bubble we're currently streaming into (null between turns)
  const streamingId = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, pending]);

  // subscribe once to streamed agent events
  useEffect(() => {
    return onAgentEvent(({ runId: evRun, event }: AgentEventMsg) => {
      if (runIdRef.current && evRun !== runIdRef.current) return;
      handleEvent(event);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ensureAssistant(): string {
    if (streamingId.current) return streamingId.current;
    const id = mid();
    streamingId.current = id;
    setMessages((m) => [...m, { id, role: 'assistant', text: '', trace: [] }]);
    return id;
  }

  function appendText(delta: string) {
    const id = ensureAssistant();
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text: msg.text + delta } : msg)));
  }

  function addTrace(line: string) {
    const id = ensureAssistant();
    setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, trace: [...(msg.trace ?? []), line] } : msg)));
  }

  function sys(text: string, err = false) {
    setMessages((m) => [...m, { id: mid(), role: 'system', text, err }]);
  }

  function handleEvent(event: any) {
    if (!event || typeof event !== 'object') return;
    if (typeof event.session_id === 'string') setSessionId(event.session_id);

    switch (event.type) {
      case 'stream_event': {
        const delta = event.event?.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') appendText(delta.text);
        break;
      }
      case 'assistant': {
        const content = event.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block?.type === 'tool_use') addTrace(`→ ${block.name}`);
          }
        }
        break;
      }
      case 'result': {
        // if nothing streamed (no --verbose deltas), fall back to the final text
        if (streamingId.current === null && typeof event.result === 'string' && event.result) {
          setMessages((m) => [...m, { id: mid(), role: 'assistant', text: event.result }]);
        }
        streamingId.current = null;
        setBusy(false);
        break;
      }
      case 'error':
        sys(String(event.error ?? 'Agent error'), true);
        streamingId.current = null;
        setBusy(false);
        break;
      case 'closed':
        // the process exited; keep the session so the next turn resumes it
        streamingId.current = null;
        setRunId(null);
        setBusy(false);
        break;
      default:
        break;
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setMessages((m) => [...m, { id: mid(), role: 'user', text }]);
    streamingId.current = null;
    setBusy(true);
    try {
      if (runId) {
        await sendAgentTurn(runId, text);
      } else {
        const res = await startAgentRun({ prompt: text, sessionId, permissionMode: permMode });
        if (res?.ok) {
          setRunId(res.runId);
          if (res.sessionId) setSessionId(res.sessionId);
        } else {
          sys('Could not start the agent — is `slate-mcp serve` running in your repo?', true);
          setBusy(false);
        }
      }
    } catch (e) {
      sys(e instanceof Error ? e.message : String(e), true);
      setBusy(false);
    }
  }

  async function stop() {
    if (runId) await interruptAgentRun(runId).catch(() => {});
    setBusy(false);
  }

  if (!open) {
    return (
      <>
        <style>{CSS}</style>
        <button className="slate-agent-toggle" title="Chat with Claude Code in your repo" onClick={() => setOpen(true)}>
          <span>◆</span> Code agent
        </button>
      </>
    );
  }

  const connected = bridgeStatus === 'connected';

  return (
    <>
      <style>{CSS}</style>
      <div className="slate-agent" onPointerDown={(e) => e.stopPropagation()}>
        <div className="slate-agent-head">
          <span className="title">Code agent</span>
          <select value={permMode} onChange={(e) => setPermMode(e.target.value)} title="Permission mode for tool use" disabled={!!runId}>
            {PERMISSION_MODES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button title="Close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>

        {!connected && (
          <div className="slate-agent-hint">
            Not connected to a repo. In your project run:
            <br />
            <code>npx @dchoueiry/slate-mcp serve</code>
            <br />
            then enter the pairing code here when it appears.
          </div>
        )}

        <div className="slate-agent-log" ref={logRef}>
          {messages.map((m) => (
            <div key={m.id} className={`slate-agent-msg ${m.role}${m.err ? ' err' : ''}`}>
              {m.text}
              {m.trace && m.trace.length > 0 && (
                <div className="slate-agent-trace">{m.trace.join('\n')}</div>
              )}
            </div>
          ))}

          {pending.map((p) => (
            <div key={p.id} className="slate-agent-perm">
              <div>
                Allow <span className="tool">{p.toolName}</span>?
              </div>
              <div className="inp">{prettyInput(p.input)}</div>
              <div className="row">
                <button className="allow" onClick={() => answerPermission(p.id, true)}>
                  Allow
                </button>
                <button className="deny" onClick={() => answerPermission(p.id, false, 'Denied by the user.')}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="slate-agent-foot">
          <textarea
            placeholder={connected ? 'Ask the agent to build, fix, or explain your code…' : 'Start the bridge to chat…'}
            value={input}
            rows={1}
            disabled={!connected}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          {busy ? (
            <button onClick={() => void stop()}>Stop</button>
          ) : (
            <button disabled={!connected || !input.trim()} onClick={() => void submit()}>
              Send
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function prettyInput(input: unknown): string {
  try {
    const s = JSON.stringify(input, null, 2);
    return s.length > 600 ? s.slice(0, 600) + '…' : s;
  } catch {
    return String(input);
  }
}
