#!/usr/bin/env node
// CLI para consultar la API del Centro de Monitoreo (CDM) de Producteca.
// Uso: node cdm.mjs <comando> [args] [--flags]. Ver SKILL.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = path.dirname(fileURLToPath(import.meta.url));
// Las credenciales viven fuera de la carpeta de la skill, para que compartirla nunca arrastre el token.
const ENV_FILE = process.env.CDM_ENV_FILE || path.join(os.homedir(), ".config", "cdm-api", ".env");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
// Prioridad: variables de entorno > ENV_FILE. No se lee el .env del directorio actual: puede ser el de otro repo.
loadEnv(ENV_FILE);
if (fs.existsSync(ENV_FILE) && process.platform !== "win32" && (fs.statSync(ENV_FILE).mode & 0o077)) {
  console.error(`AVISO: ${ENV_FILE} lo pueden leer otros usuarios. Corré: chmod 600 "${ENV_FILE}"`);
}
if (fs.existsSync(path.join(SKILL_DIR, ".env"))) {
  console.error(`AVISO: hay un .env dentro de la carpeta de la skill y se ignora. Movelo a ${ENV_FILE} para que no viaje si se comparte la skill.`);
}

const DOMAIN = (process.env.CDM_DOMAIN || "https://apps.producteca.com/monitoring-center").replace(/\/$/, "");
const BASE = `${DOMAIN}/api`;

// Con quién se autentica la llamada. Se define una vez por corrida en resolveAuth().
//   mode "company": Basic companyId:masterToken → ve solo esa company.
//   mode "admin":   Basic email@parsimotion.com:masterToken → ve todas las companies.
//   mode "bearer":  token de Producteca → ve la company del token.
let AUTH;

function resolveAuth(flags) {
  const { CDM_BEARER, CDM_MASTER_TOKEN, CDM_COMPANY_ID, CDM_ADMIN_EMAIL } = process.env;
  const envFile = ENV_FILE;
  const basic = (user) => `Basic ${Buffer.from(`${user}:${CDM_MASTER_TOKEN}`).toString("base64")}`;

  if (flags["all-companies"]) {
    if (!CDM_MASTER_TOKEN || !CDM_ADMIN_EMAIL) {
      fail(`Para ver todas las companies hace falta CDM_ADMIN_EMAIL (email @parsimotion.com dado de alta como admin en el CDM) + CDM_MASTER_TOKEN en ${envFile}. Pedíselo al usuario.`);
    }
    if (!/@parsimotion\.com$/i.test(CDM_ADMIN_EMAIL)) fail("CDM_ADMIN_EMAIL tiene que ser un email @parsimotion.com.");
    return { mode: "admin", header: basic(CDM_ADMIN_EMAIL) };
  }
  if (flags.company && flags.company !== true) {
    if (!/^\d+$/.test(String(flags.company))) fail(`--company tiene que ser el id numérico de la company (recibí "${flags.company}").`);
    if (CDM_MASTER_TOKEN) return { mode: "company", company: String(flags.company), header: basic(flags.company) };
    if (CDM_BEARER) return { mode: "bearer", company: String(flags.company), header: bearer(CDM_BEARER) };
  }
  if (CDM_BEARER) return { mode: "bearer", header: bearer(CDM_BEARER) };
  if (CDM_MASTER_TOKEN && CDM_COMPANY_ID) return { mode: "company", company: CDM_COMPANY_ID, header: basic(CDM_COMPANY_ID) };
  if (!fs.existsSync(envFile)) {
    fail(`Falta auth: no existe ${envFile}. Es el primer uso: guiá al usuario con la sección "Primer uso" del SKILL.md (no le pidas el token por el chat).`);
  }
  fail(`Falta auth: ${envFile} no tiene CDM_BEARER ni CDM_MASTER_TOKEN + CDM_COMPANY_ID. Pedile al usuario que lo complete (sección "Primer uso" del SKILL.md).`);
}

function bearer(token) {
  return /^bearer /i.test(token) ? token : `Bearer ${token}`;
}

// En changes/resource el server usa ?company= para impersonar. Como admin es obligatorio;
// como company se manda la propia (el server la ignora y usa la autenticada).
function companyParam() {
  if (AUTH.mode === "admin") fail("Como admin, changes/resource necesitan una company concreta: usá --company <id> en lugar de --all-companies.");
  return AUTH.company;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, inline] = a.slice(2).split("=", 2);
      if (inline !== undefined) flags[k] = inline;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

async function get(p, query = {}, extraHeaders = {}) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== true)
  ).toString();
  const url = `${BASE}/${p.replace(/^\//, "")}${qs ? `?${qs}` : ""}`;
  if (process.env.CDM_DEBUG) console.error(`GET ${url}${extraHeaders["cache-control"] ? " [no-cache]" : ""}`);
  let res, text;
  try {
    res = await fetch(url, { headers: { authorization: AUTH.header, accept: "application/json", ...extraHeaders }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    text = await res.text();
  } catch (err) {
    if (err.name === "TimeoutError") fail(`El CDM no respondió en ${REQUEST_TIMEOUT_MS / 1000} s (GET ${url}). Acotá la consulta (menos horas, --resource o --event) o reintentá más tarde.`);
    throw err;
  }
  if (!res.ok) fail(`${res.status} ${res.statusText} en GET ${url}\n${text.slice(0, 2000)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

// Si el CDM no responde en este tiempo, cortamos: esperar más no aporta.
const REQUEST_TIMEOUT_MS = 60_000;

// Límites de ventana: Athena es caro, no dejar barrer rangos grandes de ejecuciones.
const MAX_EXECUTION_HOURS = 6;
const MAX_CHANGES_DAYS = 90;

const MAX_INTEGRATIONS_PER_RUN = 6;

// Los timestamps del CDM vienen sin zona ("2026-10-01 20:39:19.333") y están en UTC.
// Sin esto, Node los toma como hora local y la consulta cae en otra partición horaria.
function toISO(date) {
  if (!date || date === true) return undefined;
  const s = String(date).trim();
  const noZone = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s);
  const d = new Date(noZone ? `${s.replace(" ", "T")}${s.length > 10 ? "" : "T00:00:00"}Z` : s);
  if (Number.isNaN(d.getTime())) fail(`Fecha inválida: "${date}"`);
  return d.toISOString();
}

const print = (data) => console.log(JSON.stringify(data, null, 2));
const enc = encodeURIComponent;

// --- built / integrations ---------------------------------------------------

function compactIntegration(it) {
  return {
    fullId: it.fullId,
    _id: it._id,
    name: it.name,
    type: it.type,
    integrationType: it.integrationType,
    direction: it.direction,
    topic: it.settings?.topic ?? it.topic,
    resourceType: it.resourceType,
    actions: it.metadata?.actions?.map((x) => `${x.type}:${x.entity}`),
    requestUrl: it.request?.url,
    status: it.status,
  };
}

async function getBuilt(app) {
  return get(`apps/built/${enc(app)}`);
}

// Acepta fullId ("566|prices") o el _id corto ("prices") y lo resuelve contra el built.
async function resolveIntegration(app, integration) {
  if (!integration) fail("Falta <integration>. Usá `built <app>` para ver las integrations.");
  if (integration.includes("|")) return integration;
  if (AUTH.mode === "admin") fail(`Con --all-companies pasá el fullId de la integration (ej. "${app}|${integration}"): el built no se puede consultar como admin. Sacalo antes con \`built ${app} --company <id>\`.`);
  const built = await getBuilt(app);
  const matches = (built?.integrations || []).filter(
    (it) => it._id === integration || it.fullId?.endsWith(`|${integration}`) || it.name === integration
  );
  if (matches.length === 1) return matches[0].fullId;
  if (matches.length === 0) fail(`No encontré la integration "${integration}" en el built de ${app}. Corré \`built ${app}\`.`);
  fail(`"${integration}" es ambigua: ${matches.map((m) => m.fullId).join(", ")}`);
}

const EXECUTION_CORE = ["id", "app", "integration", "event", "event_timestamp", "timestamp", "resource",
  "externalreference", "status", "error_type", "output_message", "parent", "topic"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const commands = {
  async built({ positional: [app], flags }) {
    if (AUTH.mode === "admin") fail("El built no funciona como admin (el server no tiene autorizaciones de apps para el admin). Usá --company <id>.");
    if (!app) {
      const apps = await get("apps/built");
      if (flags.full) return print(apps);
      const seen = new Set();
      return print((apps || [])
        .filter((a) => !seen.has(`${a.id}|${a.name}`) && seen.add(`${a.id}|${a.name}`))
        .map((a) => ({ id: a.id, name: a.name, integrations: a.integrations?.length })));
    }
    const built = await getBuilt(app);
    if (flags.full) return print(built);
    let integrations = (built?.integrations || []).map(compactIntegration);
    if (flags.filter) {
      const f = String(flags.filter).toLowerCase();
      integrations = integrations.filter((it) => JSON.stringify(it).toLowerCase().includes(f));
    }
    print({ id: built?.id, name: built?.name, aliases: built?.aliases, integrations });
  },

  async executions({ positional: [app, integration], flags }) {
    if (!app || (!integration && !flags.match)) {
      fail("Uso: executions <app> <integration[,integration2...]> | --match <regex> [--resource] [--event] [--status] --hours 1..6 [--date] [--sort] [--token]");
    }
    const hours = Number(flags.hours);
    if (flags.hours === undefined || flags.hours === true || !Number.isFinite(hours) || hours === 0) {
      fail(`Falta el rango de tiempo. Pedile al usuario una ventana (--hours 1..${MAX_EXECUTION_HOURS}) y, si no es reciente, una fecha de referencia (--date).`);
    }
    if (Math.abs(hours) > MAX_EXECUTION_HOURS) {
      fail(`Máximo ${MAX_EXECUTION_HOURS} horas por consulta de ejecuciones (pediste ${Math.abs(hours)}). Pedile al usuario que acote el rango o una fecha (--date) más precisa.`);
    }
    const fullIds = await resolveIntegrations(app, integration, flags.match);
    if (fullIds.length > 1 && flags.token) fail("--token sirve para paginar una sola integration.");
    if (fullIds.length > 1 && !flags.resource && !flags.event) {
      fail("Para buscar en varias integrations a la vez hace falta --resource o --event.");
    }
    const results = [];
    for (const fullId of fullIds) {
      results.push(await executionsOf(app, fullId, -Math.abs(hours), flags));
    }
    if (results.length === 1) return print({ auth: AUTH.mode, company: AUTH.company, ...results[0] });
    print({ auth: AUTH.mode, company: AUTH.company, searched: fullIds, results: results.filter((r) => r.count > 0) });
  },

  async logs({ positional: [app, integration, execution], flags }) {
    if (!execution || !flags.date) fail("Uso: logs <app> <integration> <executionId> --date <timestamp de la ejecución>");
    const fullId = await resolveIntegration(app, integration);
    print(await fetchLogs(app, fullId, execution, flags.date, flags));
  },

  async payload({ positional: [app, integration, execution], flags }) {
    if (!execution || !flags.date) fail("Uso: payload <app> <integration> <executionId> --date <timestamp de la ejecución>");
    const fullId = await resolveIntegration(app, integration);
    print(await fetchPayload(app, fullId, execution, flags.date, flags));
  },

  async jobs({ positional: [app, integration], flags }) {
    if (!app) fail("Uso: jobs <app> <integration> [--days] [--date] [--token]");
    const fullId = await resolveIntegration(app, integration);
    print(await get(`apps/${enc(app)}/integrations/${enc(fullId)}/jobs`, {
      date: toISO(flags.date),
      days: flags.days !== undefined ? -Math.abs(Number(flags.days)) : undefined,
      token: flags.token,
    }, freshHeaders(flags)));
  },

  async changes({ positional: [entity, resource, event], flags }) {
    entity = normalizeEntity(entity);
    if (!resource) fail("Uso: changes <products|salesorders> <id> [eventId] [--company] [--days] [--date] [--sort]");
    if (event) return print(await get(`${entity}/${enc(resource)}/changes/${enc(event)}`, { company: companyParam() }));
    const days = flags.days === undefined ? 1 : Math.abs(Number(flags.days));
    if (!Number.isFinite(days) || days === 0) fail("--days inválido");
    if (days > MAX_CHANGES_DAYS) fail(`Máximo ${MAX_CHANGES_DAYS} días de changes por consulta (pediste ${days}).`);
    // Sin --date la ventana es [ahora - days, ahora]; con --date es [date, date + days].
    print(await get(`${entity}/${enc(resource)}/changes`, {
      company: companyParam(),
      days: flags.date ? days : -days,
      date: toISO(flags.date),
      sort: flags.sort, limit: flags.limit,
    }));
  },

  async "change-executions"({ positional: [entity, resource, event], flags }) {
    entity = normalizeEntity(entity);
    if (!event) fail("Uso: change-executions <products|salesorders> <id> <eventId> [--company]");
    const data = await get(`${entity}/${enc(resource)}/changes/${enc(event)}/executions`, { company: companyParam() });
    const items = data?.items || data || [];
    print(flags.full ? data : { count: items.length, items: items.map((it) => pick(it, EXECUTION_CORE)) });
  },

  async resource({ positional: [entity, resource], flags }) {
    entity = normalizeEntity(entity);
    if (!resource) fail("Uso: resource <products|salesorders> <id> [--company]");
    print(await get(`${entity}/${enc(resource)}`, { company: companyParam() }));
  },

  async get({ positional: [p], flags }) {
    if (!p) fail("Uso: get <path relativo a /api> [--param valor ...]");
    if (/\/executions\/?$|\/changes\/?$|\/logs\/?$/.test(p.split("?")[0])) {
      fail("Para executions, changes y logs usá los comandos dedicados: aplican los límites de ventana.");
    }
    print(await get(p, flags));
  },
};

function normalizeEntity(entity) {
  const e = String(entity || "").toLowerCase();
  if (["product", "products", "producto", "productos"].includes(e)) return "products";
  if (["salesorder", "salesorders", "sale", "sales", "venta", "ventas", "order", "orders"].includes(e)) return "salesorders";
  fail(`Entidad inválida "${entity}". Usá products o salesorders.`);
}

// Athena reutiliza el resultado de la misma query hasta 10 min (Query Result Reuse). Si la ventana
// toca las últimas horas, ese caché esconde ejecuciones nuevas: pedimos resultado fresco.
const FRESH_WINDOW_MS = 2 * 60 * 60 * 1000;

function needsFreshResult(flags, date = flags.date) {
  if (flags.fresh) return true;
  if (!date) return true;
  return Date.now() - new Date(toISO(date)).getTime() < FRESH_WINDOW_MS;
}

const freshHeaders = (flags, date) => (needsFreshResult(flags, date) ? { "cache-control": "no-cache" } : {});

async function executionsOf(app, fullId, hours, flags) {
  const data = await get(`apps/${enc(app)}/integrations/${enc(fullId)}/executions`, {
    event: flags.event, resource: flags.resource, status: flags.status, hours,
    date: toISO(flags.date), sort: flags.sort, token: flags.token,
    topic: flags.topic, errorType: flags.errorType, outputMessage: flags.outputMessage,
  }, freshHeaders(flags));
  let items = data?.items || [];
  if (flags.limit) items = items.slice(0, Number(flags.limit));
  const out = items.map((it) => (flags.full ? it : pick(it, EXECUTION_CORE)));
  if (flags.details) {
    const n = Number(flags.details) || 3;
    for (const it of out.slice(0, n)) {
      const [logs, payload] = await Promise.all([
        fetchLogs(app, fullId, it.id, it.timestamp, flags),
        fetchPayload(app, fullId, it.id, it.timestamp, flags),
      ]);
      it.logs = logs;
      it.payload = payload?.payload ?? payload;
    }
  }
  return { integration: fullId, count: out.length, nextToken: data?.nextToken, items: out };
}

// "a,b" → cada una resuelta; --match <regex> → integrations del built cuyo id o nombre matchea.
async function resolveIntegrations(app, integration, match) {
  let fullIds;
  if (match && match !== true) {
    if (AUTH.mode === "admin") fail("--match necesita el built, que no funciona como admin. Usá --company <id>.");
    const re = new RegExp(match, "i");
    const built = await getBuilt(app);
    fullIds = (built?.integrations || []).filter((it) => re.test(it.fullId) || re.test(it.name || "")).map((it) => it.fullId);
    if (!fullIds.length) fail(`Ninguna integration de ${app} matchea /${match}/i. Corré \`built ${app}\`.`);
  } else {
    fullIds = [];
    for (const i of String(integration).split(",").map((x) => x.trim()).filter(Boolean)) {
      fullIds.push(await resolveIntegration(app, i));
    }
  }
  fullIds = [...new Set(fullIds)];
  if (fullIds.length > MAX_INTEGRATIONS_PER_RUN) {
    fail(`Son ${fullIds.length} integrations (${fullIds.join(", ")}); máximo ${MAX_INTEGRATIONS_PER_RUN} por corrida. Acotá la lista o el patrón.`);
  }
  return fullIds;
}

async function fetchLogs(app, fullId, execution, date, flags = {}) {
  const data = await get(`apps/${enc(app)}/integrations/${enc(fullId)}/executions/${enc(execution)}/logs`, {
    date: toISO(date), sort: flags.sort, token: flags.token,
  }, freshHeaders(flags, date));
  return data?.items ?? data;
}

async function fetchPayload(app, fullId, execution, date, flags = {}) {
  return get(`apps/${enc(app)}/integrations/${enc(fullId)}/executions/${enc(execution)}`, {
    date: toISO(date),
  }, freshHeaders(flags, date));
}

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.error(`Comandos: ${Object.keys(commands).join(", ")}. Ver ${path.join(SKILL_DIR, "SKILL.md")}`);
  process.exit(cmd ? 1 : 0);
}
const args = parseArgs(rest);
AUTH = resolveAuth(args.flags);
delete args.flags.company;
delete args.flags["all-companies"];
commands[cmd](args).catch((err) => fail(err.stack || err.message));
