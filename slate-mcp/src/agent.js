// Agent runner: spawns headless Claude Code (`claude -p`) inside a repo and
// streams its stream-json events back out. The process is kept alive with
// `--input-format stream-json` so a conversation is multi-turn — each user turn
// is written to stdin as one JSON line and Claude answers on the same stdout
// stream. Session ids are captured so a run can be resumed later (`--resume`),
// which is how a Slate board reconnects to "the same conversation" it tracks.
//
// This module owns NO transport of its own; the caller passes an `onEvent`
// callback and we hand it every parsed stream-json object plus a few synthetic
// lifecycle events ({type:'stderr'|'error'|'closed'}). Permissions are NOT
// handled here — they ride the MCP `--permission-prompt-tool` back to the tab
// (see index.js), so a spawned agent can ask the user to approve an edit.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/**
 * Encode one user turn for `--input-format stream-json`. Claude Code expects the
 * Anthropic Messages-API envelope, newline-delimited, one message per line.
 * (Shape confirmed against the headless docs — see the PR notes.)
 */
export function encodeUserTurn(text) {
  return (
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: String(text) }] },
      parent_tool_use_id: null,
    }) + '\n'
  );
}

export function createAgentRunner({ onEvent, log = () => {} }) {
  const runs = new Map(); // runId -> { child, sessionId, cwd }
  let nextRun = 1;

  function start(opts = {}) {
    const {
      cwd,
      prompt,
      sessionId,
      permissionMode,
      allowedTools,
      disallowedTools,
      mcpConfig,
      permissionPromptTool,
      addDirs,
      claudeBin,
    } = opts;

    const runId = `run-${nextRun++}`;
    const bin = claudeBin || process.env.SLATE_CLAUDE_BIN || 'claude';

    const argv = [
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
    ];
    if (sessionId) argv.push('--resume', String(sessionId));
    if (permissionMode) argv.push('--permission-mode', String(permissionMode));
    if (Array.isArray(allowedTools) && allowedTools.length) argv.push('--allowedTools', ...allowedTools);
    if (Array.isArray(disallowedTools) && disallowedTools.length)
      argv.push('--disallowedTools', ...disallowedTools);
    if (mcpConfig) argv.push('--mcp-config', typeof mcpConfig === 'string' ? mcpConfig : JSON.stringify(mcpConfig));
    if (permissionPromptTool) argv.push('--permission-prompt-tool', String(permissionPromptTool));
    if (Array.isArray(addDirs) && addDirs.length) argv.push('--add-dir', ...addDirs);

    // Prefer the user's Claude subscription login: do NOT force an API key into
    // the child. If ANTHROPIC_API_KEY happens to be set in this process we drop
    // it so the spawned agent uses the same auth the interactive CLI would.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    let child;
    try {
      child = spawn(bin, argv, { cwd: cwd || process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env });
    } catch (e) {
      onEvent(runId, { type: 'error', error: `Could not launch "${bin}": ${e?.message ?? e}` });
      return { runId, sessionId: sessionId ?? null, ok: false };
    }

    const run = { child, sessionId: sessionId ?? null, cwd: cwd || process.cwd() };
    runs.set(runId, run);
    log(`agent ${runId} spawned (${bin} ${argv.join(' ')}) in ${run.cwd}`);

    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      const t = line.trim();
      if (!t) return;
      let ev;
      try {
        ev = JSON.parse(t);
      } catch {
        return; // non-JSON stdout noise
      }
      if (ev && typeof ev.session_id === 'string') run.sessionId = ev.session_id;
      onEvent(runId, ev);
    });

    child.stderr.on('data', (d) => onEvent(runId, { type: 'stderr', text: String(d) }));
    child.on('error', (e) => {
      onEvent(runId, { type: 'error', error: String(e?.message ?? e) });
      runs.delete(runId);
    });
    child.on('close', (code) => {
      onEvent(runId, { type: 'closed', code, session_id: run.sessionId });
      runs.delete(runId);
    });

    writeTurn(run, prompt);
    return { runId, get sessionId() { return run.sessionId; }, ok: true };
  }

  function send(runId, text) {
    const run = runs.get(runId);
    if (!run) return false;
    writeTurn(run, text);
    return true;
  }

  function interrupt(runId) {
    const run = runs.get(runId);
    if (!run) return false;
    try {
      run.child.kill('SIGINT');
    } catch {
      /* already gone */
    }
    return true;
  }

  function stopAll() {
    for (const run of runs.values()) {
      try {
        run.child.kill();
      } catch {
        /* already gone */
      }
    }
    runs.clear();
  }

  return { start, send, interrupt, stopAll, get size() { return runs.size; } };
}

function writeTurn(run, text) {
  if (text == null) return;
  try {
    run.child.stdin.write(encodeUserTurn(text));
  } catch {
    /* stdin closed — the run is ending */
  }
}
