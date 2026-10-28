import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = join(__dirname, '..', '..');
const migrationsDir = join(root, 'supabase', 'migrations');

export type Db = PGlite & {
  /** Run as an authenticated Supabase user (RLS applies). */
  as: <T = Record<string, unknown>>(uid: string, sql: string, params?: unknown[]) => Promise<T[]>;
  /** Run as the database owner (bypasses RLS) — test setup only. */
  admin: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  /** Call an RPC as a user and return its single scalar/json result. */
  rpc: <T = unknown>(uid: string, fn: string, args: Record<string, unknown>) => Promise<T>;
  /** Call a void / setof RPC as a user and return raw rows. */
  call: (uid: string, fn: string, args: Record<string, unknown>) => Promise<Record<string, unknown>[]>;
  /** Create an auth user. */
  user: (label: string) => Promise<string>;
};

let counter = 0;

/** Wrap a JS array that should be sent as a Postgres array (e.g. uuid[]) rather than JSON. */
export class PgArray {
  constructor(public values: unknown[]) {}
}

export async function createDb(): Promise<Db> {
  const pg = new PGlite();
  await pg.exec(readFileSync(join(__dirname, 'supabase-shim.sql'), 'utf8'));
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    try {
      await pg.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    } catch (e) {
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
  const db = pg as Db;

  // PGlite is single-connection: serialise role switches with a queue.
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  db.as = (uid, sql, params = []) =>
    run(async () => {
      await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
      try {
        const r = await pg.query(sql, params);
        return r.rows as never;
      } finally {
        await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
      }
    });

  db.admin = (sql, params = []) => run(async () => (await pg.query(sql, params)).rows as never);

  const prep = (args: Record<string, unknown>) => {
    const keys = Object.keys(args);
    const params = keys.map((k) => {
      const v = args[k];
      if (v instanceof PgArray) return v.values;
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
    return { params, named };
  };

  db.rpc = async (uid, fn, args) => {
    const { params, named } = prep(args);
    const rows = await db.as<Record<string, unknown>>(uid, `select to_jsonb(public.${fn}(${named})) as r`, params);
    return rows[0]?.r as never;
  };

  db.call = async (uid, fn, args) => {
    const { params, named } = prep(args);
    return db.as<Record<string, unknown>>(uid, `select public.${fn}(${named})::text as r`, params);
  };

  db.user = async (label) => {
    counter += 1;
    const hex = counter.toString(16).padStart(12, '0');
    const id = `00000000-0000-4000-8000-${hex}`;
    await db.admin(`insert into auth.users (id) values ($1)`, [id]);
    void label;
    return id;
  };

  return db;
}

/** Simulate a successful Storage upload (Storage writes metadata server-side). */
export async function fakeUpload(db: Db, uid: string, path: string, mimetype = 'image/jpeg', size = 1024) {
  return db.as(
    uid,
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('proof', $1, $2::uuid, $2, $3::jsonb) returning name`,
    [path, uid, JSON.stringify({ mimetype, size })],
  );
}

export function uuid() {
  return randomUUID();
}
