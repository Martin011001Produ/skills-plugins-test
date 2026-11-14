# Syncer — Reference

Contrato técnico y reglas obligatorias para sincronizar productos hacia Producteca.

## 1. Estructura obligatoria del handler paginado

`code-executor` reconoce el ciclo de paginado por la **forma exacta** del handler, no solo por el valor de retorno. La estructura correcta es siempre:

1. `firstPage`/`pageSize` se leen de `baseConfig` a nivel de módulo (fuera del `handler`), no en cada invocación.
2. Todo el cuerpo del `handler` va envuelto en un único `try/catch`.
3. Adentro del `try`, se define `fetchPage` como función interna (`const fetchPage = async () => {...}`). `fetchPage` resuelve la página actual, llama al service, y devuelve **exclusivamente** `{ nextPaginationToken, items }` — nunca incluye `settings` en ese retorno.
4. Después de `await fetchPage()`, se desestructura `{ items, nextPaginationToken }` y **recién ahí**, fuera de `fetchPage`, se arma y retorna la llamada a `ProductecaSdk.ProductsSyncer.runSynchro({ items, nextPaginationToken, settings })`.
5. `runSynchro` nunca se llama desde adentro de `fetchPage`, ni `fetchPage` se omite reemplazándolo por lógica de paginado "aplanada" en el cuerpo del `handler` — aunque el resultado final sea equivalente, la forma con `fetchPage` es la que garantiza que el ciclo de paginado se reconozca correctamente.

El token de entrada (`event.paginationToken`) puede llegar como Number, String, o como un objeto `{ paginationToken: valor }` — resolverlo siempre de forma defensiva, nunca asumiendo un único tipo:

```javascript
const _ = require("lodash");

const currentPage = _.toInteger(
  _.isObject(event?.paginationToken)
    ? _.get(event, "paginationToken.paginationToken")
    : event?.paginationToken
) || _.toInteger(firstPage);
```

El `nextPaginationToken` de salida tampoco está atado a un tipo único: puede ser un número de página, un offset/`$skip`, o un cursor opaco (string) según el mecanismo de paginación del sistema origen. Lo único obligatorio es que, cuando no queden más páginas, sea `null` o `undefined`.

**Excepción documentada:** cuando el sistema origen no expone `pageSize` (solo devuelve una bandera tipo `hasMore`/`hasNextPage`), es aceptable omitir el wrapper `fetchPage` y resolver todo inline en el `handler`, siempre que se mantenga el resto del contrato (try/catch, `nextPaginationToken` calculado antes de llamar a `runSynchro`, `settings` explícito). Ver examples.md, variante "sin wrapper".

## 2. Estructura de datos (`partialProduct`)

- `sku` (String, obligatorio): identificador único de variante en el sistema origen. Si el sistema devuelve campos de ancho fijo con padding, normalizar (trim) antes de asignar.
- `code` (String, opcional): identificador a nivel publicación; permite agrupar variantes que deben crearse juntas.
- `prices[]`: `{ priceList, amount, currency? }`. `amount` DEBE ser `Number` — nunca dejar pasar un string sin castear.
- `stocks[]`: `{ warehouse, quantity, availableQuantity? }`. `quantity`/`availableQuantity` DEBEN ser `Number`. Si el sistema origen expone reservas o comprometidos por separado, calcular el disponible neto (`quantity = totalStock - reservado - comprometido`) en vez de propagar el stock bruto.
- `taxes[]`: `{ name, value }`. `value` DEBE normalizarse a `Number`, con fallback a `0` si el valor de origen no es finito.
- `$updatableProperties`: array de strings que define qué campos se permite actualizar. Siempre se lee desde `baseConfig`, nunca hardcodeado en el mapper.

Todos los campos de `partialProduct` son opcionales salvo `sku`. Ver `examples.md` para el objeto completo de referencia (notas, nombre, marca, fotos, dimensiones, atributos, etc.).

## 3. Contrato de salida (SDK)

```javascript
return await ProductecaSdk.ProductsSyncer.runSynchro({
  items,                // partialProduct[]
  nextPaginationToken,  // valor finito, o null/undefined para terminar
  settings: {
    createIfItDoesntExist: false,
    noStockIfDiscontinued: false,
  },
});
```

`settings` es siempre un objeto explícito con ambas claves presentes — nunca se omite ni se arma parcialmente. `createIfItDoesntExist` y `noStockIfDiscontinued` DEBEN default a `false`. Es igual de válido hardcodear `false` en el `run.js` que leerlos desde `baseConfig` para hacerlos configurables por sistema origen (ej. `settings: { createIfItDoesntExist: config.{system}.createIfItDoesntExist, noStockIfDiscontinued: config.{system}.noStockIfDiscontinued }`) — lo que nunca debe pasar es hardcodear `true` como valor fijo sin que sea una decisión de negocio explícita y documentada en `baseConfig`.

## 4. Paginación y cierre del loop

Antes de escribir `fetchPage()`, confirmar contra el sistema origen si realmente pagina. No hay que asumir que todo syncer pagina:

- **Sin paginado:** si el sistema devuelve todos los registros en una sola respuesta, omitir `fetchPage()` y `nextPaginationToken` por completo. Obtener los items de una sola llamada y pasar solo `items` a `runSynchro`.
- **Paginado por offset/página:** `currentPage`/`$skip` numérico más `pageSize` desde config. `nextPaginationToken = items.length >= pageSize ? currentOffset + pageSize : undefined`.
- **Paginado por cursor/token opaco:** el sistema origen devuelve su propio token de continuación (por ejemplo, un `$skiptoken` OData o un `nextLink`); propagarlo tal cual como `nextPaginationToken` en vez de reconstruirlo.
- **Cierre:** cuando la página viene vacía o más chica que `pageSize`, `nextPaginationToken` debe quedar en `undefined` o `null` para detener el loop del consumidor.

## 5. Estado persistido entre ejecuciones (`ProductecaSdk.kvs`)

Cuando la autenticación contra el sistema origen usa un token que expira y se refresca (en vez de credenciales estáticas), ese token no puede guardarse en una variable de módulo — cada invocación del `handler` puede correr en una instancia distinta de `code-executor`. Para este caso, `ProductecaSdk` expone un namespace de key-value store inyectado:

- `ProductecaSdk.kvs.getIntegrationSettings()`: devuelve el último estado guardado (ej. `{ token, valid, date }`).
- `ProductecaSdk.kvs.updateIntegrationSettings(patch)`: persiste el estado nuevo para la próxima invocación.

Patrón: dentro de `fetchPage`, leer el estado antes de autenticar, usar el token guardado si es válido (o el fallback de config si no), y actualizar el estado con el token (posiblemente refrescado) que devuelva la respuesta del sistema origen — antes de retornar `{ nextPaginationToken, items }`. Igual que `ProductecaSdk.ProductsSyncer`, `kvs` nunca se importa: es un global inyectado.

## 6. Alcance y límites

- No cubre sincronización de órdenes de venta (`ProductecaSdk.OrdersSyncer.runSynchro`) — eso es la skill `/generic-apps:orders-syncer`.
- No cubre facturación (`/generic-apps:invoicer`) ni logística (`/generic-apps:courier`).
- No valida ni testea `runSynchro` en sí: el SDK es un global inyectado por `code-executor`, así que los tests unitarios llegan hasta services/mappers (ver `/generic-apps:core-testing`).
- Un filtro dinámico tipo `eval(process.env.{X}_FILTER || "(item) => true")` es un patrón válido para habilitar exclusión configurable de items sin redeploy, pero implica `eval()` sobre una env var — riesgo a tener en cuenta al implementarlo, no una recomendación de diseño por defecto.
