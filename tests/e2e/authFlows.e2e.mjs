/**
 * Browser checks for login, recovery and Dashboard-invite account setup.
 * Runs the real app in headless Chrome; Supabase Auth/REST calls are answered by in-memory mocks
 * (nothing reaches the real project).
 *
 *   npm run test:e2e            # CHROME_PATH=/path/to/chrome to override the browser
 *   SCREENSHOTS=/some/dir npm run test:e2e
 */

import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUPABASE = "https://jmorifdjtmmmobilhaxm.supabase.co";
const SHOTS = process.env.SCREENSHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, "index.html");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const BASE = `http://localhost:${/** @type {any} */ (server.address()).port}/`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
const jwt = (sub, method) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: now() + 3600, iat: now(), amr: [{ method, timestamp: now() }] })}.sig`;

const EXISTING = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  role: "authenticated",
  email: "existing@example.test",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  invited_at: null,
  user_metadata: { first_name: "Eve", last_name: "Existing", full_name: "Eve Existing", username: "eve" },
  app_metadata: { provider: "email", providers: ["email"] },
};
const INVITED = {
  id: "22222222-2222-4222-8222-222222222222",
  aud: "authenticated",
  role: "authenticated",
  email: "new.angler@example.test",
  email_confirmed_at: "2026-10-09T08:00:00Z",
  invited_at: "2026-10-09T07:59:00Z",
  user_metadata: { sub: "22222222-2222-4222-8222-222222222222", email: "new.angler@example.test", email_verified: true },
  app_metadata: { provider: "email", providers: ["email"] },
};
const SEED_PROFILES = [
  { id: EXISTING.id, username: "eve", display_name: "Eve Existing", avatar_url: null },
  { id: "33333333-3333-4333-8333-333333333333", username: "taken_name", display_name: "Someone Else", avatar_url: null },
];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** PostgREST-style filter subset: eq / in / ilike. */
function matches(row, params) {
  for (const [key, raw] of params) {
    if (["select", "limit", "order", "on_conflict", "offset"].includes(key)) continue;
    const [op, ...rest] = raw.split(".");
    const val = rest.join(".");
    const cell = row[key] == null ? "" : String(row[key]);
    if (op === "eq" && cell !== val) return false;
    if (op === "in" && !val.replace(/^\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, "")).includes(cell)) return false;
    if (op === "ilike" && !new RegExp(`^${val.replace(/%/g, ".*")}$`, "i").test(cell)) return false;
  }
  return true;
}

async function newScenario(browser, startUser) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const state = {
    user: structuredClone(startUser),
    profiles: structuredClone(SEED_PROFILES),
    userPuts: [],
    profileWrites: [],
    events: [],
    failProfileWrites: 0,
    raceUsername: null,
  };
  await ctx.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/auth/v1/user" && req.method() === "GET") return json(200, state.user);
    if (p === "/auth/v1/user" && req.method() === "PUT") {
      const body = req.postDataJSON();
      state.userPuts.push(body);
      if (body.data) state.user.user_metadata = { ...state.user.user_metadata, ...body.data };
      return json(200, state.user);
    }
    if (p === "/auth/v1/token") {
      return json(200, { access_token: jwt(state.user.id, "password"), refresh_token: "r-" + Date.now(), expires_in: 3600, expires_at: now() + 3600, token_type: "bearer", user: state.user });
    }
    if (p === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });
    if (p === "/rest/v1/profiles") {
      if (req.method() === "GET") return json(200, state.profiles.filter((r) => matches(r, url.searchParams)));
      if (req.method() === "POST") {
        const body = req.postDataJSON();
        const rows = Array.isArray(body) ? body : [body];
        state.profileWrites.push(...rows);
        if (state.failProfileWrites > 0) {
          state.failProfileWrites--;
          return json(500, { code: "XX000", message: "simulated profile failure", details: null, hint: null });
        }
        if (state.raceUsername) {
          state.profiles.push({ id: "44444444-4444-4444-8444-444444444444", username: state.raceUsername, display_name: "Racer", avatar_url: null });
          state.raceUsername = null;
        }
        for (const row of rows) {
          if (state.profiles.some((r) => r.username === row.username && r.id !== row.id)) {
            return json(409, { code: "23505", message: 'duplicate key value violates unique constraint "profiles_username_unique"', details: null, hint: null });
          }
        }
        for (const row of rows) {
          const i = state.profiles.findIndex((r) => r.id === row.id);
          if (i >= 0) state.profiles[i] = { ...state.profiles[i], ...row };
          else state.profiles.push({ avatar_url: null, ...row });
        }
        return json(201, []);
      }
    }
    if (p.startsWith("/rest/v1/rpc/")) return json(200, null);
    if (p.startsWith("/rest/v1/")) return json(200, []);
    return json(200, {});
  });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[Auth] state change:")) state.events.push(t.split(" ")[3]);
  });
  return { ctx, page, state };
}

async function ui(page) {
  return page.evaluate(() => {
    const shown = (el) => Boolean(el && el.offsetParent !== null);
    const vis = (id) => shown(document.getElementById(id));
    const val = (id) => /** @type {HTMLInputElement | null} */ (document.getElementById(id))?.value ?? null;
    return {
      appVisible: vis("app"),
      gateVisible: vis("auth-gate"),
      loginPanel: vis("auth-login"),
      setupPanel: vis("auth-reset-password"),
      title: document.getElementById("auth-reset-title")?.textContent,
      text: document.getElementById("auth-reset-text")?.textContent,
      button: document.getElementById("auth-reset-submit")?.textContent,
      passLabel: document.getElementById("auth-reset-pass-label")?.textContent,
      inviteFieldsVisible: [...document.querySelectorAll(".auth-invite-field")].map(shown),
      passwordFieldsVisible: [...document.querySelectorAll(".auth-password-field")].map(shown),
      first: val("auth-invite-first"),
      last: val("auth-invite-last"),
      username: val("auth-invite-username"),
      message: document.getElementById("auth-message")?.textContent || "",
      gateButtons: [...document.querySelectorAll("#auth-gate button")].filter(shown).map((b) => b.textContent.trim()),
      signupPanelExists: Boolean(document.getElementById("auth-signup")),
    };
  });
}

const sleep = (page, ms) => page.waitForTimeout(ms);
async function until(page, pred, timeout = 25000) {
  const end = Date.now() + timeout;
  let u = await ui(page);
  while (!pred(u) && Date.now() < end) {
    await sleep(page, 250);
    u = await ui(page);
  }
  return u;
}
const allTrue = (a) => a.length > 0 && a.every(Boolean);
const allFalse = (a) => a.length > 0 && a.every((x) => !x);
const callbackHash = (user, type) =>
  `#access_token=${jwt(user.id, "otp")}&expires_at=${now() + 3600}&expires_in=3600&refresh_token=cb-${type}&token_type=bearer&type=${type}`;

async function fillInvite(page, { first, last, username, password, confirm }) {
  if (first !== undefined) await page.fill("#auth-invite-first", first);
  if (last !== undefined) await page.fill("#auth-invite-last", last);
  if (username !== undefined) await page.fill("#auth-invite-username", username);
  if (password !== undefined && (await page.isVisible("#auth-reset-pass"))) await page.fill("#auth-reset-pass", password);
  if (confirm !== undefined && (await page.isVisible("#auth-reset-pass2"))) await page.fill("#auth-reset-pass2", confirm);
}
const submit = (page) => page.click("#auth-reset-submit");
async function emitSignedInAgain(page) {
  await page.evaluate(async () => {
    const { supabase } = await import("/js/supabase.js");
    const { data } = await supabase.auth.getSession();
    await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  });
}
async function login(page, email, password) {
  await page.fill("#auth-login-email", email);
  await page.fill("#auth-login-password", password);
  await page.click("#auth-login-submit");
}
const logout = (page) => page.evaluate(() => document.getElementById("menu-logout")?.click());
const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, name) }) : null);

const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH || fs.existsSync("/usr/local/bin/google-chrome")
    ? { executablePath: process.env.CHROME_PATH || "/usr/local/bin/google-chrome" }
    : { channel: "chrome" }),
});

try {
  // Auth gate
  {
    const { ctx, page } = await newScenario(browser, EXISTING);
    await page.goto(BASE);
    const u = await until(page, (x) => x.loginPanel);
    check("Gate: no signup panel", !u.signupPanelExists);
    check("Gate: only Log in + Forgot password", JSON.stringify(u.gateButtons) === '["Log in","Forgot password?"]', u.gateButtons.join(", "));
    await ctx.close();
  }

  // Existing user
  {
    const { ctx, page, state } = await newScenario(browser, EXISTING);
    await page.goto(BASE);
    await until(page, (x) => x.loginPanel);
    await login(page, EXISTING.email, "pw");
    let u = await until(page, (x) => x.appVisible);
    check("Existing: login activates app", u.appVisible);
    await page.reload();
    u = await until(page, (x) => x.appVisible);
    check("Existing: reload restores session", u.appVisible && !u.setupPanel);
    await logout(page);
    u = await until(page, (x) => x.loginPanel && !x.appVisible);
    check("Existing: logout", u.loginPanel && !u.appVisible);
    await login(page, EXISTING.email, "pw");
    u = await until(page, (x) => x.appVisible, 40000);
    check("Existing: login again", u.appVisible);
    const eve = state.profiles.find((r) => r.id === EXISTING.id);
    check("Existing: no Auth metadata writes, profile unchanged", state.userPuts.length === 0 && eve.username === "eve" && eve.display_name === "Eve Existing", JSON.stringify(eve));
    await ctx.close();
  }

  // Recovery (existing user)
  {
    const { ctx, page, state } = await newScenario(browser, EXISTING);
    await page.goto(BASE + callbackHash(EXISTING, "recovery"));
    let u = await until(page, (x) => x.setupPanel);
    check("Recovery: recovery wording", u.title === "New password" && u.button === "Save password" && u.passLabel === "New password", `${u.title} / ${u.passLabel} / ${u.button}`);
    check("Recovery: profile fields hidden, password fields shown", allFalse(u.inviteFieldsVisible) && allTrue(u.passwordFieldsVisible));
    check("Recovery: app not active", !u.appVisible, state.events.join(","));
    await emitSignedInAgain(page);
    await sleep(page, 1500);
    u = await ui(page);
    check("Recovery: extra SIGNED_IN keeps recovery panel", u.setupPanel && !u.appVisible && u.title === "New password");
    await shot(page, "recovery.png");
    await page.fill("#auth-reset-pass", "newpass1");
    await page.fill("#auth-reset-pass2", "newpass1");
    await submit(page);
    u = await until(page, (x) => x.appVisible);
    check("Recovery: app activates after saving", u.appVisible);
    check("Recovery: only password sent (metadata untouched)", state.userPuts.length === 1 && !state.userPuts[0].data && state.user.user_metadata.full_name === "Eve Existing", JSON.stringify(state.userPuts));
    await ctx.close();
  }

  // Invite: validation, taken username, success, reload, re-login
  {
    const { ctx, page, state } = await newScenario(browser, INVITED);
    await page.goto(BASE + callbackHash(INVITED, "invite"));
    let u = await until(page, (x) => x.setupPanel);
    check("Invite: setup wording", u.title === "Set up your account" && u.text === "Create your profile and password to finish setting up your account." && u.button === "Finish setup" && u.passLabel === "Password", `${u.title} / ${u.text} / ${u.passLabel} / ${u.button}`);
    check("Invite: profile + password fields shown", allTrue(u.inviteFieldsVisible) && allTrue(u.passwordFieldsVisible));
    check("Invite: SIGNED_IN fired, app not active", state.events.includes("SIGNED_IN") && !u.appVisible, state.events.join(","));
    await shot(page, "invite-setup.png");

    await emitSignedInAgain(page);
    await sleep(page, 1500);
    u = await ui(page);
    check("Invite: extra SIGNED_IN keeps setup", u.setupPanel && !u.appVisible);

    await page.reload();
    u = await until(page, (x) => x.setupPanel);
    await sleep(page, 1000);
    u = await ui(page);
    check("Invite: reload before setup keeps setup screen", u.setupPanel && !u.appVisible && u.title === "Set up your account");

    const cases = [
      [{ first: "   ", last: "S", username: "elmer", password: "secret1", confirm: "secret1" }, "Enter your first name."],
      [{ first: "Elmer", last: "  ", username: "elmer", password: "secret1", confirm: "secret1" }, "Enter your last name."],
      [{ first: "Elmer", last: "S", username: "  ", password: "secret1", confirm: "secret1" }, "Enter a username."],
      [{ first: "Elmer", last: "S", username: "bad name", password: "secret1", confirm: "secret1" }, "Username can only use letters"],
      [{ first: "Elmer", last: "S", username: "elmer", password: "abc", confirm: "abc" }, "Password must be at least 6 characters."],
      [{ first: "Elmer", last: "S", username: "elmer", password: "secret1", confirm: "secret2" }, "Passwords do not match."],
    ];
    for (const [input, expected] of cases) {
      await fillInvite(page, input);
      await submit(page);
      await sleep(page, 300);
      u = await ui(page);
      check(`Invite validation: ${expected}`, u.message.startsWith(expected) && u.setupPanel && !u.appVisible, u.message);
    }
    check("Invite validation: nothing saved", state.userPuts.length === 0 && state.profileWrites.length === 0);

    await fillInvite(page, { first: "Elmer", last: "Salovaara", username: "taken_name", password: "secret1", confirm: "secret1" });
    await submit(page);
    u = await until(page, (x) => x.message.includes("taken"), 5000);
    check("Invite: taken username rejected before Auth update", u.message === "That username is already taken. Choose another one." && state.userPuts.length === 0 && u.setupPanel && !u.appVisible && u.first === "Elmer", u.message);
    await shot(page, "invite-username-taken.png");

    await fillInvite(page, { first: "  Elmer ", last: " Salovaara  ", username: " Elmer_S ", password: "angler-pass-1", confirm: "angler-pass-1" });
    await submit(page);
    u = await until(page, (x) => x.appVisible);
    const put = state.userPuts[0] || {};
    check("Invite: one Auth update with password + metadata", state.userPuts.length === 1 && put.password === "angler-pass-1" && JSON.stringify(put.data) === JSON.stringify({ first_name: "Elmer", last_name: "Salovaara", full_name: "Elmer Salovaara", username: "elmer_s", invite_password_set: true }), JSON.stringify(put));
    let prof = state.profiles.find((r) => r.id === INVITED.id);
    check("Invite: profile has entered username + full name", prof?.username === "elmer_s" && prof?.display_name === "Elmer Salovaara", JSON.stringify(prof));
    check("Invite: app active after setup", u.appVisible);
    await shot(page, "invite-app-active.png");

    await page.reload();
    u = await until(page, (x) => x.appVisible);
    check("Invite: reload after setup goes to app", u.appVisible && !u.setupPanel);
    await logout(page);
    await until(page, (x) => x.loginPanel);
    await login(page, INVITED.email, "angler-pass-1");
    u = await until(page, (x) => x.appVisible, 40000);
    prof = state.profiles.find((r) => r.id === INVITED.id);
    check("Invite: logout + login works, profile still consistent", u.appVisible && prof?.username === "elmer_s" && prof?.display_name === "Elmer Salovaara", JSON.stringify(prof));
    check("Invite: no auto-generated username ever written", state.profileWrites.every((r) => r.username === "elmer_s"), JSON.stringify(state.profileWrites.map((r) => r.username)));
    await ctx.close();
  }

  // Invite: unique-constraint race after Auth update
  {
    const { ctx, page, state } = await newScenario(browser, INVITED);
    await page.goto(BASE + callbackHash(INVITED, "invite"));
    await until(page, (x) => x.setupPanel);
    state.raceUsername = "elmer";
    await fillInvite(page, { first: "Elmer", last: "Salovaara", username: "elmer", password: "angler-pass-1", confirm: "angler-pass-1" });
    await submit(page);
    let u = await until(page, (x) => x.message.includes("taken"), 8000);
    check("Race: username-taken error, still in setup", u.message === "That username is already taken. Choose another one." && u.setupPanel && !u.appVisible, u.message);
    check("Race: password fields hidden (password saved), names kept", allFalse(u.passwordFieldsVisible) && allTrue(u.inviteFieldsVisible) && u.first === "Elmer" && u.last === "Salovaara");
    check("Race: no profile created, no rename", !state.profiles.some((r) => r.id === INVITED.id) && state.profileWrites.every((r) => r.username === "elmer"));
    await shot(page, "invite-race-profile-step.png");
    await fillInvite(page, { username: "elmer_2" });
    await submit(page);
    u = await until(page, (x) => x.appVisible);
    const prof = state.profiles.find((r) => r.id === INVITED.id);
    check("Race: retry with new username activates app", u.appVisible && prof?.username === "elmer_2" && prof?.display_name === "Elmer Salovaara", JSON.stringify(prof));
    check("Race: retry did not resend password", state.userPuts.length === 2 && !("password" in state.userPuts[1]) && state.userPuts[1].data.username === "elmer_2", JSON.stringify(state.userPuts));
    await ctx.close();
  }

  // Invite: profile write fails after Auth update, then reload and retry
  {
    const { ctx, page, state } = await newScenario(browser, INVITED);
    await page.goto(BASE + callbackHash(INVITED, "invite"));
    await until(page, (x) => x.setupPanel);
    state.failProfileWrites = 1;
    await fillInvite(page, { first: "Pia", last: "Partial", username: "pia_p", password: "angler-pass-1", confirm: "angler-pass-1" });
    await submit(page);
    let u = await until(page, (x) => x.message.includes("password is saved"), 8000);
    check("Partial: clear error, still in setup, app not active", u.message.includes("password is saved") && u.setupPanel && !u.appVisible, u.message);
    check("Partial: Auth flag saved, no profile row", state.user.user_metadata.invite_password_set === true && !state.profiles.some((r) => r.id === INVITED.id));
    await page.reload();
    u = await until(page, (x) => x.setupPanel);
    await sleep(page, 1500);
    u = await ui(page);
    check("Partial: reload returns to profile completion (not the app)", u.setupPanel && !u.appVisible && u.text === "Create your profile to finish setting up your account." && allFalse(u.passwordFieldsVisible), u.text);
    check("Partial: fields prefilled from saved metadata", u.first === "Pia" && u.last === "Partial" && u.username === "pia_p", `${u.first} ${u.last} ${u.username}`);
    await shot(page, "invite-partial-reload.png");
    await submit(page);
    u = await until(page, (x) => x.appVisible);
    const prof = state.profiles.find((r) => r.id === INVITED.id);
    check("Partial: retry creates profile and activates app", u.appVisible && prof?.username === "pia_p" && prof?.display_name === "Pia Partial", JSON.stringify(prof));
    check("Partial: password sent only once", state.userPuts.filter((b) => "password" in b).length === 1);
    await ctx.close();
  }

  // Invited user uses a recovery link before finishing setup
  {
    const { ctx, page, state } = await newScenario(browser, INVITED);
    await page.goto(BASE + callbackHash(INVITED, "recovery"));
    let u = await until(page, (x) => x.setupPanel);
    check("Invited+recovery: recovery screen first, no profile fields", u.title === "New password" && allFalse(u.inviteFieldsVisible));
    await page.fill("#auth-reset-pass", "angler-pass-9");
    await page.fill("#auth-reset-pass2", "angler-pass-9");
    await submit(page);
    u = await until(page, (x) => x.title === "Set up your account", 8000);
    check("Invited+recovery: then profile completion, app not active", u.setupPanel && !u.appVisible && allFalse(u.passwordFieldsVisible), u.title);
    await fillInvite(page, { first: "Rita", last: "Recover", username: "rita" });
    await submit(page);
    u = await until(page, (x) => x.appVisible);
    const prof = state.profiles.find((r) => r.id === INVITED.id);
    check("Invited+recovery: profile saved, app active", u.appVisible && prof?.username === "rita" && prof?.display_name === "Rita Recover", JSON.stringify(prof));
    await ctx.close();
  }

  // Expired link
  {
    const { ctx, page } = await newScenario(browser, EXISTING);
    await page.goto(BASE + "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    const u = await until(page, (x) => x.loginPanel && x.message.length > 0, 8000);
    check("Expired link: neutral message", u.message.startsWith("This link has expired."), u.message);
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
