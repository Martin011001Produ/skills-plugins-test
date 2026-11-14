# Syncer — Ejemplos

Snippets genéricos con placeholders (`{SYSTEM}`, `{TYPE}`, `{SERVICE_FUNCTION}`). Adaptar nombres, imports y manejo de errores al repositorio host.

## 1. Handler paginado — estructura canónica con `fetchPage`

Esta es la forma por defecto para cualquier syncer paginado. `firstPage`/`pageSize` se leen de `baseConfig` a nivel de módulo; `fetchPage` devuelve solo `{ nextPaginationToken, items }`; `runSynchro` se llama después, afuera de `fetchPage`:

```javascript
const _ = require("lodash");
const config = require("../utils/baseConfig.js");
const { {SERVICE_FUNCTION} } = require("../utils/services/{SERVICE_FILE}.js");

const firstPage = config.{system}.{type}.firstPage;
const pageSize = config.{system}.{type}.pageSize;

async function handler(event) {
   try {
      const fetchPage = async () => {
         const currentPage = _.toInteger(_.isObject(event?.paginationToken)
            ? _.get(event, "paginationToken.paginationToken")
            : event?.paginationToken)
            || _.toInteger(firstPage);

         const { partialProducts, nextPaginationToken } = await {SERVICE_FUNCTION}(currentPage, pageSize);
         console.log("partialProducts", JSON.stringify(partialProducts.slice(0, 5), null, 2), "nextPaginationToken", nextPaginationToken);

         return { nextPaginationToken, items: partialProducts };
      };

      const { items, nextPaginationToken } = await fetchPage();
      return await ProductecaSdk.ProductsSyncer.runSynchro({
         items,
         nextPaginationToken,
         settings: {
            createIfItDoesntExist: false,
            noStockIfDiscontinued: false
         }
      });
   } catch (error) {
      throw new Error(`Failed to fetch data: ${error.message || error.data}`);
   }
}

module.exports = { handler };
```

## 2. Handler sin paginado

Cuando el sistema origen devuelve todo en una sola llamada (por ejemplo, un servicio sin paginado nativo), no hay `fetchPage()` ni `nextPaginationToken`. Try/catch idéntico al del ejemplo 1, omitido aquí por brevedad:

```javascript
const {SYSTEM}Api = require("../utils/api/{system}Api.js");
const priceService = require("../utils/services/partialProductPrice.js");
const loginService = require("../utils/services/authService.js");
const { {system} } = require("../utils/baseConfig.js");

async function handler(event) {
   const client = new {SYSTEM}Api({system});
   const token = await loginService(client);
   const items = await priceService(client, token);
   return await ProductecaSdk.ProductsSyncer.runSynchro({
      items,
      settings: { createIfItDoesntExist: false, noStockIfDiscontinued: false }
   });
}
module.exports = { handler };
```

## 3. Variante sin wrapper (el sistema origen no expone `pageSize`, solo `hasMore`)

Excepción aceptada cuando la API origen pagina por bandera booleana en vez de tamaño de página fijo. `settings` sale de `baseConfig` en vez de estar hardcodeado — también válido:

```javascript
const config = require("../utils/api/config.js");
const { fetch{System}Page } = require("../utils/api/fetch{System}Page.js");
const { map{Type} } = require("../utils/mappers/map{Type}.js");

async function handler(event) {
   try {
      const currentPage = _.toInteger(_.isObject(event?.paginationToken)
         ? _.get(event, "paginationToken.paginationToken")
         : event?.paginationToken) || 1;

      const { items: externalItems, hasMore } = await fetch{System}Page(currentPage);
      const items = externalItems.flatMap(map{Type});
      const nextPaginationToken = hasMore ? currentPage + 1 : undefined;

      return await ProductecaSdk.ProductsSyncer.runSynchro({
         items,
         nextPaginationToken,
         settings: {
            createIfItDoesntExist: config.createIfItDoesntExist,
            noStockIfDiscontinued: config.noStockIfDiscontinued
         }
      });
   } catch (error) {
      const details = error?.response?.data
         ? JSON.stringify(error.response.data)
         : error.message || error.data;
      throw new Error(`Failed to fetch data from {System} (status ${error?.response?.status ?? "unknown"}): ${details}`);
   }
}

module.exports = { handler };
```

## 4. Estado persistido entre ejecuciones (token que expira, vía `ProductecaSdk.kvs`)

Cuando la autenticación usa un token que expira, no se puede guardar en una variable de módulo — cada invocación puede correr en una instancia nueva. Se persiste con `ProductecaSdk.kvs`:

```javascript
const _ = require("lodash");
const config = require("../utils/baseConfig.js");
const axiosApi = require("../utils/api/axiosApi.js");

const firstOffset = 0;
const pageSize = 50;

const fetch{System}Page = async (token, offset) => {
   const activeToken = _.get(token, "valid") ? _.get(token, "authToken", "") : config.fallbackToken;
   return axiosApi.request({
      method: "GET",
      url: `${config.baseUrl}?Limit=${pageSize}&Offset=${offset}`,
      headers: { "{system}-token": activeToken }
   }).catch(async (err) => {
      const message = _.get(err, "response.data.Errors[0].Message");
      if (message === "El token no es válido.") {
         await ProductecaSdk.kvs.updateIntegrationSettings({ valid: false });
         opeUtils.error("token_error", "El token ya no es válido. Debe solicitar uno nuevo");
      }
      opeUtils.error("external_error", _.get(err, "response.data") || err.message || err);
   });
};

async function handler(event) {
   try {
      const fetchPage = async () => {
         const offset = (_.isObject(event?.paginationToken)
            ? _.get(event, "paginationToken.paginationToken")
            : event?.paginationToken) || firstOffset;

         const token = await ProductecaSdk.kvs.getIntegrationSettings();
         const data = await fetch{System}Page(token, offset);
         const nextPaginationToken = data.items.length > 0 ? offset + pageSize : undefined;

         await ProductecaSdk.kvs.updateIntegrationSettings({
            authToken: _.get(data, "headers.{system}-token") || _.get(token, "authToken"),
            valid: true
         });

         return {
            nextPaginationToken,
            items: data.items.map(item => ({
               sku: item.sku.trim(),
               stocks: [{ warehouse: config.warehouseName, quantity: item.stock }]
            }))
         };
      };

      const { items, nextPaginationToken } = await fetchPage();
      return await ProductecaSdk.ProductsSyncer.runSynchro({
         items,
         nextPaginationToken,
         settings: { createIfItDoesntExist: false, noStockIfDiscontinued: false }
      });
   } catch (error) {
      opeUtils.error("fetch_data_error", `Failed to fetch data: ${error.message || error.data}`);
   }
}

module.exports = { handler };
```

## 5. Normalización defensiva de la respuesta

Cuando no se sabe de antemano en qué forma exacta el cliente HTTP entrega la lista (`.data`, `.value`, `.data.value`), probar candidatos en orden en vez de asumir una única forma:

```javascript
const candidates = [response, response?.data, response?.value, response?.data?.value];
const items = candidates.find(Array.isArray) || [];
const nextPaginationToken = items.length > 0 ? currentPage + 1 : undefined;
```

## 6. Mapper de stock: agrupación por SKU + filtro dinámico

Cuando el sistema origen devuelve una fila por combinación (sku, depósito), agrupar antes de mapear a `partialProduct`:

```javascript
const _ = require("lodash");
const { warehouses, stocksFilter, updatableProperties } = require("../baseConfig").{system}.stocks;
// stocksFilter = eval(process.env.{SYSTEM}_STOCKS_FILTER || "(item) => true")

module.exports = (stockRows) => {
   const filtered = stockRows.filter(stocksFilter);
   const grouped = _.groupBy(filtered, row => row["{SKU_FIELD}"].trim());
   return Object.entries(grouped).map(([sku, rows]) => ({
      sku,
      stocks: rows.map(row => ({
         warehouse: warehouses[row["{WAREHOUSE_FIELD}"]],
         quantity: parseFloat(row["{QUANTITY_FIELD}"]),
      })),
      $updatableProperties: updatableProperties
   }));
};
```

## 7. Mapper de precio + stock: disponible neto de reservas y `currency`

Cuando el sistema origen expone stock total, reservas y comprometidos por separado, calcular el disponible neto en vez de propagar el stock bruto:

```javascript
const totalStock = ({TYPE}.warehouseInfo || [])
   .filter(w => warehousesMap[w.warehouseCode?.toString?.()])
   .reduce((acc, w) => acc + (parseInt(w?.inStock) || 0), 0);
const stocks = [{
   warehouse: "Default",
   quantity: parseInt(totalStock) - (parseInt({TYPE}?.reserved) || 0) - (parseInt({TYPE}?.committed) || 0)
}];
const prices = ({TYPE}.prices || [])
   .filter(p => priceListsMap[p.priceListCode?.toString?.()])
   .map(p => ({
      amount: Number(Number(p.amount).toFixed(2)),
      priceList: priceListsMap[p.priceListCode?.toString?.()],
      currency: p.currency === "USD" ? "Usd" : "Local"
   }));
```

## 8. Mapper de impuestos (`taxes`)

Tipo de syncer separado de stock/precio: mismo contrato de `partialProduct`, pero solo puebla `taxes[]`.

```javascript
const normalizeTax = (value) => {
   const parsed = Number(value);
   return Number.isFinite(parsed) ? parsed : 0;
};
module.exports = (items) => items.filter(taxesFilter).map(item => ({
   sku: item["{SKU_FIELD}"].trim(),
   taxes: [
      { name: "IVA", value: normalizeTax(item["{IVA_FIELD}"]) },
      { name: "IMP_INT", value: normalizeTax(item["{IMP_INT_FIELD}"]) },
   ],
   $updatableProperties: updatableProperties,
}));
```

## 9. Objeto `partialProduct` completo de referencia

```javascript
const partialProduct = {
  sku: "unSku",
  code: "unCodigo",
  notes: "las notas del producto",
  name: "el titulo",
  brand: "la marca",
  category: "categoria interna de Producteca",
  buyingPrice: 999.99,
  barcode: "un upc o un ean",
  pictures: [{ url: "http://ejemplo.com/foto.jpg" }],
  prices: [{ priceList: "Default", amount: 999, currency: "Local" }],
  stocks: [{ warehouse: "Default", quantity: 0, availableQuantity: 0 }],
  taxes: [{ name: "IVA", value: 21 }],
  variationAttributes: [{ key: "Color", value: "amarillo" }],
  size: "el talle", // atajo alternativo a variationAttributes, solo para la variante de talle
  primaryColor: "el color", // atajo alternativo a variationAttributes, solo para la variante de color
  dimensions: { weight: 1000, width: 1, length: 2, height: 2, pieces: 1 },
  attributes: [{ key: "Linea", value: "HP" }, { key: "Condicion", value: "Nuevo" }], // atributos generales, no de variante
  $updatableProperties: ["stocks", "prices"]
};
```

## 10. Tests (Vitest)

Cubrir solo mappers y services (ver `/generic-apps:core-testing`); `runSynchro` no se testea porque el SDK es un global inyectado por `code-executor`. El mecanismo de paginación (resolución de token de entrada y cálculo del próximo token) sí puede testearse como funciones puras, sin mockear el SDK.
