// Permessi: cosa può fare chi ha solo la chiave anon (pubblica). Avvio: npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { preparaDb, come, ADMIN, STAFF, ESTRANEO } from './helper.mjs';

let pool;
// le funzioni delle estensioni (es. pgcrypto) sono escluse: in Supabase stanno nello schema extensions
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

before(async () => { pool = await preparaDb(); });
after(async () => { await pool?.end(); });

test('anon non legge né modifica la vista v_abbonamenti_stato', async () => {
  await assert.rejects(come(pool, 'anon', (c) => c.query('select * from v_abbonamenti_stato')), /permission denied/);
  await assert.rejects(come(pool, 'anon', (c) => c.query('delete from v_abbonamenti_stato')), /permission denied/);
});

test('la vista rispetta la RLS (security_invoker)', async () => {
  const [{ opts }] = await q(`select array_to_string(reloptions, ',') opts from pg_class where relname = 'v_abbonamenti_stato'`);
  assert.match(opts, /security_invoker=true/);
});

test('anon esegue solo le funzioni del terminale', async () => {
  const righe = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1`);
  const nomi = righe.map((r) => r.proname);
  assert.ok(nomi.length > 0, 'le funzioni del terminale devono restare eseguibili');
  assert.deepEqual(nomi.filter((n) => !n.startsWith('terminale_')), []);
});

test('lo staff mantiene le sue funzioni', async () => {
  for (const f of ['staff_registra_ingresso(uuid)', 'staff_assegna_tessera(uuid,text,text,boolean)', 'abbonamenti_scaduti()']) {
    const [{ ok }] = await q(`select has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') ok`, [f]);
    assert.equal(ok, true, f);
  }
});

test('tutte le funzioni hanno search_path fisso', async () => {
  const righe = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  assert.deepEqual(righe.map((r) => r.proname), []);
});

// --- staff vero: non basta essere autenticati (migration staff_ruoli) ---

test('un utente autenticato che non è staff non legge e non scrive', async () => {
  await pool.query(`insert into soci (nome, cognome) values ('Prova', 'Sicurezza')`);
  const righe = await come(pool, 'authenticated', (c) => c.query('select id from soci'), ESTRANEO);
  assert.equal(righe.rowCount, 0);
  await assert.rejects(come(pool, 'authenticated', (c) => c.query(`insert into soci (nome, cognome) values ('X', 'Y')`), ESTRANEO), /row-level security/);
  const staff = await come(pool, 'authenticated', (c) => c.query('select id from soci'));
  assert.ok(staff.rowCount > 0, 'lo staff continua a leggere');
});

test('le funzioni staff_* rifiutano chi non è staff', async () => {
  for (const sql of [`select staff_crea_terminale('x')`, 'select * from staff_tessere_non_associate()', `select staff_revoca_terminale(gen_random_uuid())`]) {
    await assert.rejects(come(pool, 'authenticated', (c) => c.query(sql), ESTRANEO), /riservato allo staff/, sql);
  }
  await come(pool, 'authenticated', (c) => c.query('select * from staff_tessere_non_associate()'));
});

test('admin è un ruolo della tabella staff, non un indirizzo email', async () => {
  const chi = (uid) => come(pool, 'authenticated', (c) => c.query('select is_staff() s, is_log_admin() a'), uid).then((r) => r.rows[0]);
  assert.deepEqual(await chi(ADMIN), { s: true, a: true });
  assert.deepEqual(await chi(STAFF), { s: true, a: false });
  assert.deepEqual(await chi(ESTRANEO), { s: false, a: false });
});

test('nessuna policy lascia passare ogni utente autenticato', async () => {
  const righe = await q(`select tablename || '.' || policyname p from pg_policies
    where schemaname = 'public' and (qual = 'true' or with_check = 'true')`);
  assert.deepEqual(righe.map((r) => r.p), []);
});

test('ogni funzione security definer aperta agli autenticati controlla chi la chiama', async () => {
  // esclusi: i trigger (non si chiamano da fuori) e le funzioni che SONO il controllo
  const righe = await q(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname not in ('is_staff', 'is_log_admin', 'richiedi_staff')
      and p.prosrc !~ 'richiedi_staff\\(\\)|is_log_admin\\(\\)|terminale_autentica\\('
    order by 1`);
  assert.deepEqual(righe.map((r) => r.proname), []);
});
