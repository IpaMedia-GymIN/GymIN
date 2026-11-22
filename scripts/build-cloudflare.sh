#!/usr/bin/env bash
# Build per Cloudflare Workers: crea dist/ con GymIN (web/) e Accessi (/accessi/).
# Nessuna chiave entra in dist/: config.js lo genera il Worker (cloudflare/worker.js).
set -euo pipefail
cd "$(dirname "$0")/.."

V="${WORKERS_CI_COMMIT_SHA:-$(git rev-parse HEAD 2>/dev/null || echo local)}"
V="${V::8}-$(date +%s)"

rm -rf dist
mkdir -p dist
cp -r web/. dist/
rm -f dist/config.js dist/config.example.js

# Accessi senza variabili Supabase (le aggiunge il Worker); niente --config-gymin,
# così non viene letta la chiave di web/config.js
(cd accessi && SUPABASE_URL= SUPABASE_ANON_KEY= BUILD_VERSION="$V" node scripts/build.mjs)
cp -r accessi/dist dist/accessi

# cache busting come su GitHub Pages
find dist -name index.html -o -name '*.js' | xargs sed -i "s/__BUILD__/$V/g"
echo "dist/ pronta (versione $V)"
