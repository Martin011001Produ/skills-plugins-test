# Core Testing — Ejemplos

Snippets genéricos con placeholders (`{SYSTEM}`, `{TYPE}`). Adaptar rutas e imports al
repositorio host. Todos corren con `npx vitest run`.

## Test de función pura

```javascript
// tests/pagination.spec.js
import { describe, it, expect } from "vitest";
import { resolveSkip, computeNextSkip } from "../{app}/pagination.js";

describe("resolveSkip", () => {
  it("arranca en 0 cuando no hay token", () => {
    expect(resolveSkip(undefined)).toBe(0);
  });

  it("ignora valores no numericos y vuelve a 0", () => {
    expect(resolveSkip({ foo: 1 })).toBe(0);
  });
});

describe("computeNextSkip", () => {
  const pageSize = 50;

  it("avanza a la siguiente página cuando la página vino llena", () => {
    expect(computeNextSkip(0, 50, pageSize)).toBe(50);
  });

  it("termina (undefined) cuando la página no está llena", () => {
    expect(computeNextSkip(50, 12, pageSize)).toBeUndefined();
  });
});
```

## Test de filtro con fecha fija

```javascript
// tests/filters.spec.js
import { describe, it, expect } from "vitest";
import dayjs from "dayjs";
import { buildApprovedFilter } from "../{app}/filters.js";

const config = { approvedDays: 3 };
const now = dayjs("2026-06-30T15:00:00");

describe("buildApprovedFilter", () => {
  const filter = buildApprovedFilter(config, now);

  it("busca ordenes sin integracion de factura", () => {
    expect(filter).toContain("invoiceIntegrationApp eq null");
  });

  it("usa la fecha calculada desde now segun approvedDays", () => {
    expect(filter).toContain("date gt 2026-06-27T03:00:00z"); // now - 3 dias
  });
});
```

## Test de mapper con fixture externa

```javascript
// tests/{system}-catalog.spec.js
import { describe, it, expect } from "vitest";
import catalogMapper from "../utils/mappers/catalogMapper.js";
import item from "./testHelpers/catalogInput.js";
import expectedResult from "./testHelpers/catalogResult.js";

describe("{system}-catalog handler", () => {
  it("catalogMapper should map successfully", () => {
    const config = { defaultWareHouse: "Default", defaultPriceList: "Default", updatableProperties: [] };
    const result = catalogMapper(item, [{ url: "https://example.com/img.jpg" }], config);
    expect(result).toEqual(expect.objectContaining(expectedResult));
  });

  it("should handle null or undefined pictures gracefully", () => {
    const config = { defaultWareHouse: "Default", defaultPriceList: "Default", updatableProperties: [] };
    const result = catalogMapper(item, null, config);
    expect(result).toBeDefined();
  });
});
```

```javascript
// tests/testHelpers/catalogInput.js
export default {
  item_code: "SKU-1",
  item_desc: "Producto de prueba",
  brand_desc: "MarcaX",
  // ...resto de campos que espera catalogMapper
};
```

## Aislar un mapper que importa `baseConfig` directo (singleton)

Técnica 1 — setear env vars antes de requerir el módulo, y `vi.resetModules()` para poder probar más de un escenario de config en el mismo archivo:

```javascript
// tests/{system}-invoice.spec.js
import { it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules(); // fuerza a que el próximo require() reconstruya el singleton de baseConfig
});

it("usa la tasa de IVA default cuando la config la define", async () => {
  process.env.{SYSTEM}_SALES_DEFAULT_TASA_IVA = "21";
  const { mapInvoice } = await import("../utils/mappers/invoice.js");

  const result = mapInvoice({ lines: [{ /* sin taxes propio */ }] });

  expect(result.lines[0].TasaIVA).toBe(21);
});

it("usa la tasa de IVA propia de la línea cuando está presente, sin depender de la config", async () => {
  delete process.env.{SYSTEM}_SALES_DEFAULT_TASA_IVA; // ni hace falta setearla para este caso
  const { mapInvoice } = await import("../utils/mappers/invoice.js");

  const result = mapInvoice({ lines: [{ taxes: [{ name: "IVA", value: 10.5 }] }] });

  expect(result.lines[0].TasaIVA).toBe(10.5);
});
```

Técnica 2 — evitar el problema directamente, dándole al fixture el dato que de otra forma vendría del default de la config:

```javascript
// en vez de depender de {SYSTEM}_SALES_DEFAULT_TASA_IVA sin setearla (lo que tiraría error),
// el fixture ya trae taxes explícito — el mapper nunca llega a necesitar el default:
const fixtureConTaxesExplicito = {
  lines: [{ taxes: [{ name: "IVA", value: 21 }] }],
};
```

## Cuánto testear un mapper — tamaño correcto vs. sobre-testeo

El ejemplo de `catalogMapper` de arriba (2 tests: camino feliz + `pictures` nulo) es el tamaño
correcto para un mapper simple. **No** seguir agregando tests por cada variación de dato que se
le ocurra a quien escribe el test si no cambia lo que se manda al sistema externo:

```
✓ Correcto (3-6 tests): camino feliz, 1-2 casos de dato faltante/nulo que el código maneja
  explícitamente, y como mucho un caso de tipo de dato inesperado si el mapper lo castea.

✗ Sobre-testeo: un test separado para "nombre de provincia con tilde", otro para "docType en
  minúsculas", otro para "objeto con propiedades en otro orden", etc. — si el sistema externo
  no distingue esos casos o el código no tiene una rama específica para manejarlos, no ameritan
  test propio. Multiplicar archivos de test así no agrega cobertura real, solo ruido.
```

## Test con `vi.spyOn` sobre una clase API

Estilo `it` plano, sin `describe`, uno por método de la clase.

```javascript
// tests/{system}-invoicer.spec.js
import { it, expect, vi } from "vitest";
import {System}InvoicerApi from "../utils/api/{system}InvoicerApi.js";

it("createGuid", async () => {
  const userConfig = { url: "test-url" };
  const api = new {System}InvoicerApi(userConfig);
  const mockGuid = "fixed-guid";

  const postSpy = vi.spyOn(api, "post").mockResolvedValue({
    dataResponse: { dataResult: `<NewDataSet><Table><guid>${mockGuid}</guid></Table></NewDataSet>` },
  });

  const guid = await api.createGuid("test-token");
  expect(guid).toBe(mockGuid);

  postSpy.mockRestore(); // restaurar el spy explícitamente al final de cada test
});

it("createPayments", async () => {
  const userConfig = { url: "test-url" };
  const api = new {System}InvoicerApi(userConfig);

  const postSpy = vi.spyOn(api, "post").mockResolvedValue({});
  await api.createPayments("test-token", "test-guid", "test-customer-id", { id: 1 });

  expect(postSpy).toHaveBeenCalled();
  postSpy.mockRestore();
});
```

## Mockeando `ProductecaSdk`: no se crea, ya existe como global

El repo de la app **nunca** arma ni importa el objeto `ProductecaSdk` — lo hace el servidor de
apps genéricas y lo deja seteado como global antes de cada test, tal como `code-executor` lo
inyecta en runtime real. `opeUtils` llega igual de armado (instancia real, no mock). El test solo
asigna el método puntual del SDK que necesita:

```javascript
// tests/handler.spec.js
import { it, expect, vi } from "vitest";
import { handler } from "../{app}/run.js";

it("escribe la nota en la orden que recibe", async () => {
  ProductecaSdk.salesOrdersApi.update = vi.fn().mockResolvedValue({});

  await handler({ resource: { body: { id: 147238376, isCanceled: false } } });

  expect(ProductecaSdk.salesOrdersApi.update).toHaveBeenCalledWith(147238376, {
    notes: expect.stringContaining("147238376"),
  });
});

it("corta la ejecucion si la orden ya esta facturada", async () => {
  const salesOrder = { id: 1, invoiceIntegration: { app: "{system}" } };

  // el handler nunca llega a llamar al SDK en esta rama: no hace falta stubear nada
  await expect(handler({ resource: salesOrder })).rejects.toMatchObject({
    code: "IgnoredInvoiceByUserConfiguration",
  });
});
```

No hace falta declarar de antemano el "shape" del SDK ni limpiar el stub al final del test: el
mock se reconstruye entero antes de cada test. Si el handler llama a un método del SDK que el
test no stubeó, el mock tira un error nombrando el path completo en vez de un
`undefined is not a function` genérico:

```
Error: ProductecaSdk.productsApi.get is not stubbed. Assign a stub to it in your test before calling it.
```

La implementación de ese mock vive en el servidor de la plataforma, no en esta skill ni en el
repo de la app — no copiarla ni recrearla localmente, porque puede cambiar ahí sin que esta skill
se entere. Lo único que un `.spec.js` necesita saber es el comportamiento observable de arriba:
cualquier path del SDK se puede stubear sin declararlo antes, y lo que no se stubea explota con
un mensaje que dice exactamente qué faltó.

## Bootstrap local: correr `npx vitest run` fuera de la plataforma

Ver reference.md §1.1 para el contrato completo. Tres archivos, ninguno pisa al mock real de la
plataforma porque nunca conviven en el mismo checkout:

```javascript
// tests/setup/localProductecaSdkMock.js — SE COMMITEA
import { beforeEach } from "vitest";

// Solo se activa si vitest.config.mjs existe localmente (gitignoreado a proposito, ver .gitignore).
// Sin ese config, este archivo no lo referencia nadie y no corre.
function createSdkStub(path) {
  const target = function () {};
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === "then" || typeof prop === "symbol") return undefined;
      const child = createSdkStub(`${path}.${String(prop)}`);
      obj[prop] = child;
      return child;
    },
    apply() {
      throw new Error(`${path} is not stubbed. Assign a stub to it in your test before calling it.`);
    },
  });
}

// opeUtils real es una instancia con logica de negocio (isMinId/genericFilter/addFullProduct, etc),
// no un stub por metodo como ProductecaSdk. No podemos reconstruir esa logica aca, asi que salvo las
// dos excepciones de abajo (shape de error fijo y documentado en core-ope-utils), cada test tiene que
// asignar a mano el metodo puntual que su handler llame, igual que con ProductecaSdk.
function createOpeUtilsStub() {
  const stub = createSdkStub("opeUtils");
  stub.ignoreOrder = (reason) => {
    throw { code: "IgnoredInvoiceByUserConfiguration", statusCode: 409, error: reason || "Venta ignorada por configuración del usuario" };
  };
  stub.error = (code, message) => {
    throw { code, error: message, statusCode: 400 };
  };
  return stub;
}

beforeEach(() => {
  globalThis.ProductecaSdk = createSdkStub("ProductecaSdk");
  globalThis.opeUtils = createOpeUtilsStub();
});
```

```javascript
// tests/setup/vitest.config.example.mjs — SE COMMITEA (vive junto al mock, no en la raíz: nada
// lo lee directamente, solo se copia)
// Bootstrap local: copiar este archivo a vitest.config.mjs EN LA RAÍZ del repo (gitignoreado, ver
// .gitignore) para poder correr `npm test` de forma aislada, sin depender del ProductecaSdk real
// de la plataforma. Extension .mjs a proposito: el repo es CommonJS (sin "type": "module" en
// package.json) y Vitest necesita cargar este config como ESM.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup/localProductecaSdkMock.js"],
  },
});
```

```
# .gitignore — agregar esta línea (con el comentario, para que no se pierda el motivo)

# Config local de Vitest: arma el mock de ProductecaSdk/opeUtils para poder correr `npm test` de
# forma aislada. Nunca debe subirse: en CI/produccion el global real lo provee la plataforma, y si
# este archivo se commitea competiria contra ese mock real. Bootstrap: cp tests/setup/vitest.config.example.mjs vitest.config.mjs
vitest.config.mjs
```

Bootstrap por dev, una sola vez por checkout (el destino va a la raíz del repo, ahí es donde
Vitest busca el config por default):

```bash
cp tests/setup/vitest.config.example.mjs vitest.config.mjs
```

## Cualquier librería de terceros distinta de `ProductecaSdk`/`opeUtils`: siempre `require()`

Ver reference.md §1.2. No hace falta ningún bootstrap ni stub especial para este caso — es
simplemente una dependencia normal, requerida donde se usa:

```javascript
// {app}/datasource.js (o donde corresponda)
const {libraryName} = require("{library-package}"); // nunca asumida como bare global
```

```json
// package.json — dependencia real (nunca devDependency: la usa código de producción)
{
  "dependencies": {
    "{library-package}": "^{version}"
  }
}
```

## Comandos

```bash
# Correr todos los tests del repo
npx vitest run

# Correr un archivo puntual
npx vitest run tests/{system}-invoicer.spec.js

# Watch mode mientras se desarrolla
npx vitest
```
