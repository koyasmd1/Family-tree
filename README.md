# One Family

One family tree for everyone on earth. Every name is a light. Every line is a bond.

This repository has two parts:

| Folder | What it is | Runs on |
|---|---|---|
| `api/` | The server: people, relations, invites, approvals and removal votes | Cloudflare Workers + D1 (free plan to start) |
| `app/` | The app: one codebase for iPhone, Android **and** the website | Expo (React Native) |

## The rules (as agreed)

1. **One single global tree.** Anyone can sign up and use **Find me** to search for their own name. When they tap "This is me", the person who added that profile approves it, and then they are part of the tree. If that person has passed away or never joined, nearby relatives confirm instead (one close relative, or 2 of the 4 nearest further out). A newcomer can also connect to a relative ("This is my relative"), confirmed the same way. Relatives see part of the newcomer's phone number or email to recognise them. A newcomer can have 3 requests waiting and send 5 a day. Invite links remain the quickest way in.
2. **Anyone in the tree can add any relative** (parent, child, brother, sister, husband or wife) to anyone in the tree, and the link is made straight away, without approval. This also covers relatives who passed away and babies.
3. **Brothers and sisters** are linked automatically when a new child is added to parents who already have children. A wrong link can be removed by a vote of relatives (below).
4. **Removing a wrong link:** anyone in the tree who sees a wrong link can object. 4 relatives are picked at random, closest first (then further out). 3 must agree. The two people in the link can never vote. A voter who has not answered in 7 days is replaced by another random relative. A vote removes only that one link.
5. **Passed away** relatives are shown as soft "lantern" cards; **divorced** couples are marked as divorced while their children stay linked to both parents.
6. **Privacy:** a living person's details (birth year, places, story) are shown only to close relatives (2 steps away) or whoever looks after a profile that has no account. Search only finds people connected to you; a newcomer's search shows just names, birth years and parents' names.
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

To see all 25 animations together, open `/animations` in the app (for example http://localhost:8081/animations).
If a phone or computer is set to reduce motion, every animation shows a still picture instead.

## Going live

Every change merged into `main` is put online automatically by `.github/workflows/deploy.yml`
(it runs `scripts/deploy.sh`). It creates the database, server and website on Cloudflare's free plan the
first time, and updates them after that.

It needs three GitHub secrets (Settings › Secrets and variables › Actions):

| Secret | What it is |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A Cloudflare API token with Account permissions: Workers Scripts Edit, D1 Edit, Cloudflare Pages Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID (the long code in the dashboard address) |
| `SETUP_TOKEN` | Any long secret. You type it once on `/start` to create the first person |

The first time, open `<website>/start` and create the first person. After that the page stops working.

To use your own domain, add it to the `onefamily` Pages project in Cloudflare (Custom domains), then add a
GitHub **variable** `WEB_DOMAIN` (for example `onefamilytree.com`) and run the workflow again.

### Phone apps
The same `app/` code builds the iPhone and Android apps with Expo's build service (`npx eas-cli build`).
Publishing needs store accounts: Apple Developer Program (US$99 per year) and Google Play Console (US$25 once).

## Free plan limits (checked November 2026)
Cloudflare's free plan gives 5 GB of database storage, 100,000 database writes a day and 100,000 requests a day.
At about 1 KB per person that is roughly 2 to 5 million people. The paid plan starts at US$5 a month.
