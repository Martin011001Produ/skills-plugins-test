# Dónde queda registrado cada flujo

Leelo antes de buscar ejecuciones de publicación, precios, stock, bulks, acciones masivas o bloqueos: dice en qué integrations mirar según el canal.

## Dónde queda registrado cada paso según el canal

Cada canal registra la publicación, los precios y el stock en integrations distintas. Antes de concluir que algo no se hizo, buscá en todas las del flujo de ese canal. Los nombres de abajo son los de la UI (el `name` del built). El `fullId` puede variar según el canal: sacalo con `built <app> --filter "<nombre>"`, o buscá directo con `--match`, que matchea también por nombre.

Fuente: Notion "Como se ve la publicación en el CDM" y "Como se ve precios y stocks - batchteca" (DB tips customer).

### Publicación

| Canales | Dónde mirar |
|---|---|
| Apernet, TikTok, Shein, Paris, Vtex marketplace (**sincrónica**) | Una sola ejecución en **Publicación**. No hay job de por medio: el log de la request al canal está en esa ejecución. |
| Avenida, Megatone, Mirakl, Mirakl Catalog Publisher, Liverpool (**asincrónica, unificada**) | Todo en **Publicación**, pero con varias ejecuciones: (1) el `/publish` de la UI; (2) la del job que publica hacia el canal, que **tiene el log de publicación** (la creación del feed o bulk) y suele quedar `queued`, así que **no aparece sin `--status queued`** (tampoco en la UI); (3) solo en Mirakl, Mirakl Catalog Publisher y Liverpool, la del job que actualiza el estado de la publicación con el resultado del feed (logs de la consulta del feed, o la notificación de Mongo). Si (2) salió bien pero (3) falló, el feed se creó y el canal lo rechazó. |
| Seller-Center (Falabella), Walmart, Tiendanube (**asincrónica, en varias integrations**) | (1) **Publicación**: el `/publish`, que encola la notificación. (2) **Actualización de publicaciones**: el job que publica al canal (en Seller-Center es **Actualización de productos en lote**, `batchteca-notifications`). (3) **Actualización de estados de publicación** (`updateProductsStatus`): el resultado del feed. Tiendanube no tiene el paso (3). |

### Precios y stock

En los canales con flujo batchteca (Seller-Center/Falabella, Mirakl, Liverpool, Amazon, Third Party, Shopify, Tiendanube, Shein, Elektra v2 y Megatone), el flujo se reparte en varias integrations:

1. **Precios** o **Stocks**: solo registra que la notificación se encoló. **No tiene logs**, y aunque haya errores, todavía no se levanta la incidencia.
2. **Actualización de productos en lote** (`batchteca-notifications`): el job que manda las actualizaciones al canal. **Acá está el log de la request al canal**, con precio y stock. En Megatone, Shopify y Liverpool, en lugar de esa integration hay dos separadas: **Actualización de stocks en lote** y **Actualización de precios en lote**.
3. **Resultados de actualización de lotes**, solo en Liverpool, Mirakl, Seller-Center y Amazon (este último hoy inactivo): el job que consulta el estado del bulk o feed. No tiene log de request, pero trae la información del bulk o feed y el error si lo hubo. **El resultado real está acá.**

Para seguir un precio o un stock en estos canales:
```bash
node ${CLAUDE_SKILL_DIR}/cdm.mjs executions <app> --match "precio|stock|productos en lote|resultados" --resource <productId> --hours 6 --date "<cuándo>"
```
`--match` busca también por el nombre de la integration, así que esa regex cubre los 3 pasos (incluidas las de "precios/stocks en lote" de Megatone, Shopify y Liverpool). No uses solo `lote`: también matchea "Importación de ventas en lote". Si el built de la company no trae "Resultados de actualización de lotes" (puede no estar en el built de la company, aunque el canal la use), el resultado del feed se ve en **Actualización de estados de publicación** o no está en el CDM.

### Jobs y `event`

Toda ejecución que sale de un job tiene en `event` el **id del job**. Para traer todo lo que procesó una corrida: `jobs <app> <integration> --days N` para ubicar el job, y después `executions <app> <integration> --event <jobId> --hours ... --date <start_time del job>`. Los jobs también tienen su registro, que sirve para ver si están corriendo bien.

## Precios y bulks

Un cambio de precio no siempre se ve en la integration de "Precios". En los canales con flujo batchteca, el envío está en las integrations "en lote" (ver "Precios y stock" más arriba), con status como `external_bulk_created`. La publicación también incluye el precio (por ejemplo, en el `ProductCreate` de Falabella).

Cuando te pidan "las ejecuciones de precios" de un producto:
1. **Con id de producto:** `changes products <id>` → `change-executions` de cada change relevante. Eso cubre todos los canales.
2. **Además, o sin changes que lo expliquen:** `executions <app> --match "precio|stock|productos en lote|resultados" --resource <id> --hours ≤6 --date ...`, para capturar los flujos en lote del canal.
3. **Sin id de producto:** buscá en `executions <app> products-prices` (y en las de lote) en una ventana corta y tomá el `resource` de lo que aparezca.
4. **Si no aparece nada en las últimas horas:** `jobs <app> <integration> --days 7` muestra cuándo corrieron los jobs y cuántas ejecuciones tuvieron (`successful`, `unsuccessful`, etc.), así sabés dónde centrar `--date`. Las integrations `servicebus` no tienen jobs; las `batch`, sí.

En los bulks, lo que se mandó al canal (el XML o JSON con precio y stock) suele estar en los **logs** (`message.request.body`), y el payload puede venir vacío.

Que una ejecución de precio o stock salga `unsuccessful` no siempre es un error del cambio que estás probando. Estos `error_type` son rechazos esperados por la configuración de la company o del producto:

| `error_type` | Integration | Significa |
|---|---|---|
| `disabled-synchro` | `products-availablequantities` | La company tiene apagada la sincronización de stock en ese canal ("The synchronization is disabled for user <companyId>"). El stock no se manda |
| `product_pricelist_is_locked` | `products-prices` | El producto está restringido por Control de Precios y la lista del canal está bloqueada |
| `restricted_product_integration` | `products-prices` | La integration del producto está `Restricted` por Control de Precios |

## Acciones masivas y bloqueos

Las acciones que no salen de un canal sino de Producteca se registran en la app `1`, con integrations que no aparecen en el built:

| fullId | Qué registra | Cómo leerla |
|---|---|---|
| `spreadsheets\|<nombre del job>` | Una ejecución por producto de una acción masiva de spreadsheets (ej. `spreadsheets\|Product-Update-IsManuallyBlocked-True`, `spreadsheets\|Product-Update-SynchronizeStock-False`) | El `event` es el id del job: `executions 1 "spreadsheets\|<job>" --event <jobId> --hours ...` trae todo el job. Cada ejecución es el resultado del mensaje encolado (por ejemplo, el PUT a la API de productos o el POST a channels-api): como son requests internas, solo hay estado y nunca logs |
| `producteca\|manual-block` | Bloqueo o desbloqueo manual (`isManuallyBlocked`) de un producto o variante | Se registra **solo si el flag cambia**: bloquear algo ya bloqueado no deja ejecución. `resource` = productId, o `productId_variationId` si es por variante. El payload trae `{"action":"blocked"}` o `{"action":"unblocked"}` |

Para seguir una acción masiva de punta a punta:
1. Las ejecuciones del job: `spreadsheets|<nombre del job>` por `--event <jobId>`.
2. El efecto en la entidad: `producteca|manual-block` u otra integration de la app `1` por `--resource <productId>`.
3. Lo que eso disparó hacia cada canal: `executions <app del canal> --match "availablequantities|prices|pause|batch" --resource <productId>`.

Los totales del job (total, exitosos, fallidos y estado) no están en el CDM. Se leen en `GET https://apps.producteca.com/notifications-api/api/jobs/<jobId>`, con la auth de la API de Producteca. El campo `metadata.monitoring.integration` del job trae el `fullId` para buscar en el CDM.

## Publicación en Falabella (Seller-Center): detalle

Es el caso asincrónico en varias integrations de "Dónde queda registrado cada paso según el canal". La publicación tiene tres etapas, cada una en su integration y con su propio eventId:
1. `products-publish`: valida atributos (`GetCategoryAttributes` en los logs) y queda `queued`. Acá **no** está el `ProductCreate`.
2. `batchteca-notifications` (estado `external_bulk_created`): en los **logs** está el `POST ProductCreate` con todos los productos del lote, y la respuesta trae el `RequestId` (= FeedId). Un 200 acá solo dice que Falabella recibió el feed.
3. `updateProductsStatus`: corre cada ~10 min y en el **payload** trae el feed (`feedid`, `finished`, `feed.status`, `feed.failedrecords`, `feed.errors[]` por `sellersku`). El resultado real está acá (ej. `Product Identifier already in use` = el EAN ya está usado en Falabella). Ojo: el `status` y los `errors` del nivel del producto pueden seguir en `pending` / `[]` aunque el feed haya fallado, así que leé `feed.errors`.
