---
name: syncer
description: >-
  Sincronización de stock/precio/impuestos de productos hacia Producteca vía
  ProductecaSdk.ProductsSyncer.runSynchro, paginada o no según el sistema origen. Usar al
  crear o tocar un handler `run.js` de tipo {SYSTEM}-price/{SYSTEM}-stock/{SYSTEM}-taxes.
  NO cubre órdenes de venta (ver skill `/generic-apps:orders-syncer`, que usa ProductecaSdk.OrdersSyncer.runSynchro).
---

# Syncer — Sincronización de Productos (Stock / Precio / Impuestos)

## Skills relacionadas

- `/generic-apps:core-base-config` → `firstPage`/`pageSize`, `$updatableProperties` y filtros dinámicos viven en `baseConfig.js`.
- `/generic-apps:core-axios-api` → cuando el sistema origen se consume por REST/OData (no aplica si habla SOAP u otro protocolo propio).
- `/generic-apps:core-testing` → convención de tests para mappers/services (nunca para `runSynchro`).
- `/generic-apps:project-context-writer` → configura la regla de cargar `/generic-apps:index` siempre primero; se corre una sola vez por repo, no en cada tarea.

## Objetivo

1. Construir el handler que arma `items` (`partialProduct[]`) + `nextPaginationToken` y llama a `ProductecaSdk.ProductsSyncer.runSynchro`, eligiendo entre variante paginada o no paginada según el sistema origen.
2. Mapear `sku`/`prices`/`stocks`/`taxes` con casting numérico correcto y `$updatableProperties` dinámico desde `baseConfig`.

## Convenciones

| Item | Regla |
|---|---|
| Import del SDK | `ProductecaSdk` nunca se importa; es global inyectado por `code-executor` |
| Estructura del handler paginado | `fetchPage()` como función interna que resuelve la página y arma `{ nextPaginationToken, items }`; `runSynchro` se llama **después**, fuera de `fetchPage`, nunca adentro. Es la forma en que `code-executor` reconoce el ciclo de paginado — ver reference.md §1 |
| `firstPage`/`pageSize` | Se leen de `baseConfig` **a nivel de módulo** (fuera del `handler`), no recalculados en cada invocación |
| Cierre del loop | `nextPaginationToken` en `null` o `undefined` detiene la reinvocación |
| Token de entrada | Puede llegar como Number, String u objeto `{ paginationToken }` — resolver con lodash |
| `createIfItDoesntExist` / `noStockIfDiscontinued` | Siempre un objeto `settings` explícito con ambas claves. Default `false`; configurable desde `baseConfig` cuando el negocio lo justifica, pero nunca se omiten ni se hardcodea `true` sin una razón documentada |
| Estado entre ejecuciones (token de auth que expira, etc.) | Persistir con `ProductecaSdk.kvs.getIntegrationSettings()` / `updateIntegrationSettings(...)` dentro de `fetchPage`, nunca en una variable de módulo que no sobreviva reinicios |

## Estructura de archivos

```
{repo}/
├── {SYSTEM}-price/run.js
├── {SYSTEM}-stock/run.js
├── {SYSTEM}-taxes/run.js           ← opcional, no todo sistema origen lo requiere
└── utils/
    ├── baseConfig.js
    ├── mappers/toPartialProduct{Price,Stock,Taxes}.js
    └── services/partialProduct{Price,Stock,Taxes}.js
```

## Flujo típico

1. Leer [reference.md](reference.md) para el contrato de datos y el patrón de paginación.
2. Usar [examples.md](examples.md) para copiar el handler y el mapper más cercano al caso (stock paginado, precio no paginado, con estado persistido entre ejecuciones, etc.).
3. Confirmar contra el sistema origen si realmente hay paginación. Si el sistema devuelve todo en una sola llamada, omitir `fetchPage()`/`nextPaginationToken` y llamar a `runSynchro` una sola vez. Si pagina, usar **siempre** el wrapper `fetchPage()` del ejemplo 1 como estructura por defecto — no un handler "aplanado" que resuelva todo inline y llame a `runSynchro` en el mismo bloque que la resolución del token.
4. Antes de considerar la tarea terminada: escribir/actualizar los tests correspondientes (`/generic-apps:core-testing`, siempre — incluso si el archivo tocado no tenía tests antes).
