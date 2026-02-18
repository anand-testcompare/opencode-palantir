type JsonRpcId = number | string;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params?: any;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error?: any;
};

function formatError(err: unknown): string {
  return err instanceof Error ? err.toString() : String(err);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const t: Promise<T> = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => {
    if (timeoutId) globalThis.clearTimeout(timeoutId);
  });
}

// palantir-mcp may need to fetch/install @palantir/mcp from a Foundry-hosted npm registry
// before the MCP server starts. First run can take minutes.
const MCP_INIT_TIMEOUT_MS: number = 300_000;
const MCP_TOOLS_LIST_TIMEOUT_MS: number = 120_000;

function tryExtractToolNames(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (result as any).tools;
  if (!Array.isArray(tools)) return [];

  const names: string[] = [];
  for (const t of tools) {
    if (!t || typeof t !== 'object') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (t as any).name;
    if (typeof name !== 'string') continue;
    names.push(name);
  }

  return names;
}

export async function listPalantirMcpTools(foundryApiUrl: string): Promise<string[]> {
  const proc = Bun.spawn(['npx', '-y', 'palantir-mcp', '--foundry-api-url', foundryApiUrl], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  const stderrChunks: string[] = [];
  const maxStderrChars: number = 32_000;
  const stderrReader = proc.stderr.getReader();
  const stderrPump: Promise<void> = (async () => {
    const decoder: TextDecoder = new TextDecoder();
    while (true) {
      const { value, done } = await stderrReader.read();
      if (done) break;
      if (!value) continue;
      const chunk: string = decoder.decode(value, { stream: true });
      stderrChunks.push(chunk);
      const joined: string = stderrChunks.join('');
      if (joined.length > maxStderrChars) {
        stderrChunks.length = 0;
        stderrChunks.push(joined.slice(-maxStderrChars));
      }
    }
  })();

  const pending: Map<
    JsonRpcId,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      resolve: (value: any) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      reject: (reason: any) => void;
    }
  > = new Map();

  let nextId: number = 1;
  let buffer: Buffer = Buffer.alloc(0);

  const stdoutReader = proc.stdout.getReader();
  const stdoutPump: Promise<void> = (async () => {
    while (true) {
      const { value, done } = await stdoutReader.read();
      if (done) break;
      if (!value) continue;
      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      while (true) {
        const newlineIdx: number = buffer.indexOf('\n');
        if (newlineIdx === -1) break;

        const lineRaw: string = buffer.subarray(0, newlineIdx).toString('utf8');
        buffer = buffer.subarray(newlineIdx + 1);

        const line: string = lineRaw.replace(/\r$/, '').trim();
        if (!line) continue;

        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(line) as JsonRpcResponse;
        } catch {
          continue;
        }

        if (typeof msg?.id !== 'number' && typeof msg?.id !== 'string') continue;
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);

        if (msg.error) {
          p.reject(msg.error);
          continue;
        }
        p.resolve(msg.result);
      }
    }

    const errText: string = stderrChunks.join('');
    for (const [, p] of pending) {
      p.reject(new Error(`MCP process exited unexpectedly. stderr:\n${errText}`));
    }
    pending.clear();
  })();

  async function writeStdin(line: string): Promise<void> {
    const res = proc.stdin.write(line);
    if (res instanceof Promise) await res;
  }

  async function sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id: number = nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const line: string = `${JSON.stringify(req)}\n`;

    const p: Promise<unknown> = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });

    await writeStdin(line);
    return p;
  }

  async function sendNotification(method: string, params?: unknown): Promise<void> {
    const notif: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    const line: string = `${JSON.stringify(notif)}\n`;
    await writeStdin(line);
  }

  try {
    await withTimeout(
      sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: '@openontology/opencode-palantir', version: '0.0.0' },
      }),
      MCP_INIT_TIMEOUT_MS,
      'MCP initialize'
    );
    await sendNotification('notifications/initialized');

    const listResult: unknown = await withTimeout(
      sendRequest('tools/list', {}),
      MCP_TOOLS_LIST_TIMEOUT_MS,
      'MCP tools/list'
    );
    const names: string[] = tryExtractToolNames(listResult);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  } catch (err) {
    const stderrText: string = stderrChunks.join('');
    throw new Error(
      `[ERROR] Failed to list palantir-mcp tools: ${formatError(err)}\n${stderrText}`,
      {
        cause: err,
      }
    );
  } finally {
    try {
      proc.kill();
    } catch {
      // Ignore.
    }
    await Promise.allSettled([stdoutPump, stderrPump]);
  }
}
