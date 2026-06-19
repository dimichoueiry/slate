// The `run_python` tool: lets the business agent WRITE AND RUN real pandas over
// the full file instead of reasoning over a text sample. The model authors the
// code; this tool just executes it in the Pyodide sandbox and returns stdout.
// Layered on top of the deterministic JS tools (hybrid): quick stats stay cheap
// and exact; run_python is the escape hatch for cleaning, multi-step logic and
// listing specific rows.
import type { ToolDef } from './llm';
import { runPython } from '../sandbox/python';

export const PYTHON_TOOL_DEF: ToolDef = {
  type: 'function',
  function: {
    name: 'run_python',
    description:
      'Write and run Python (pandas/numpy) over the dataset. The COMPLETE file is preloaded as DataFrame `df` (every row, not a sample). Variables persist between calls, so you can build the analysis step by step. Only what you print() is returned — so print the counts, rows and numbers you need. Use this for any exact computation, data cleaning, multi-condition filtering, or listing specific customers/rows. Start by printing len(df) and df.columns.tolist().',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python source to execute. print() everything you want to see in the result.' },
      },
      required: ['code'],
    },
  },
};

type Tools = { defs: ToolDef[]; run: (name: string, args: Record<string, any>) => any };

/** Add the run_python tool to an existing tool set, bound to one CSV file. */
export function withPython(base: Tools, csv: string): Tools {
  const defs = [...base.defs, PYTHON_TOOL_DEF];
  const run = async (name: string, args: Record<string, any>) => {
    if (name !== 'run_python') return base.run(name, args);
    const code = String(args?.code ?? '');
    if (!code.trim()) return { error: 'No code provided — pass Python source in `code`.' };
    const { stdout, error } = await runPython(code, csv);
    // Cap the payload so a giant print() can't blow the prompt back up.
    const out = (stdout ?? '').slice(0, 12_000);
    if (error) return { error, stdout: out };
    return { stdout: out || '(no output — remember to print() the values you want to see)' };
  };
  return { defs, run };
}
