import { Hono } from "hono";
import { cors } from "hono/cors";
import * as rules from "./rules";
import { HttpError, timingSafeEqual } from "./util";

export interface Env {
  DB: D1Database;
  /** Secret used once to create the first person. Set with `wrangler secret put SETUP_TOKEN`. */
  SETUP_TOKEN?: string;
  /** Website address allowed to call the API from a browser, e.g. https://onefamily.pages.dev */
  ALLOWED_ORIGIN?: string;
}

type Vars = { ctx: rules.Ctx; me: string };

export function createApp(makeCtx?: (env: Env) => rules.Ctx) {
  const app = new Hono<{ Bindings: Env; Variables: Vars }>();

  app.use("*", async (c, next) => {
    const origin = c.env.ALLOWED_ORIGIN || "*";
    return cors({ origin, allowHeaders: ["Content-Type", "Authorization"], allowMethods: ["GET", "POST", "PATCH", "OPTIONS"] })(c, next);
  });

  app.use("*", async (c, next) => {
    c.set("ctx", makeCtx ? makeCtx(c.env) : { db: c.env.DB, now: () => new Date(), random: Math.random });
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: "server_error", message: "Something went wrong." }, 500);
  });

  const bearer = (c: { req: { header: (n: string) => string | undefined } }) =>
    c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? null;

  const body = async (c: { req: { json: () => Promise<unknown> } }) => {
    try {
      return ((await c.req.json()) ?? {}) as Record<string, any>;
    } catch {
      throw new HttpError(400, "bad_input", "Send JSON.");
    }
  };

  app.get("/", (c) => c.json({ name: "One Family API", ok: true }));

  // ----- public -----

  app.post("/setup", async (c) => {
    const b = await body(c);
    const secret = c.env.SETUP_TOKEN;
    if (!secret || typeof b.setup_token !== "string" || !timingSafeEqual(b.setup_token, secret)) {
      throw new HttpError(403, "forbidden", "Wrong setup token.");
    }
    const result = await rules.createStarter(c.get("ctx"), b.person, b.login, b.password);
    return c.json(result, 201);
  });

  app.post("/login", async (c) => {
    const b = await body(c);
    return c.json(await rules.login(c.get("ctx"), b.login, b.password));
  });

  app.get("/invites/:token", async (c) => c.json(await rules.getInvite(c.get("ctx"), c.req.param("token"))));

  app.post("/invites/:token/accept", async (c) => {
    const b = await body(c);
    return c.json(await rules.acceptInvite(c.get("ctx"), c.req.param("token"), b.login, b.password), 201);
  });

  // ----- signed in -----

  const authed = new Hono<{ Bindings: Env; Variables: Vars }>();
  authed.use("*", async (c, next) => {
    c.set("me", await rules.personForSession(c.get("ctx"), bearer(c)));
    await next();
  });

  authed.post("/logout", async (c) => {
    await rules.logout(c.get("ctx"), bearer(c)!);
    return c.json({ ok: true });
  });

  authed.get("/me", async (c) => {
    const ctx = c.get("ctx");
    const me = c.get("me");
    return c.json({
      person: await rules.getPerson(ctx, me),
      pending: await rules.pendingForMe(ctx, me),
      votes: await rules.votesForMe(ctx, me),
    });
  });

  authed.get("/tree", async (c) => {
    const me = c.get("me");
    return c.json(await rules.getTree(c.get("ctx"), me, c.req.query("root") || me, Number(c.req.query("depth") || 3)));
  });

  authed.get("/search", async (c) => c.json(await rules.searchPeople(c.get("ctx"), c.get("me"), c.req.query("q") ?? "")));

  authed.get("/people/:id", async (c) => c.json(await rules.getTree(c.get("ctx"), c.get("me"), c.req.param("id"), 1)));

  authed.patch("/people/:id", async (c) =>
    c.json(await rules.updatePerson(c.get("ctx"), c.get("me"), c.req.param("id"), await body(c))),
  );

  authed.post("/relatives", async (c) => c.json(await rules.addRelative(c.get("ctx"), c.get("me"), (await body(c)) as rules.AddRelativeInput), 201));

  authed.post("/relations/:id/decision", async (c) => {
    const b = await body(c);
    return c.json(await rules.decideRelation(c.get("ctx"), c.get("me"), c.req.param("id"), b.approve === true));
  });

  authed.post("/relations/:id/divorced", async (c) => {
    const b = await body(c);
    return c.json(await rules.setDivorced(c.get("ctx"), c.get("me"), c.req.param("id"), b.divorced !== false));
  });

  authed.post("/people/:id/invites", async (c) => {
    const b = await body(c);
    const token = await rules.createInvite(c.get("ctx"), c.get("me"), c.req.param("id"), b.contact);
    return c.json({ token }, 201);
  });

  authed.post("/relations/:id/removal-votes", async (c) =>
    c.json(await rules.startRemovalVote(c.get("ctx"), c.get("me"), c.req.param("id")), 201),
  );

  authed.get("/votes/:id", async (c) => c.json(await rules.getVote(c.get("ctx"), c.req.param("id"))));

  authed.post("/votes/:id/ballot", async (c) => {
    const b = await body(c);
    return c.json(await rules.castBallot(c.get("ctx"), c.get("me"), c.req.param("id"), b.choice));
  });

  app.route("/", authed);
  return app;
}

export default createApp();
