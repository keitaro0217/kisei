import path from 'node:path';
import { getDataDir, getDatabaseUrl } from '../env';
import { SCHEMA_STATEMENTS } from './schema';

// データベース接続。
// - DATABASE_URL が設定されていれば PostgreSQL（Vercel では Neon などのマネージド Postgres）に接続する。
// - 未設定ならローカル開発・テスト用に、組み込み Postgres（PGlite）を RESEARCH_DATA_DIR に保存して使う。
// どちらも同じ SQL で動くよう、利用側は Db インターフェースだけに依存する。

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** トランザクション内で fn を実行する。fn が例外を投げればロールバックする */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

async function createPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  // サーバーレスでは同時接続数を抑え、PgBouncer（トランザクションモード）でも動くよう prepare を無効にする
  const sql = postgres(url, { max: Number(process.env.DATABASE_POOL_MAX || 5), prepare: false, idle_timeout: 20, onnotice: () => {} });
  const run = async <T extends Row>(client: { unsafe: typeof sql.unsafe }, text: string, params: unknown[] = []) =>
    (await client.unsafe(text, params as never[])) as unknown as T[];
  return {
    kind: 'postgres',
    query: (text, params) => run(sql, text, params),
    transaction: async <T>(fn: (tx: Queryable) => Promise<T>) => {
      // デッドロック・直列化の失敗は一時的なため、トランザクション全体をやり直す
      for (let attempt = 1; ; attempt++) {
        try {
          return (await sql.begin((tx) => fn({ query: (text, params) => run(tx, text, params) }))) as T;
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (attempt >= 5 || (code !== '40P01' && code !== '40001')) throw e;
          await new Promise((r) => setTimeout(r, 10 * attempt + Math.random() * 20));
        }
      }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

async function createPglite(dataDir: string | null): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    query: async (text, params) => (await db.query(text, params)).rows as never,
    transaction: (fn) => db.transaction((tx) => fn({ query: async (text, params) => (await tx.query(text, params)).rows as never })),
    close: () => db.close(),
  };
}

type DbGlobal = { db: Promise<Db> | null };
const g = globalThis as typeof globalThis & { __researchDb?: DbGlobal };
const holder: DbGlobal = (g.__researchDb ??= { db: null });

async function open(): Promise<Db> {
  const url = getDatabaseUrl();
  const db = url
    ? await createPostgres(url)
    : await createPglite(process.env.RESEARCH_DB_IN_MEMORY === '1' ? null : path.resolve(process.cwd(), getDataDir(), 'pglite'));
  // スキーマは冪等（CREATE TABLE IF NOT EXISTS）。複数インスタンスが同時に起動しても安全なようロックを取る
  await db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727001)');
    for (const statement of SCHEMA_STATEMENTS) await tx.query(statement);
  });
  return db;
}

export function getDb(): Promise<Db> {
  holder.db ??= open().catch((e) => {
    holder.db = null;
    throw e;
  });
  return holder.db;
}

/** テスト用: 接続を閉じて破棄する */
export async function resetDbForTests() {
  const current = holder.db;
  holder.db = null;
  if (current) await (await current).close();
}
