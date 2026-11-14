---
name: cdm-api
description: Consulta la API del Centro de Monitoreo (CDM) de Producteca para buscar ejecuciones, logs, payloads, jobs, changes de productos/ventas y el built de una app (sus integrations). Usar siempre que haya que verificar en el CDM qué pasó con un recurso mientras se testea un cambio en cualquier repo — "buscá la ejecución", "fijate los logs", "qué payload se mandó", "changes del producto/venta", "jobs de la integration", "built de la app 566", "se sincronizó el precio/stock en Falabella", "qué pasó con el job de la acción masiva", "se registró el bloqueo manual", x-producteca-event-id, eventId.
---

# CDM API

Todo se hace con el CLI `cdm.mjs` de esta skill (Node 18+, sin dependencias). Devuelve JSON por stdout.

```bash
node ${CLAUDE_SKILL_DIR}/cdm.mjs <comando> [args] [--flags]
```

En PowerShell usar `node "${CLAUDE_SKILL_DIR}/cdm.mjs" ...`.

## Primer uso: armar las credenciales

Si el CLI corta con "Falta auth", guiá al usuario con estos pasos. **No le pidas el token por el chat**: lo que se pega en el chat queda guardado en el historial de la sesión. Que lo escriba él directo en el archivo.

1. Tener Node 18 o más (`node --version`) y el plugin `generic-apps` instalado (la skill vive en `${CLAUDE_SKILL_DIR}/`, con `SKILL.md`, `cdm.mjs`, `.env.example` y la carpeta `references/`).
2. Crear el archivo de credenciales **fuera de la skill y fuera de cualquier repo**, con permisos solo para su usuario:
   ```bash
   mkdir -p ~/.config/cdm-api
   cp ${CLAUDE_SKILL_DIR}/.env.example ~/.config/cdm-api/.env
   chmod 600 ~/.config/cdm-api/.env
   ```
   En Windows, `chmod` no aplica. `~/.config` queda dentro del perfil del usuario (`C:\Users\<usuario>\.config\cdm-api\.env`), que ya no lo leen otros usuarios.
3. Abrir el archivo con un editor (`notepad ~/.config/cdm-api/.env` o `code ~/.config/cdm-api/.env`) y completar **una** de las dos opciones. Las dos sirven igual para consultar:
   - `CDM_BEARER`: un token de Producteca. Ve la company de ese token.
   - `CDM_MASTER_TOKEN` + `CDM_COMPANY_ID`: el master token del CDM y la company por defecto. Con `--company <id>` puede consultar cualquier otra company. El master token lo da el equipo de Producteca: pedíselo internamente. Si no lo tenés, usá el Bearer.
   - `CDM_ADMIN_EMAIL` es opcional y solo hace falta para `--all-companies` (ver "Company: una sola o todas").
4. Probar: `node ${CLAUDE_SKILL_DIR}/cdm.mjs built` tiene que listar las apps de la company.

Buenas prácticas:
- **Una sola copia de las credenciales**, en `~/.config/cdm-api/.env`. No las copies a `.env` de repos (se commitean por error) ni a la carpeta de la skill (el CLI la ignora y avisa, para que compartir la skill no arrastre el token).
- Si preferís no tener el token en disco, definilo como variable de entorno de la sesión, ya que las variables de entorno tienen prioridad sobre el archivo. Otra opción es apuntar `CDM_ENV_FILE` a otra ruta.
- Si un token se filtró (por ejemplo, se pegó en el chat o en un commit), rotalo.
- En Mac o Linux, el CLI avisa si el archivo lo pueden leer otros usuarios.

## Configuración (auth)

El CLI lee, en este orden: variables de entorno → `~/.config/cdm-api/.env` (o la ruta de `CDM_ENV_FILE`). No lee el `.env` del directorio actual, porque puede ser el de otro repo.

| Variable | Uso |
|---|---|
| `CDM_BEARER` | Token de Producteca. Ve la company del token. |
| `CDM_MASTER_TOKEN` | Master token del CDM (Basic auth). Junto con `--company <id>` consulta cualquier company. |
| `CDM_COMPANY_ID` | Company por defecto con master token, si no se pasa `--company`. |
| `CDM_ADMIN_EMAIL` | Email `@parsimotion.com` dado de alta como admin en el CDM. Solo hace falta para `--all-companies`. |
| `CDM_DOMAIN` | Opcional. Default `https://apps.producteca.com/monitoring-center`. Para un preview: `https://monitoring-center-<PR>.preview.producteca.com`. |
| `CDM_ENV_FILE` | Opcional. Ruta del archivo de credenciales, si no querés usar `~/.config/cdm-api/.env`. |
| `CDM_DEBUG=1` | Imprime en stderr cada URL que se pide (y `[no-cache]` si se pidió sin caché). |

`CDM_BEARER` y `CDM_MASTER_TOKEN` son alternativas: cualquiera de las dos alcanza. Si están las dos, con `--company` o `--all-companies` se usa el master token, y sin esos flags se usa el Bearer.

**Nunca imprimas ni repitas los tokens.** Si falta auth, frená y seguí "Primer uso". No busques credenciales por otro lado: ni cookies, ni otros `.env`, ni configs de otros repos.

## Company: una sola o todas

Antes de consultar, definí el alcance según lo que pidió el usuario:

| Pedido | Qué usar | Qué necesitás del usuario |
|---|---|---|
| Algo de **una company** (lo normal al testear: "la cuenta 12345", "mi company de test") | `--company <companyId>` en cada comando. Autentica como `companyId:masterToken` y solo ve esa company. | El **id numérico** de la company. Si no lo dio y no hay `CDM_COMPANY_ID`, **preguntáselo**; no lo adivines por el nombre. |
| Ver **todas las companies** ("en todas las cuentas", "a quién más le pasa", "cualquier company") | `--all-companies`. Autentica como admin (`CDM_ADMIN_EMAIL:masterToken`) y ve todas. | Que `CDM_ADMIN_EMAIL` esté en el `.env` con un email `@parsimotion.com` dado de alta como **admin del CDM**. Si falta, pedíselo; si da 401, ese email no es admin. |

Qué se puede hacer en cada modo:

| Comando | `--company <id>` | `--all-companies` |
|---|---|---|
| `built` | ✅ | ❌ El server no carga apps autorizadas para el admin. Sacá el built con una company que tenga la app. |
| `executions`, `logs`, `payload`, `jobs` | ✅ solo esa company | ✅ todas (cada ejecución trae su `company`). **Pasá el `fullId` de la integration**, no el id corto: sin built no se puede resolver. |
| `changes`, `change-executions`, `resource` | ✅ | ❌ Los changes se guardan por `companyId-resourceId`, así que siempre necesitan una company concreta. Usá `--company <id>`. |

Si no se pasa ni `--company` ni `--all-companies`, se usa `CDM_BEARER` y, si no hay, `CDM_COMPANY_ID`. La salida de `executions` muestra `auth` y `company` para que confirmes con qué alcance consultaste.

## Reglas de uso (no negociables)

1. **Logs solo a partir de una ejecución.** Primero ubicás la ejecución (`executions` o `change-executions`), y después pedís `logs`/`payload` con su `id` y su `timestamp`. No armes queries contra la base de logs, Athena ni ningún endpoint que no sea el de logs de una ejecución.
2. **Ejecuciones: siempre con un rango de tiempo, y como máximo 6 horas.**
   - Si el usuario pide ejecuciones sin fecha ni rango, **preguntale** cuándo fue (aproximado) antes de consultar. No asumas "las últimas 24 hs".
   - Si pide 24 hs o más, no lo hagas. Explicale el límite y pedile que acote el rango, o una fecha de referencia para centrar la ventana de ≤6 hs.
   - El CLI rechaza `--hours` faltante o mayor a 6. No lo esquives: no partas un rango grande en muchas consultas de 6 hs sin que el usuario lo pida, y no uses `get` para las ejecuciones.
   - Si lo que tenés es un cambio de producto o venta, conviene entrar por `changes` → `change-executions`: ya acota la búsqueda al evento.
3. **Changes: hasta 90 días hacia atrás.** No hace falta preguntar para rangos de hasta 3 meses. Si no se indica, el default es 1 día.

## Flujo típico

1. **Ubicar la integration con el built.** `app` es el clientId numérico de la app (ej. 566). El built lista sus integrations con el `fullId` (`<baseAppId>|<id>`), que es lo que va en todas las URLs de executions/logs/payload/jobs.
   ```bash
   node ${CLAUDE_SKILL_DIR}/cdm.mjs built 566 --filter price --company <companyId>
   ```
   Si no sabés el id de la app: `built` sin args lista las apps autorizadas.

   El built no lista todas las integrations que reciben ejecuciones. Las de la app `1` (Producteca) que registran acciones internas no aparecen, por ejemplo `producteca|manual-block` o las `spreadsheets|<nombre del job>` (ver "Acciones masivas y bloqueos" en `references/canales.md`). Para esas, pasá el `fullId` completo: con el id corto el CLI corta con "No encontré la integration".
2. **Buscar ejecuciones** del recurso: el id de la variante, producto o venta, o el id externo del canal.
   ```bash
   node ${CLAUDE_SKILL_DIR}/cdm.mjs executions 566 prices --resource 123456 --hours 3 --company <companyId>
   node ${CLAUDE_SKILL_DIR}/cdm.mjs executions 566 "566|prices" --resource 123456 --hours 3 --all-companies
   node ${CLAUDE_SKILL_DIR}/cdm.mjs executions 566 prices --resource 123456 --hours 6 --date "2026-10-01T15:00:00-03:00"
   ```
   El `<integration>` puede ser el `fullId` o el id corto: el CLI lo resuelve contra el built. Ojo: el prefijo del `fullId` suele ser el nombre de la app, no su id (`falabella|products-prices`, no `330|...`).

   **Varias integrations de una app a la vez** (el endpoint del CDM no permite buscar en toda la app; el CLI hace una consulta por integration, con un máximo de 6 por corrida, y exige `--resource` o `--event`):
   ```bash
   node ${CLAUDE_SKILL_DIR}/cdm.mjs executions 330 products-prices,batchteca-notifications --resource 217275680 --hours 6 --date "2026-10-01 23:00:00"
   node ${CLAUDE_SKILL_DIR}/cdm.mjs executions 330 --match "precio|stock|productos en lote|resultados" --resource 217275680 --hours 6 --date "2026-10-01 23:00:00"
   ```
   `--match` es una regex sobre el `fullId` y el nombre de las integrations del built. Solo devuelve las integrations que tuvieron resultados, y en `searched` lista todas las que consultó.
3. **Logs y payload** de una ejecución, usando el `timestamp` que vino en la ejecución:
   ```bash
   node ${CLAUDE_SKILL_DIR}/cdm.mjs logs 566 prices <executionId> --date "<timestamp>"
   node ${CLAUDE_SKILL_DIR}/cdm.mjs payload 566 prices <executionId> --date "<timestamp>"
   ```
   Atajo: `executions ... --details 3` trae logs + payload de las primeras 3 ejecuciones en una sola corrida. Antes de leerlos, leé `references/logs.md`.

Desde un cambio en Producteca (precio, stock, venta) hacia las ejecuciones que disparó:
```bash
node ${CLAUDE_SKILL_DIR}/cdm.mjs changes products <productId> --days 7 --company <companyId>
node ${CLAUDE_SKILL_DIR}/cdm.mjs change-executions products <productId> <eventId> --company <companyId>
```
Luego `logs`/`payload` con el `app`, `integration`, `id` y `timestamp` de cada ejecución devuelta.

Si `changes` viene vacío, no concluyas que el producto no cambió: buscá directo con `executions <app> --match ... --resource <id>` en la ventana del cambio. Hay companies donde los changes no se registran (ver `references/trampas.md`).

## Referencias (leelas cuando apliquen)

| Archivo | Cuándo leerlo |
|---|---|
| `references/canales.md` | Antes de buscar publicación, precios, stock, bulks, acciones masivas o bloqueos: en qué integration queda cada paso según el canal (incluye el detalle de Falabella y los `error_type` esperados). |
| `references/logs.md` | Antes de interpretar `logs` o `payload`: demoras, formatos por app, datos sensibles, qué no se loguea. |
| `references/trampas.md` | Antes de concluir que algo no pasó, o si una consulta da vacío o raro: ventanas de tiempo, caché de Athena, `--status`, `--resource` por subcadena, topes. |

Lo mínimo que siempre hay que tener en cuenta (detalle en `references/trampas.md`):
- Las fechas sin zona son UTC, como los `timestamp` del CDM.
- `--status` es una lista blanca: sin `--status` salen todos los estados finales, y `pending`/`queued` solo si los pedís.
- Vacío no significa que no pasó: revisá ventana, integration, company y caché.

## Comandos

| Comando | Endpoint | Flags |
|---|---|---|
| `built [app]` | `GET /api/apps/built[/{app}]` | `--filter <texto>` (filtra integrations), `--full` (respuesta cruda) |
| `executions <app> <integration[,int2]>` o `--match <regex>` | `GET /api/apps/{app}/integrations/{fullId}/executions` | `--hours N` (**obligatorio, 1..6**), `--resource`, `--event`, `--status ok,error,...`, `--date`, `--sort asc\|desc`, `--token`, `--topic`, `--errorType`, `--limit N`, `--details N`, `--full`, `--fresh` |
| `logs <app> <integration> <execId>` | `.../executions/{execId}/logs` | `--date` (obligatorio), `--sort`, `--token`, `--fresh` |
| `payload <app> <integration> <execId>` | `.../executions/{execId}` | `--date` (obligatorio), `--fresh` |
| `jobs <app> <integration>` | `.../jobs` | `--days N`, `--date`, `--token`, `--fresh` |
| `changes <products\|salesorders> <id> [eventId]` | `GET /api/{entity}/{id}/changes[/{eventId}]` | `--company`, `--days N` (default 1, máx 90), `--date`, `--sort`, `--limit` |
| `change-executions <entity> <id> <eventId>` | `.../changes/{eventId}/executions` | `--company`, `--full` |
| `resource <entity> <id>` | `GET /api/{entity}/{id}` (producto/venta actual vía API de Producteca) | `--company` |
| `get <path>` | Cualquier otro `GET /api/<path>`, con los flags como query params. Rechaza executions, changes y logs. | — |

`entity` acepta `products`/`producto` y `salesorders`/`venta`.

