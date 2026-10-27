import { isIP } from 'node:net';
import { getAllowedPrivateHosts } from '../env';

// 任意の Base URL へサーバーから接続するため、SSRF（内部ネットワークやクラウドの
// メタデータサービスへの不正アクセス）を防ぐ検証を行う。
// - URLの静的検証（スキーム・認証情報・ホスト名）
// - DNS解決後の全IPアドレスの検証（接続直前に実施し、DNSリバインディングを防ぐ）
// - リダイレクトは追跡しない（safeHttp 側で実施）

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inCidr4(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** 許可リストに登録されていても接続させないアドレス（クラウドのメタデータサービス等） */
function isAlwaysBlocked(ip: string): boolean {
  const v4 = extractV4(ip);
  if (v4) return inCidr4(v4, '169.254.0.0', 16) || inCidr4(v4, '0.0.0.0', 8) || inCidr4(v4, '224.0.0.0', 4);
  const lower = ip.toLowerCase();
  return lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower === 'fd00:ec2::254' || lower.startsWith('ff');
}

function extractV4(ip: string): string | null {
  if (isIP(ip) === 4) return ip;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return mapped ? mapped[1] : null;
}

export function isPrivateAddress(ip: string): boolean {
  const v4 = extractV4(ip);
  if (v4) return BLOCKED_V4.some(([base, bits]) => inCidr4(v4, base, bits));
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (/^::ffff:[0-9a-f]+:[0-9a-f]+$/.test(lower)) return true; // 16進表記のIPv4射影
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (/^fe[89ab]/.test(lower)) return true; // リンクローカル
  if (lower.startsWith('ff')) return true; // マルチキャスト
  if (lower.startsWith('64:ff9b:')) return true; // NAT64
  if (lower.startsWith('2001:db8')) return true; // 文書用
  return false;
}

const INTERNAL_HOSTNAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/i;

function hostKey(url: URL): { host: string; hostPort: string } {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return { host, hostPort: `${host}:${port}` };
}

export function isAllowlistedHost(url: URL): boolean {
  const allowed = getAllowedPrivateHosts().map((h) => h.replace(/[[\]]/g, ''));
  const { host, hostPort } = hostKey(url);
  return allowed.includes(host) || allowed.includes(hostPort);
}

/**
 * Base URL の静的検証。保存時と接続時の両方で呼び出す。
 * 正規化済みURL（末尾スラッシュなし）を返す。
 */
export function validateBaseUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SsrfError('Base URL の形式が正しくありません。');
  }
  if (url.username || url.password) throw new SsrfError('Base URL に認証情報を含めることはできません。');
  if (url.search || url.hash) throw new SsrfError('Base URL にクエリやフラグメントは指定できません。');

  const allowlisted = isAllowlistedHost(url);
  if (url.protocol === 'http:') {
    if (!allowlisted) {
      throw new SsrfError('Base URL は https:// で指定してください（http はローカルLLM用に許可されたホストのみ利用できます）。');
    }
  } else if (url.protocol !== 'https:') {
    throw new SsrfError('Base URL は https:// で指定してください。');
  }

  const { host } = hostKey(url);
  if (!allowlisted) {
    if (isIP(host)) {
      if (isPrivateAddress(host)) throw new SsrfError('プライベートネットワークのアドレスには接続できません。');
    } else if (INTERNAL_HOSTNAME.test(host) || !host.includes('.')) {
      throw new SsrfError('内部ネットワークのホスト名には接続できません。');
    }
  }
  if (isIP(host) && isAlwaysBlocked(host)) throw new SsrfError('このアドレスには接続できません。');

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

/** DNS解決結果の検証。接続に使う全アドレスが安全でなければ拒否する。 */
export function assertResolvedAddressesAllowed(url: URL, addresses: string[]): void {
  if (addresses.length === 0) throw new SsrfError('接続先のアドレスを解決できませんでした。');
  const allowlisted = isAllowlistedHost(url);
  for (const address of addresses) {
    if (isAlwaysBlocked(address)) throw new SsrfError('このアドレスには接続できません。');
    if (!allowlisted && isPrivateAddress(address)) {
      throw new SsrfError('接続先がプライベートネットワークのアドレスに解決されたため拒否しました。');
    }
  }
}
