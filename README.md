# One Family

One family tree for everyone on earth. Every name is a light. Every line is a bond.

This repository has two parts:

| Folder | What it is | Runs on |
|---|---|---|
| `api/` | The server: people, relations, invites, approvals and removal votes | Cloudflare Workers + D1 (free plan to start) |
| `app/` | The app: one codebase for iPhone, Android **and** the website | Expo (React Native) |

## The rules (as agreed)

1. **One single global tree.** Nobody can sign up directly. A member adds a relative and shares an invite link; the relative joins through it, then adds their own family.
2. **Parents and children** are linked straight away, without approval. This also covers relatives who passed away and babies.
3. **Siblings and spouses** must be approved by the other person. Sibling links that appear when a new child joins parents who already have children also need approval.
4. **Removing a wrong link:** 4 relatives are picked at random, closest first (then further out). 3 must agree. The two people in the link can never vote. A voter who has not answered in 7 days is replaced by another random relative. A vote removes only that one link.
5. **Passed away** relatives are shown as soft "lantern" cards; **divorced** couples are marked as divorced while their children stay linked to both parents.
6. **Privacy:** a living person's details (birth year, places, story) are shown only to close relatives (2 steps away) or whoever looks after a profile that has no account. Search only finds people connected to you.
7. **No photos** in this first version, to stay on the free plan.

## Try it on your computer

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
# 1. The server
cd api
npm install
echo 'SETUP_TOKEN="choose-a-long-secret"' > .dev.vars
npm run db:migrate:local
npm run dev            # runs on http://localhost:8787

# 2. Create the first person (you), once
curl -X POST http://localhost:8787/setup -H 'content-type: application/json' \
  -d '{"setup_token":"choose-a-long-secret","person":{"full_name":"Your Name"},"login":"you@example.com","password":"a-good-password"}'

# 3. The app (in another terminal)
cd app
npm install
npm run web            # opens the website on http://localhost:8081
npm start              # or scan the QR code with the Expo Go app on your phone
```

Tests for every rule: `cd api && npm test`.

## Going live

### Server (free)
1. Create a free Cloudflare account, then in `api/`: `npx wrangler login`.
2. `npx wrangler d1 create onefamily` and paste the `database_id` it prints into `api/wrangler.toml`.
3. `npm run db:migrate:remote`
4. `npx wrangler secret put SETUP_TOKEN` (any long secret, used once to create the first person).
5. `npm run deploy`. Wrangler prints the server address, e.g. `https://onefamily-api.<you>.workers.dev`.
6. Create the first person with the `curl` command above, using the live address.

### Website (free)
In `app/`, build with the live addresses, then upload to Cloudflare Pages:

```bash
EXPO_PUBLIC_API_URL=https://onefamily-api.<you>.workers.dev \
EXPO_PUBLIC_WEB_URL=https://onefamily.pages.dev \
npm run build:web
npx wrangler pages deploy dist --project-name onefamily
```

Then set `ALLOWED_ORIGIN` in `api/wrangler.toml` to the website address and deploy the server again.

### Phone apps
The same `app/` code builds the iPhone and Android apps with Expo's build service (`npx eas-cli build`).
Publishing needs store accounts: Apple Developer Program (US$99 per year) and Google Play Console (US$25 once).

## Free plan limits (checked November 2026)
Cloudflare's free plan gives 5 GB of database storage, 100,000 database writes a day and 100,000 requests a day.
At about 1 KB per person that is roughly 2 to 5 million people. The paid plan starts at US$5 a month.
