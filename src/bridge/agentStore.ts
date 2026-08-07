// Bridge between the agent's permission prompts (which arrive over the WS as
// `permission.ask` tool calls, outside React) and the agent panel UI. The panel
// subscribes to `useAgentPerm`; methods.ts parks a promise here and the panel
// resolves it when the user clicks Allow/Deny.

import { create } from 'zustand';

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: unknown;
  askedAt: number;
}

interface AgentPermState {
  pending: PermissionRequest[];
}

export const useAgentPerm = create<AgentPermState>(() => ({ pending: [] }));

const resolvers = new Map<string, (d: { approved: boolean; message?: string }) => void>();
let seq = 0;

/** Called from methods.ts when claude requests permission. Resolves on the user's click. */
export function askPermission(toolName: string, input: unknown): Promise<{ approved: boolean; message?: string }> {
  const id = `perm-${++seq}`;
  return new Promise((resolve) => {
    resolvers.set(id, resolve);
    useAgentPerm.setState((s) => ({
      pending: [...s.pending, { id, toolName, input, askedAt: Date.now() }],
    }));
  });
}

/** Called from the panel when the user decides. */
export function answerPermission(id: string, approved: boolean, message?: string) {
  const r = resolvers.get(id);
  if (r) {
    resolvers.delete(id);
    r({ approved, message });
  }
  useAgentPerm.setState((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
}
