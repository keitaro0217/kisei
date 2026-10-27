import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { getEgressProxyUrl } from '../env';
import { assertResolvedAddressesAllowed, isAllowlistedHost, SsrfError, validateBaseUrl } from '../security/ssrf';

// 外部LLM APIへの通信専用のHTTPクライアント。
// - 接続直前のDNS解決結果を検証（DNSリバインディング対策）
// - リダイレクトを追跡しない
// - タイムアウトと応答サイズ上限
// - 任意で HTTP CONNECT プロキシ（LLM_EGRESS_PROXY_URL）経由の通信

export class HttpTimeoutError extends Error {
  constructor() {
    super('応答待機がタイムアウトしました。');
    this.name = 'HttpTimeoutError';
  }
}

export class HttpNetworkError extends Error {
  constructor(public readonly code: string) {
    super(`接続先との通信に失敗しました（${code}）。`);
    this.name = 'HttpNetworkError';
  }
}

export type SafeRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxResponseBytes?: number;
};

export type SafeResponse = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(target: URL) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
      if (err) return callback(err, []);
      try {
        assertResolvedAddressesAllowed(
          target,
          addresses.map((a) => a.address),
        );
      } catch (e) {
        return callback(e as NodeJS.ErrnoException, []);
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

function resolveAll(hostname: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    dns.lookup(hostname, { all: true }, (err, addresses) => resolve(err ? null : addresses.map((a) => a.address)));
  });
}

/** CONNECT プロキシ経由で TLS ソケットを確立する */
function connectViaProxy(proxy: URL, target: URL, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const port = Number(target.port || 443);
    const proxyModule = proxy.protocol === 'https:' ? https : http;
    const req = proxyModule.request({
      host: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}` },
      timeout: timeoutMs,
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new HttpNetworkError(`PROXY_${res.statusCode}`));
        return;
      }
      const secure = tls.connect({ socket, servername: target.hostname });
      secure.once('secureConnect', () => resolve(secure));
      secure.once('error', (e: NodeJS.ErrnoException) => reject(new HttpNetworkError(e.code || 'TLS_ERROR')));
    });
    req.on('timeout', () => req.destroy(new HttpTimeoutError()));
    req.on('error', (e: NodeJS.ErrnoException) => reject(e instanceof HttpTimeoutError ? e : new HttpNetworkError(e.code || 'PROXY_ERROR')));
    req.end();
  });
}

export async function safeRequest(input: SafeRequest): Promise<SafeResponse> {
  const target = new URL(input.url);
  // オリジン部分（スキーム・ホスト・ポート）を Base URL と同じ規則で検証する
  validateBaseUrl(target.origin);
  if (target.username || target.password) throw new SsrfError('URL に認証情報を含めることはできません。');

  const maxBytes = input.maxResponseBytes ?? 5 * 1024 * 1024;
  const proxy = getEgressProxyUrl();
  const isHttps = target.protocol === 'https:';
  const host = target.hostname.replace(/^\[|\]$/g, '');

  let createConnection: (() => net.Socket) | undefined;
  if (proxy && isHttps && !isAllowlistedHost(target)) {
    // プロキシ経由でも、ローカルで名前解決できる場合は解決結果を検証する
    if (!net.isIP(host)) {
      const local = await resolveAll(host);
      if (local) assertResolvedAddressesAllowed(target, local);
    }
    const socket = await connectViaProxy(proxy, target, input.timeoutMs);
    createConnection = () => socket;
  } else if (net.isIP(host)) {
    assertResolvedAddressesAllowed(target, [host]);
  }

  const headers: Record<string, string> = { accept: 'application/json', ...(input.headers ?? {}) };
  if (input.body !== undefined) headers['content-length'] = String(Buffer.byteLength(input.body));

  return new Promise<SafeResponse>((resolve, reject) => {
    const options: https.RequestOptions = {
      method: input.method,
      protocol: target.protocol,
      hostname: host,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      headers,
      agent: false,
      servername: isHttps && !net.isIP(host) ? host : undefined,
    };
    if (createConnection) {
      options.createConnection = createConnection;
    } else {
      options.lookup = guardedLookup(target) as unknown as net.LookupFunction;
    }

    const req = (isHttps ? https : http).request(options, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        reject(new SsrfError('接続先がリダイレクトを返しました。安全のためリダイレクトは追跡しません。'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy(new HttpNetworkError('RESPONSE_TOO_LARGE'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', (e: NodeJS.ErrnoException) => reject(new HttpNetworkError(e.code || 'RESPONSE_ERROR')));
    });

    const timer = setTimeout(() => req.destroy(new HttpTimeoutError()), input.timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e instanceof HttpTimeoutError || e instanceof SsrfError || e instanceof HttpNetworkError) reject(e);
      else reject(new HttpNetworkError(e.code || 'NETWORK_ERROR'));
    });
    if (input.body !== undefined) req.write(input.body);
    req.end();
  });
}
