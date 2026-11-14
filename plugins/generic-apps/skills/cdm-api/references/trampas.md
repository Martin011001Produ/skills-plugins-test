# Trampas

Leelo antes de concluir que algo no pasó o cuando una consulta devuelva vacío o algo raro.

## Ventanas de tiempo

- **Las fechas sin zona se toman en UTC**, igual que los `timestamp` del CDM (`2026-10-01 20:39:19.333`). Copiá el timestamp de la ejecución tal cual a `--date`. Si el usuario te da una hora de Argentina, convertila (+3 h) o agregá `-03:00`.
- **`--hours` es una ventana hacia atrás** desde `--date` (o desde ahora); se escribe positivo (`--hours 3`). Para algo de ayer, usá `--date` = el fin del rango que te interesa.
- **`--hours` trabaja por horas enteras, no por minutos.** Toma las horas completas que toca la ventana: con `--date "2026-10-07T13:30:00Z" --hours 1` trae todo lo de las 12 y las 13 (de 12:00 a 13:59), aunque la ejecución sea de las 13:55. Si necesitás un rango exacto, filtrá por `timestamp` en la respuesta.
- **Por `--event`:** igual hace falta `--hours`; centrá `--date` cerca del evento.
- **`--days` en changes:** sin `--date` es `[ahora - N días, ahora]`; con `--date` es `[date, date + N días]`.
- **`logs` y `payload` exigen `--date`.** Usá el `timestamp` exacto de la ejecución: la consulta busca en las particiones horarias alrededor de esa fecha. Con otra fecha devuelve vacío.

## Qué devuelve una consulta

- **Athena reutiliza resultados hasta 10 min.** El CDM guarda el resultado de cada query exacta y lo devuelve durante 10 minutos, así que una consulta repetida puede no mostrar ejecuciones recién creadas. Cada combinación de filtros tiene su propio caché: con `--resource` y sin `--resource` pueden "envejecer" distinto y mostrar cosas diferentes. El CLI manda `Cache-Control: no-cache` en `executions`, `logs`, `payload` y `jobs` cuando no hay `--date` o cuando la fecha cae en las últimas 2 horas. Para una fecha más vieja, `--fresh` lo fuerza. Sirve, por ejemplo, para volver a pedir logs que todavía estaban llegando.
- **`--resource` es una búsqueda por subcadena** (LIKE) sobre `resource` y `externalreference`: buscar `178866604` también trae `178866604/xxx` y cualquier id que lo contenga. Revisá el `resource` de cada ejecución.
- **Tope de 1000 ejecuciones por consulta**, ordenadas de la más nueva a la más vieja y paginadas de a 25. En integrations con mucho volumen, las más viejas de la ventana pueden quedar afuera: acotá con `--resource`, `--event` o menos horas.
- **Paginación:** si viene `nextToken`, repetí el mismo comando con `--token <nextToken>`.
- **Las ejecuciones `pending`/`queued` no aparecen** salvo que pidas `--status pending,queued`. Si las pedís, la misma ejecución (mismo `id`) sale dos veces, una `pending` y otra con el estado final: el resultado es la de `timestamp` más reciente.
- **`--status` es una lista blanca: lo que no nombrás, no aparece.** Además de `successful`/`unsuccessful` hay estados propios de cada flujo, como `external_bulk_created` en `batchteca-notifications`. Con `--status ok,error,pending,queued` esa ejecución queda afuera, aunque sea justo la que tiene el envío al canal. Para ver todo, hacé dos consultas: una **sin `--status`** (estados finales, cualquiera sea) y otra con `--status pending,queued`.
- Por defecto, `executions` devuelve solo campos core. Usá `--full` si necesitás el producto, la venta o la company enriquecidos.
- **El CLI corta a los 60 s** si el CDM no responde. Si pasa, acotá la consulta (menos horas, `--resource` o `--event`) o reintentá más tarde.
- El built se cachea 10 min del lado del server.

## Antes de concluir

- **Vacío no significa que no pasó.** Antes de concluir eso, revisá la ventana de tiempo, que la integration sea la correcta (precios vs stock vs ventas), la company (`--company` en changes), el status y el caché (ver arriba).
- **El `fullId` del built puede no coincidir con el que graban las ejecuciones.** Pasó con Falabella Perú: el built decía `falabella-pe|updateProductStatus` y las ejecuciones se grababan como `falabella-pe|updateProductsStatus` (ya corregido en Mongo). Consultar el id del built devolvía 0 sin error. Si una integration que debería tener actividad devuelve 0 incluso sin `--resource`, sospechá del nombre y pedile al usuario el `integration` exacto de una ejecución que vea en la UI del CDM.
- **`change-executions` vacío en una publicación no significa que no se publicó.** El change de alta de la integración (`integration_created_by_<app>`) es un efecto de la publicación, no su disparador: la publicación (`products-publish`), el envío en lote (`batchteca-notifications`) y cada consulta de estado tienen su propio eventId, y el change suele venir con `parentEventId` vacío. Lo único que cuelga del change son precio y stock, y si quedaron `queued` el CDM los oculta. Entrá por `executions <app> --match "publish|batch|status" --resource <productId>` en la ventana del change.

- **Changes que no se registran:** en la company 34796 (cuenta de test interna) `changes` siempre devuelve `[]`, aunque el producto cambie. No se sabe por qué y es la única con ese problema. Ahí entrá siempre por `executions`.
- **`resource` con `404 entity_not_found`** ("El productdefinition no existe") suele significar que el producto es de otra company, no que no exista. Revisá con qué company consultaste.
