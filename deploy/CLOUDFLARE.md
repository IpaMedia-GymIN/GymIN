# GymIN su Cloudflare Workers

GymIN passa da GitHub Pages a **Cloudflare Workers con file statici**. Un Worker per prodotto,
un sottodominio per palestra cliente, un ambiente di test separato con il suo database.

| Ramo GitHub | Worker | Indirizzo | Supabase |
|---|---|---|---|
| `main` | `gymin` | `gymin.ipamedia.it` e `*.gymin.ipamedia.it` (es. `kinesia.gymin.ipamedia.it`) | GymIN produzione |
| `test` | `gymin-test` | `test.gymin.ipamedia.it` | GymIN demo |
| ogni altro ramo / PR | `gymin-test` (anteprima) | `<versione>-gymin-test.<account>.workers.dev` | GymIN demo |

## Come funziona

- `scripts/build-cloudflare.sh` crea `dist/`: il gestionale (`web/`) alla radice e il
  terminale Accessi in `/accessi/`. In `dist/` **non** finisce nessuna chiave.
- `cloudflare/worker.js` serve i file di `dist/` e genera al volo `/config.js` e
  `/accessi/config.js` con `SUPABASE_URL` e `SUPABASE_ANON_KEY` del Worker che risponde.
  Così lo stesso codice punta alla produzione su `gymin` e alla demo su `gymin-test`.
- Su `gymin-test` `config.js` aggiunge la fascia arancione "AMBIENTE DI TEST" (come prima su `/test/`).
  Il test non usa più lo schema `test` del database di produzione: ha un progetto Supabase suo.
- `wrangler.jsonc` descrive i due ambienti. Prova locale:
  `bash scripts/build-cloudflare.sh && npx wrangler dev --env test` (con un file `.dev.vars.test`,
  già escluso da git, che contiene `SUPABASE_URL=...` e `SUPABASE_ANON_KEY=...` del progetto demo).

## Collegare la repo (Workers Builds)

Cloudflare → Workers & Pages → Create → Import a repository → `IpaMedia-GymIN/GymIN`.
Si creano **due** Worker collegati alla stessa repo:

| Impostazione | Worker `gymin` | Worker `gymin-test` |
|---|---|---|
| Production branch | `main` | `test` |
| Build command | `bash scripts/build-cloudflare.sh` | `bash scripts/build-cloudflare.sh` |
| Deploy command | `npx wrangler deploy` | `npx wrangler deploy --env test` |
| Builds for non-production branches | **spento** | acceso |
| Non-production branch deploy command | — | `npx wrangler versions upload --env test` |

Il nome del Worker nella dashboard deve coincidere con quello di `wrangler.jsonc`
(`gymin` e `gymin-test`), altrimenti la build si ferma.

## DNS e certificati (da sapere prima di comprare)

- Il dominio `ipamedia.it` deve avere i DNS su Cloudflare.
- `test.gymin.ipamedia.it` è un *Custom Domain* del Worker: Cloudflare crea da solo il record DNS e il certificato.
- Per `gymin.ipamedia.it` e `*.gymin.ipamedia.it` servono due record DNS **proxied** (nuvola arancione),
  per esempio `AAAA gymin 100::` e `AAAA *.gymin 100::`.
- **Attenzione al certificato**: il certificato gratuito (Universal SSL) copre `ipamedia.it` e un solo
  livello (`*.ipamedia.it`). `gymin.ipamedia.it` è coperto, ma `kinesia.gymin.ipamedia.it` è al secondo
  livello e **non** lo è. Strade possibili:
  1. aggiungere ogni palestra come *Custom Domain* del Worker (certificato gratuito, una riga in
     `wrangler.jsonc` per palestra);
  2. Advanced Certificate Manager (a pagamento, circa 10 $/mese) per `*.gymin.ipamedia.it`;
  3. nomi a un solo livello, es. `kinesia-gymin.ipamedia.it`.
  Finché c'è una sola palestra, la 1 è la più semplice.

## Variabili e segreti da impostare

Nessun valore vero va scritto nel repo. Dove si trova ciascun valore:

### Cloudflare (Workers & Pages → Worker → Settings → Variables and Secrets, tipo **Secret**)

| Worker | Nome | Valore | Dove si trova |
|---|---|---|---|
| `gymin` | `SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase, progetto **GymIN produzione** → Project Settings → Data API → Project URL |
| `gymin` | `SUPABASE_ANON_KEY` | `sb_publishable_...` | Supabase, **GymIN produzione** → Project Settings → API Keys → Publishable key |
| `gymin-test` | `SUPABASE_URL` | `https://<ref>.supabase.co` | Supabase, progetto **GymIN demo** → Project Settings → Data API → Project URL |
| `gymin-test` | `SUPABASE_ANON_KEY` | `sb_publishable_...` | Supabase, **GymIN demo** → Project Settings → API Keys → Publishable key |

`GYMIN_ENV` (`produzione` / `test`) è già in `wrangler.jsonc`. Non servono variabili di build.
La chiave publishable è pubblica per natura (protetta dalle regole RLS); la si mette come Secret
solo perché così sopravvive ai deploy e non finisce nel repo. **Mai** la secret key (`sb_secret_...`) o la service_role.

Cloudflare Access (Zero Trust → Access → Applications): un'applicazione per `test.gymin.ipamedia.it`
e una per le anteprime `*-gymin-test.<account>.workers.dev`, accesso solo a Loris. Nessun segreto da copiare.

### GitHub (`IpaMedia-GymIN/GymIN` → Settings → Secrets and variables → Actions)

Dopo il trasferimento controllare che ci siano ancora.

| Tipo | Nome | Usato da | Valore e dove si trova |
|---|---|---|---|
| Secret | `SUPABASE_DB_URL` | `backup-db.yml`, `restore-test.yml` | Stringa *Session pooler* di **GymIN produzione**: Supabase → Connect → Session pooler, con la password del database (impostata alla creazione del progetto; si reimposta in Database → Settings) |
| Secret | `BACKUP_PASSPHRASE` | `backup-db.yml`, `restore-test.yml` | **La stessa di oggi** (dal gestore password di Loris): serve anche a decifrare i backup già fatti |
| Variable | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `pages.yml` (GitHub Pages) | Solo finché resta attivo Pages; da cancellare insieme a `pages.yml` e `test-deploy.yml` quando Cloudflare è in funzione |
| Secret | `OCI_*`, `SSH_PUBKEY` | `oci-launch.yml` | Invariati, non legati a questo passaggio |

### Supabase, nuovo progetto GymIN produzione (non su GitHub né Cloudflare, ma da rifare)

- Edge Functions → Secrets: `BREVO_API_KEY` (Brevo → SMTP & API → API Keys), `MAIL_FROM`,
  facoltativi `ALLOWED_ORIGINS` e `REPORT_TO`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` e
  `SUPABASE_SERVICE_ROLE_KEY` li fornisce Supabase.
- Authentication → URL Configuration: Site URL `https://gymin.ipamedia.it`, Redirect URLs
  `https://gymin.ipamedia.it/**`, `https://*.gymin.ipamedia.it/**` (sul progetto demo: `https://test.gymin.ipamedia.it/**`).
- Tabella `report_config`, colonna `url`: indirizzo della funzione `report-serale` del nuovo progetto.

### PC della palestra (`C:\GymIN-import\.env`)

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (secret key) del **nuovo** progetto di produzione:
  Project Settings → API Keys → Secret key.
- `GYMIN_WEB_URL=https://gymin.ipamedia.it/js/` (è anche il nuovo valore predefinito di `auto-import.mjs`).
- Terminale ingresso: in `avvia-ingresso.bat` l'indirizzo è ora `https://gymin.ipamedia.it/accessi/ingresso/`.
  **Ricopiare questi file sul PC solo quando il sito risponde su Cloudflare.**

## Backup notturno (`backup-db.yml`) e cambio database

Segreti usati: `SUPABASE_DB_URL` e `BACKUP_PASSPHRASE` (gli stessi di `restore-test.yml`).
Quando la produzione passa al nuovo progetto Supabase:

1. Aggiornare `SUPABASE_DB_URL` con la stringa *Session pooler* del nuovo progetto
   (forma `postgresql://postgres.<nuovo-ref>:<password>@aws-…-<regione>.pooler.supabase.com:5432/postgres`).
   Il workflow non va modificato: controlla solo che inizi con `postgresql://`.
2. Tenere **la stessa** `BACKUP_PASSPHRASE`, altrimenti i backup degli ultimi 30 giorni non si aprono più.
3. Fare un ultimo backup a mano (Actions → Backup notturno → Run workflow) **prima** di spostare i dati,
   e lanciare "Prova ripristino backup" **dopo** il primo backup del nuovo progetto: confronta le righe con
   la produzione, quindi sul vecchio backup darebbe differenze.
4. Il dump copre gli schemi `public` e `auth`. Se nel nuovo progetto finisce anche lo schema `monitor`
   (presente oggi in produzione), va aggiunto `--schema=monitor` nel workflow. Lo schema `test` sparisce.
5. Il client è `postgres:17`: va bene finché il nuovo progetto è su Postgres 17 o precedente.
6. Il progetto **demo** non ha backup e, essendo gratuito, va in pausa dopo una settimana senza uso.
   Se serve tenerlo sveglio, basta un secondo secret (es. `SUPABASE_DEMO_DB_URL`) e un job uguale: da decidere.

## Da spegnere a passaggio finito

`.github/workflows/pages.yml`, `.github/workflows/test-deploy.yml`, le Variables `SUPABASE_URL`/`SUPABASE_ANON_KEY`
di GitHub, GitHub Pages nelle impostazioni della repo, e `web/config.js` (oggi contiene la chiave del vecchio progetto).
