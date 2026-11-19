#!/usr/bin/env bash
# Puts One Family online on Cloudflare's free plan: the database, the server and the website.
# Safe to run again: it creates what is missing and updates the rest.
# Needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and SETUP_TOKEN in the environment.
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Add CLOUDFLARE_API_TOKEN as a GitHub secret}"
: "${CLOUDFLARE_ACCOUNT_ID:?Add CLOUDFLARE_ACCOUNT_ID as a GitHub secret}"
: "${SETUP_TOKEN:?Add SETUP_TOKEN as a GitHub secret}"

DB_NAME=onefamily
WORKER=onefamily-api
PAGES=onefamily
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CF="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"

cf() { # cf METHOD PATH [JSON]
  local out
  out=$(curl -sS -X "$1" "$CF$2" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" ${3:+--data "$3"})
  if [ "$(jq -r '.success' <<<"$out")" != "true" ]; then
    echo "Cloudflare said no to $1 $2: $(jq -c '.errors' <<<"$out")" >&2
    return 1
  fi
  echo "$out"
}

echo "== 1. Database"
DB_ID=$(cf GET "/d1/database?name=$DB_NAME" | jq -r --arg n "$DB_NAME" '.result[] | select(.name == $n) | .uuid' | head -n1)
if [ -z "$DB_ID" ]; then
  DB_ID=$(cf POST /d1/database "{\"name\":\"$DB_NAME\"}" | jq -r '.result.uuid')
  echo "Created database $DB_NAME"
fi
sed -i "s/^database_id = .*/database_id = \"$DB_ID\"/" "$ROOT/api/wrangler.toml"

echo "== 2. Addresses"
SUB=$(cf GET /workers/subdomain | jq -r '.result.subdomain // empty' || true)
if [ -z "$SUB" ]; then
  echo "Your Cloudflare account has no workers.dev name yet. Open Workers & Pages in the Cloudflare dashboard once, choose a name, then run this again." >&2
  exit 1
fi
API_URL="https://$WORKER.$SUB.workers.dev"

if ! cf GET "/pages/projects/$PAGES" >/dev/null 2>&1; then
  cf POST /pages/projects "{\"name\":\"$PAGES\",\"production_branch\":\"main\"}" >/dev/null
  echo "Created website project $PAGES"
fi
WEB_HOST=$(cf GET "/pages/projects/$PAGES" | jq -r '.result.subdomain')
# Use your own domain instead when you have one (set WEB_DOMAIN as a GitHub variable).
WEB_URL="https://${WEB_DOMAIN:-$WEB_HOST}"
echo "Server:  $API_URL"
echo "Website: $WEB_URL"

echo "== 3. Server"
cd "$ROOT/api"
npm ci
npx wrangler d1 migrations apply "$DB_NAME" --remote
npx wrangler deploy --var "ALLOWED_ORIGIN:$WEB_URL"
printf '%s' "$SETUP_TOKEN" | npx wrangler secret put SETUP_TOKEN

echo "== 4. Website"
cd "$ROOT/app"
npm ci
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_WEB_URL="$WEB_URL" npx expo export --platform web
"$ROOT/api/node_modules/.bin/wrangler" pages deploy dist --project-name "$PAGES" --branch main --commit-dirty=true

echo
echo "Done. Website: $WEB_URL   (first time only: open $WEB_URL/start to create the first person)"
