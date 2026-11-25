// PLUgranja · API (Netlify Functions v2 + Netlify Blobs)
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api" };

/* ---------- constants ---------- */
const ROLES = ["admin", "enginyer", "vetlog", "vet", "granger"];
const MODS = ["destete", "escorxador", "gastos", "hidrolisi", "granges"];
const FLAGS = ["validar", "retornar", "exportar", "tancaExport", "gestHidro"];
const SCOPES = ["all", "own", "notown"];
const CATS = ["electricitat", "lampisteria", "recanvis", "gasoil", "pellet", "pinso", "veterinari", "neteja", "manteniment", "transport", "altres"];
const DEF_PERMS = {
  admin:    { destete: 2, escorxador: 2, gastos: 2, hidrolisi: 2, granges: 2, validar: true,  retornar: true,  exportar: true,  tancaExport: true,  gestHidro: true },
  enginyer: { destete: 1, escorxador: 1, gastos: 2, hidrolisi: 2, granges: 2, validar: false, retornar: false, exportar: true,  tancaExport: false, gestHidro: true },
  vetlog:   { destete: 2, escorxador: 2, gastos: 1, hidrolisi: 1, granges: 1, validar: true,  retornar: true,  exportar: true,  tancaExport: true,  gestHidro: false },
  vet:      { destete: 2, escorxador: 2, gastos: 0, hidrolisi: 1, granges: 1, validar: true,  retornar: false, exportar: true,  tancaExport: false, gestHidro: false },
  granger:  { destete: 2, escorxador: 2, gastos: 2, hidrolisi: 2, granges: 0, validar: false, retornar: false, exportar: false, tancaExport: false, gestHidro: false },
};

/* ---------- helpers ---------- */
class HttpErr extends Error { constructor(code, status = 400) { super(code); this.status = status; } }
const fail = (code, status) => { throw new HttpErr(code, status); };
const uid = () => Date.now().toString(36) + crypto.randomBytes(4).toString("hex");
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const SECRET = () => process.env.APP_SECRET || "plugranja-dev-secret-CANVIA-HO";
const b64u = (s) => Buffer.from(s).toString("base64url");
const hmac = (s) => crypto.createHmac("sha256", SECRET()).update(s).digest("base64url");
const hashPin = (pin, salt) => crypto.createHash("sha256").update(salt + ":" + pin).digest("hex");
const num = (v) => { if (v === "" || v === null || v === undefined) return null; const n = Number(v); if (!isFinite(n) || n < 0) fail("bad_number"); return n; };
const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);

function signTok(o) { const p = b64u(JSON.stringify(o)); return p + "." + hmac(p); }
function readTok(t) {
  if (!t || !t.includes(".")) return null;
  const [p, s] = t.split(".");
  const a = Buffer.from(hmac(p)), b = Buffer.from(s);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const o = JSON.parse(Buffer.from(p, "base64url").toString());
  return o.exp > Date.now() ? o : null;
}

function weeksInYear(y) { const d = new Date(Date.UTC(y, 11, 28)); return isoWeek(d).w; }
function isoWeek(d) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y = x.getUTCFullYear(); return { y, w: Math.ceil(((x - new Date(Date.UTC(y, 0, 1))) / 864e5 + 1) / 7) }; }
const nextWeek = (y, w) => (w >= weeksInYear(y) ? { y: y + 1, w: 1 } : { y, w: w + 1 });

/* ---------- storage ---------- */
const st = () => globalThis.__PLUG_STORE || getStore({ name: "plugranja", consistency: "strong" });
const DEFAULTS = { users: [], farms: [], perms: DEF_PERMS, destete: [], escorxador: [], gastos: [], hidrolisi: [], locks: {}, settings: { scope: {} } };
async function read(k) { const r = await st().getWithMetadata(k, { type: "json" }); return r && r.data != null ? r : { data: structuredClone(DEFAULTS[k]), etag: null }; }
async function get(k) { return (await read(k)).data; }
async function update(k, fn) {
  for (let i = 0; i < 6; i++) {
    const { data, etag } = await read(k);
    const out = await fn(data);
    const w = await st().setJSON(k, data, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!w || w.modified !== false) return out;
    await new Promise((r) => setTimeout(r, 60 * (i + 1)));
  }
  fail("conflict", 409);
}

/* ---------- permissions ---------- */
function permsFor(perms, role) {
  if (role === "admin") return structuredClone(DEF_PERMS.admin);
  return { ...DEF_PERMS[role], ...(perms[role] || {}) };
}
const farmScope = (u, farms) => (u.farms && u.farms.length ? farms.filter((f) => u.farms.includes(f.id)) : u.role === "granger" ? [] : farms);
const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, role: u.role, farms: u.farms || [] });

async function ensureAdmin() {
  const users = await get("users");
  if (users.length) return;
  await update("users", (us) => {
    if (us.length) return;
    const salt = crypto.randomBytes(8).toString("hex");
    us.push({ id: "u_admin", login: "admin", name: "Administrador", role: "admin", farms: [], salt, pin: hashPin("1234", salt) });
  });
}

/* ---------- Anthropic ---------- */
async function analyzeAlbara(b64) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) fail("no_ai_key", 500);
  const prompt = `Ets un assistent que llegeix albarans i factures d'una empresa ramadera porcina a Catalunya/Espanya.
Llegeix el document de la imatge i retorna NOMÉS un objecte JSON (sense cap text més) amb aquestes claus:
{"empresa": nom del proveïdor que emet l'albarà,
 "albara": número d'albarà o factura (string),
 "data": data del document en format YYYY-MM-DD o null,
 "import": import TOTAL del document (número amb punt decimal, IVA inclòs si apareix; null si no n'hi ha),
 "categoria": una d'aquestes: ${CATS.join(", ")},
 "concepte": resum molt breu del que s'ha subministrat o fet (màx 12 paraules, en català)}
Guia categories: hores o treballs d'electricista → electricitat; fontaneria/aigua → lampisteria; peces o recanvis → recanvis; gasoil/gasoli/combustible → gasoil; pellet/biomassa → pellet; pinso/alimentació animal → pinso; medicaments/vacunes/serveis veterinaris → veterinari; desinfectants/neteja → neteja; reparacions generals/obres → manteniment; transport de mercaderies o animals → transport; si no és clar → altres.
Si un camp no es pot llegir, posa null.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5",
      max_tokens: 500,
      messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } }, { type: "text", text: prompt }] }],
    }),
  });
  if (!r.ok) fail("ai_error_" + r.status, 502);
  const d = await r.json();
  const txt = (d.content || []).map((c) => c.text || "").join("");
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) fail("ai_parse", 502);
  const o = JSON.parse(m[0]);
  return {
    empresa: str(o.empresa), albara: str(o.albara, 60), data: /^\d{4}-\d{2}-\d{2}$/.test(o.data || "") ? o.data : "",
    import: typeof o.import === "number" ? o.import : o.import ? Number(String(o.import).replace(/\./g, "").replace(",", ".")) || null : null,
    categoria: CATS.includes(o.categoria) ? o.categoria : "altres", concepte: str(o.concepte, 120),
  };
}

/* ---------- handler ---------- */
export default async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    await ensureAdmin();

    /* login (no auth) */
    if (action === "login") {
      const login = str(body.login).toLowerCase(), pin = str(body.pin, 20);
      const users = await get("users");
      const u = users.find((x) => x.login === login);
      const locks = await get("locks");
      const lk = locks[login];
      if (lk && lk.until > Date.now()) fail("locked_out", 429);
      if (!u || u.pin !== hashPin(pin, u.salt)) {
        await update("locks", (L) => { const now = Date.now(); const c = L[login] && L[login].t > now - 15 * 6e4 ? L[login] : { n: 0, t: now }; c.n++; c.until = c.n >= 5 ? Date.now() + 10 * 6e4 : 0; L[login] = c; });
        fail("bad_login", 401);
      }
      if (lk) await update("locks", (L) => { delete L[login]; });
      return json({ token: signTok({ uid: u.id, exp: Date.now() + 30 * 864e5 }) });
    }

    /* auth */
    const tk = readTok((req.headers.get("authorization") || "").replace(/^Bearer /, ""));
    if (!tk) fail("auth", 401);
    const users = await get("users");
    const me = users.find((u) => u.id === tk.uid);
    if (!me) fail("auth", 401);
    const allPerms = await get("perms");
    const P = permsFor(allPerms, me.role);
    const farmsAll = await get("farms");
    const myFarms = farmScope(me, farmsAll);
    const myFarmIds = new Set(myFarms.map((f) => f.id));
    const need = (mod, lvl) => { if ((P[mod] || 0) < lvl) fail("forbidden", 403); };
    const needFlag = (f) => { if (!P[f]) fail("forbidden", 403); };
    const settings = await get("settings"); const scope = settings.scope || {};
    const farmOk = (mod, id) => { if (!myFarmIds.has(id)) return false; const s = scope[mod] || "all"; if (s === "all") return true; const f = farmsAll.find((x) => x.id === id); return s === "own" ? !!(f && f.own) : !(f && f.own); };
    const needFarm = (id, mod) => { if (!farmOk(mod, id)) fail("forbidden_farm", 403); };
    const isAdmin = me.role === "admin";
    const stamp = () => ({ by: me.id, byName: me.name, at: Date.now() });

    switch (action) {
      /* ---- session ---- */
      case "boot": {
        const out = { me: publicUser(me), perms: P, farms: myFarms, scope, cats: CATS, names: Object.fromEntries(users.map((u) => [u.id, u.name])) };
        if (isAdmin) { out.users = users.map(publicUser); out.allPerms = Object.fromEntries(ROLES.map((r) => [r, permsFor(allPerms, r)])); out.allFarms = farmsAll; }
        if ((P.granges || 0) >= 1) out.allFarms = farmsAll;
        return json(out);
      }
      case "list": {
        const col = body.col;
        if (!["destete", "escorxador", "gastos", "hidrolisi"].includes(col)) fail("bad_col");
        need(col, 1);
        let rows = (await get(col)).filter((r) => farmOk(col, r.farm));
        if (col === "gastos") rows = rows.map(({ ...r }) => r);
        return json({ rows });
      }

      /* ---- DESLLETAMENT ---- */
      case "destete.save": {
        need("destete", 2);
        const r = body.rec || {};
        needFarm(r.farm, "destete");
        const v = { farm: r.farm, year: +r.year, week: +r.week, dest: num(r.dest), baix: num(r.baix), carr: num(r.carr) };
        if (!v.year || !(v.week >= 1 && v.week <= 53) || [v.dest, v.baix, v.carr].some((x) => x === null)) fail("fill");
        const res = await update("destete", (rows) => {
          const ex = r.id ? rows.find((x) => x.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex && ex.locked) fail("locked");
          if (ex && !farmOk("destete", ex.farm)) fail("forbidden_farm", 403);
          const dup = rows.find((x) => x.farm === v.farm && x.year === v.year && x.week === v.week && x.id !== r.id);
          if (dup) fail(dup.locked ? "locked_dup" : "dup");
          if (ex) { Object.assign(ex, v, { upd: stamp() }); return ex; }
          const n = { id: uid(), ...v, locked: false, created: stamp() }; rows.push(n); return n;
        });
        return json({ rec: res });
      }
      case "destete.lock": {
        need("destete", 1); needFlag("validar");
        const res = await update("destete", (rows) => {
          const ex = rows.find((x) => x.id === body.id); if (!ex) fail("not_found", 404); needFarm(ex.farm, "destete");
          ex.locked = !!body.locked; ex.lock = ex.locked ? stamp() : null; if (!ex.locked) ex.unlock = stamp(); return ex;
        });
        return json({ rec: res });
      }
      case "destete.delete": {
        need("destete", 2);
        await update("destete", (rows) => { const i = rows.findIndex((x) => x.id === body.id); if (i < 0) fail("not_found", 404); if (rows[i].locked) fail("locked"); needFarm(rows[i].farm, "destete"); rows.splice(i, 1); });
        return json({ ok: true });
      }

      /* ---- ESCORXADOR ---- */
      case "escorxador.save": {
        need("escorxador", 2);
        const r = body.rec || {};
        if (!r.id) needFarm(r.farm, "escorxador");
        const fem = num(r.fem), masc = num(r.masc);
        const res = await update("escorxador", (rows) => {
          let ex = r.id ? rows.find((x) => x.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex && ex.exported) fail("exported");
          if (ex && ex.validated && me.role === "granger") fail("locked");
          if (ex && !farmOk("escorxador", ex.farm)) fail("forbidden_farm", 403);
          if (!ex) {
            if (rows.some((x) => x.farm === r.farm && !x.validated && !x.exported)) fail("dup_open");
            const y = +r.year, w = +r.week; if (!y || !(w >= 1 && w <= 53)) fail("fill");
            if (rows.some((x) => x.farm === r.farm && x.year === y && x.week === w)) fail("dup");
            ex = { id: uid(), farm: r.farm, year: y, week: w, validated: false, created: stamp() }; rows.push(ex);
          }
          ex.fem = fem; ex.masc = masc; ex.upd = stamp(); return ex;
        });
        return json({ rec: res });
      }
      case "escorxador.validate": {
        need("escorxador", 1); needFlag("validar");
        const res = await update("escorxador", (rows) => {
          const ex = rows.find((x) => x.id === body.id); if (!ex) fail("not_found", 404); needFarm(ex.farm, "escorxador");
          if (ex.validated || ex.exported) fail("locked");
          if (ex.fem === null || ex.fem === undefined || ex.masc === null || ex.masc === undefined) fail("fill");
          ex.validated = true; ex.val = stamp();
          const nw = nextWeek(ex.year, ex.week);
          if (!rows.some((x) => x.farm === ex.farm && x.year === nw.y && x.week === nw.w))
            rows.push({ id: uid(), farm: ex.farm, year: nw.y, week: nw.w, fem: null, masc: null, validated: false, created: { ...stamp(), auto: true } });
          return ex;
        });
        return json({ rec: res });
      }
      case "escorxador.return": {
        need("escorxador", 1); needFlag("retornar");
        const motiu = str(body.motiu, 300);
        const res = await update("escorxador", (rows) => {
          const ex = rows.find((x) => x.id === body.id); if (!ex) fail("not_found", 404); needFarm(ex.farm, "escorxador");
          if (!ex.validated && !ex.exported) fail("not_validated");
          if (rows.some((x) => x !== ex && x.farm === ex.farm && !x.validated && !x.exported && (x.fem != null || x.masc != null))) fail("dup_open");
          ex.exported = null;
          // treu el registre obert automàtic i buit de la setmana següent
          const nw = nextWeek(ex.year, ex.week);
          const i = rows.findIndex((x) => x.farm === ex.farm && x.year === nw.y && x.week === nw.w && !x.validated && x.created?.auto && x.fem == null && x.masc == null);
          if (i >= 0) rows.splice(i, 1);
          ex.validated = false; ex.val = null; (ex.returns ||= []).push({ ...stamp(), motiu });
          return ex;
        });
        return json({ rec: res });
      }

      case "escorxador.export": {
        need("escorxador", 1); needFlag("tancaExport");
        const ids = new Set(Array.isArray(body.ids) ? body.ids : []);
        let n = 0;
        await update("escorxador", (rows) => {
          const s0 = stamp();
          rows.filter((x) => ids.has(x.id) && !x.exported && x.fem != null && x.masc != null && farmOk("escorxador", x.farm)).forEach((x) => {
            x.exported = s0; n++;
            if (!x.validated) { // setmana tancada sense validar: s'obre la següent
              const nw = nextWeek(x.year, x.week);
              if (!rows.some((y) => y.farm === x.farm && y.year === nw.y && y.week === nw.w))
                rows.push({ id: uid(), farm: x.farm, year: nw.y, week: nw.w, fem: null, masc: null, validated: false, created: { ...s0, auto: true } });
            }
          });
        });
        return json({ n });
      }

      /* ---- DESPESES ---- */
      case "gastos.upload": {
        need("gastos", 2);
        const b64 = String(body.image || "");
        if (b64.length < 100 || b64.length > 5_500_000) fail("bad_image");
        const id = uid();
        await st().set("photo/" + id, Buffer.from(b64, "base64"));
        return json({ photoId: id });
      }
      case "gastos.analyze": {
        need("gastos", 2);
        const buf = await st().get("photo/" + str(body.photoId, 60), { type: "arrayBuffer" });
        if (!buf) fail("not_found", 404);
        return json({ fields: await analyzeAlbara(Buffer.from(buf).toString("base64")) });
      }
      case "gastos.photo": {
        need("gastos", 1);
        const g = (await get("gastos")).find((x) => x.id === body.id);
        if (!g || !farmOk("gastos", g.farm) || !g.photo) fail("not_found", 404);
        const buf = await st().get("photo/" + g.photo, { type: "arrayBuffer" });
        if (!buf) fail("not_found", 404);
        return json({ image: Buffer.from(buf).toString("base64") });
      }
      case "gastos.save": {
        need("gastos", 2);
        const r = body.rec || {};
        needFarm(r.farm, "gastos");
        const v = { farm: r.farm, empresa: str(r.empresa), albara: str(r.albara, 60), data: /^\d{4}-\d{2}-\d{2}$/.test(r.data || "") ? r.data : "", import: num(r.import), categoria: CATS.includes(r.categoria) ? r.categoria : "altres", concepte: str(r.concepte, 200) };
        if (!v.empresa || v.import === null) fail("fill");
        const res = await update("gastos", (rows) => {
          const ex = r.id ? rows.find((x) => x.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex) { if (!farmOk("gastos", ex.farm)) fail("forbidden_farm", 403); if (me.role === "granger" && ex.created.by !== me.id) fail("forbidden", 403); Object.assign(ex, v, { upd: stamp() }); return ex; }
          const n = { id: uid(), ...v, photo: str(r.photo, 60) || null, ai: r.ai || null, created: stamp() }; rows.push(n); return n;
        });
        return json({ rec: res });
      }
      case "gastos.delete": {
        need("gastos", 2);
        let photo = null;
        await update("gastos", (rows) => { const i = rows.findIndex((x) => x.id === body.id); if (i < 0) fail("not_found", 404); needFarm(rows[i].farm, "gastos"); if (me.role === "granger" && rows[i].created.by !== me.id) fail("forbidden", 403); photo = rows[i].photo; rows.splice(i, 1); });
        if (photo) await st().delete("photo/" + photo).catch(() => {});
        return json({ ok: true });
      }

      /* ---- HIDRÒLISI ---- */
      case "hidrolisi.step": {
        need("hidrolisi", 2);
        const { farm, cont } = body;
        needFarm(farm, "hidrolisi");
        const f = farmsAll.find((x) => x.id === farm);
        if (!f || !(f.conts || []).some((c) => c.id === cont)) fail("not_found", 404);
        const when = new Date(body.when); if (isNaN(when)) fail("bad_date");
        const at = when.toISOString(); const pes = body.pes;
        const res = await update("hidrolisi", (rows) => {
          const cyc = rows.filter((x) => x.farm === farm && x.cont === cont).sort((a, b) => (a.ini < b.ini ? 1 : -1))[0];
          const step = !cyc || cyc.buid ? "ini" : !cyc.tanc ? "tanc" : "buid";
          if (body.step !== step) fail("wrong_step", 409);
          if (step === "ini") { const n = { id: uid(), farm, cont, ini: at, tanc: null, buid: null, pes: null, log: { ini: stamp() } }; rows.push(n); return n; }
          if (step === "tanc") { cyc.tanc = at; cyc.log.tanc = stamp(); return cyc; }
          const p = num(pes); if (p === null) fail("fill");
          cyc.buid = at; cyc.pes = p; cyc.log.buid = stamp(); return cyc;
        });
        return json({ rec: res });
      }
      case "hidrolisi.save": {
        need("hidrolisi", 2); needFlag("gestHidro");
        const r = body.rec || {};
        needFarm(r.farm, "hidrolisi");
        const d = (x) => { if (!x) return null; const t = new Date(x); if (isNaN(t)) fail("bad_date"); return t.toISOString(); };
        const v = { farm: r.farm, cont: str(r.cont, 60), ini: d(r.ini), tanc: d(r.tanc), buid: d(r.buid), pes: num(r.pes) };
        if (!v.ini) fail("fill");
        if ((v.tanc && v.tanc < v.ini) || (v.buid && (!v.tanc || v.buid < v.tanc))) fail("bad_order");
        const res = await update("hidrolisi", (rows) => {
          const ex = r.id ? rows.find((x) => x.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex) { Object.assign(ex, v, { upd: stamp() }); return ex; }
          const n = { id: uid(), ...v, log: { manual: stamp() } }; rows.push(n); return n;
        });
        return json({ rec: res });
      }
      case "hidrolisi.delete": {
        need("hidrolisi", 2); needFlag("gestHidro");
        await update("hidrolisi", (rows) => { const i = rows.findIndex((x) => x.id === body.id); if (i < 0) fail("not_found", 404); needFarm(rows[i].farm, "hidrolisi"); rows.splice(i, 1); });
        return json({ ok: true });
      }

      /* ---- GRANGES ---- */
      case "farms.save": {
        need("granges", 2);
        const r = body.rec || {};
        const list = (a, key) => (Array.isArray(a) ? a : []).map((x) => ({ id: str(x.id, 40) || uid(), [key]: str(x[key], 80) })).filter((x) => x[key]);
        const v = { ref: str(r.ref, 40), name: str(r.name), rega: str(r.rega, 40), marca: str(r.marca, 40), address: str(r.address, 300), own: !!r.own, naus: list(r.naus, "name"), conts: list(r.conts, "code") };
        if (!v.name) fail("fill");
        const res = await update("farms", (rows) => {
          const ex = r.id ? rows.find((x) => x.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex) { Object.assign(ex, v); return ex; }
          const n = { id: uid(), ...v }; rows.push(n); return n;
        });
        return json({ rec: res });
      }
      case "farms.delete": {
        if (!isAdmin) fail("forbidden", 403);
        await update("farms", (rows) => { const i = rows.findIndex((x) => x.id === body.id); if (i >= 0) rows.splice(i, 1); });
        await update("users", (us) => us.forEach((u) => (u.farms = (u.farms || []).filter((f) => f !== body.id))));
        return json({ ok: true });
      }

      /* ---- CONFIGURACIÓ (només admin) ---- */
      case "users.save": {
        if (!isAdmin) fail("forbidden", 403);
        const r = body.rec || {};
        const v = { login: str(r.login, 40).toLowerCase().replace(/\s+/g, ""), name: str(r.name), role: ROLES.includes(r.role) ? r.role : "granger", farms: (r.farms || []).filter((id) => farmsAll.some((f) => f.id === id)) };
        if (!v.login || !v.name) fail("fill");
        const pin = str(r.pin, 20);
        if (pin && !/^\d{4,8}$/.test(pin)) fail("pin_len");
        const res = await update("users", (us) => {
          if (us.some((u) => u.login === v.login && u.id !== r.id)) fail("login_taken");
          const ex = r.id ? us.find((u) => u.id === r.id) : null;
          if (r.id && !ex) fail("not_found", 404);
          if (ex && ex.role === "admin" && v.role !== "admin" && us.filter((u) => u.role === "admin").length < 2) fail("last_admin");
          if (!ex && !pin) fail("pin_len");
          const tgt = ex || { id: uid() };
          Object.assign(tgt, v);
          if (pin) { tgt.salt = crypto.randomBytes(8).toString("hex"); tgt.pin = hashPin(pin, tgt.salt); }
          if (!ex) us.push(tgt);
          return publicUser(tgt);
        });
        return json({ rec: res });
      }
      case "users.delete": {
        if (!isAdmin) fail("forbidden", 403);
        if (body.id === me.id) fail("self");
        await update("users", (us) => { const i = us.findIndex((u) => u.id === body.id); if (i >= 0) us.splice(i, 1); });
        return json({ ok: true });
      }
      case "perms.save": {
        if (!isAdmin) fail("forbidden", 403);
        const p = body.perms || {};
        await update("perms", (cur) => {
          for (const r of ROLES) {
            if (r === "admin") continue;
            cur[r] = {};
            for (const m of MODS) cur[r][m] = [0, 1, 2].includes(+p[r]?.[m]) ? +p[r][m] : DEF_PERMS[r][m];
            for (const f of FLAGS) cur[r][f] = !!p[r]?.[f];
          }
        });
        return json({ ok: true });
      }
      case "settings.save": {
        if (!isAdmin) fail("forbidden", 403);
        const sc = body.scope || {};
        await update("settings", (cur) => { cur.scope = {}; for (const m of ["destete", "escorxador", "gastos", "hidrolisi"]) cur.scope[m] = SCOPES.includes(sc[m]) ? sc[m] : "all"; });
        return json({ ok: true });
      }
      case "pin.change": {
        const pin = str(body.pin, 20);
        if (!/^\d{4,8}$/.test(pin)) fail("pin_len");
        if (me.pin !== hashPin(str(body.old, 20), me.salt)) fail("bad_login", 401);
        await update("users", (us) => { const u = us.find((x) => x.id === me.id); u.salt = crypto.randomBytes(8).toString("hex"); u.pin = hashPin(pin, u.salt); });
        return json({ ok: true });
      }
      default: fail("bad_action");
    }
  } catch (e) {
    if (e instanceof HttpErr) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: "server" }, 500);
  }
};
