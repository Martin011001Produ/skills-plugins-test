# Core Testing — Reference

Contrato técnico de testing del ecosistema. Sin ejemplos de código — ver examples.md.

## 0. Regla no negociable: los tests no son opcionales

Escribir o actualizar tests es parte de la tarea, no un paso posterior ni algo que depende de si el repo "ya tenía cultura de testing". Aplica siempre, sin excepción:

- **Código nuevo** (app, mapper, service, handler): se entrega con sus tests. No hay versión "primero funciona, después testeo".
- **Código existente que se toca**, tenga o no tests hoy: el archivo modificado sale de esa tarea con cobertura de lo que cambió, aunque el resto del repo no tenga ningún test. No se posterga "para otra tarea" ni se deja como deuda técnica silenciosa — si de verdad no es viable en el momento, decirlo explícitamente al usuario en vez de omitirlo sin aviso.
- **Obligatorio no significa exhaustivo.** El mínimo esperado es el esencial de §6: lo que cambia el resultado hacia el sistema externo. Un repo con pocos tests bien elegidos es el objetivo; llenarlo de variantes del mismo caso no mejora nada y encarece cada cambio futuro.
- Esto es intencional: gran parte de las apps genéricas reales no tiene tests todavía, y la manera de revertir eso es no dejar pasar ninguna oportunidad de agregar cobertura al tocar un archivo, en vez de esperar una tarea dedicada de "agregar tests" que nunca llega.

## 1. Runner: Vitest

El runner del ecosistema es Vitest. Declarar `"vitest"` como devDependency en el `package.json`
del repo no implica automáticamente que existan tests: verificar la presencia real de archivos
`.spec.js` antes de asumir cobertura. No hace falta `vitest.config.js` propio committeado: correr
con la configuración por default de Vitest salvo que el proyecto necesite algo específico (alias
de paths, entorno DOM, etc.) — ver §1.1 para la excepción puntual de un `vitest.config.mjs`
**local y gitignoreado** (no committeado) que sí hace falta para correr la suite fuera de la
plataforma.

**Los tests corren dentro de la plataforma de apps genéricas, no de forma aislada.** El repo de la
app no arma ni importa el objeto `ProductecaSdk`/`opeUtils` en ningún lado — eso lo construye el
servidor de apps genéricas y lo deja seteado como global antes de cada test, exactamente igual que
`code-executor` lo inyecta en runtime real. Un `.spec.js` de este ecosistema nunca declara
`import ProductecaSdk from ...` ni arma un mock del SDK a mano: lo da por existente y solo
stubea el método puntual que necesita (ver §5).

**Sistema de módulos del archivo de test, aunque el código fuente sea CommonJS.** El código fuente del ecosistema es CommonJS (`require`/`module.exports`, ver `/generic-apps:core-architecture`), pero Vitest en sí se importa siempre con `import { describe, it, expect, vi } from "vitest"` dentro del archivo de test — `require("vitest")` falla (`Cannot find module 'vitest'`) porque el paquete no expone una entrada CommonJS. Esto no exige convertir el código fuente a ESM: Vitest interpreta el archivo de test con su propio transform, así que `import { handler } from "../run.js"` funciona igual contra un módulo que exporta con `module.exports`. La única parte que tiene que usar `import` es la que trae utilidades de `"vitest"`.

**Bootstrap: agregar Vitest a un repo que todavía no lo tiene.** Cuando el `package.json` no declara `vitest` en absoluto:

1. Agregarlo a `devDependencies` con una versión mayor razonablemente reciente al momento de escribir el test — no hay una versión única fijada para todo el ecosistema, así que repos distintos pueden terminar en majors distintas; no es un problema en sí, pero conviene revisar el changelog de la versión elegida si difiere mucho de otro repo del mismo equipo.
2. Correr `npm install` de verdad después de declararla. No alcanza con editar `package.json` y correr `npx vitest run` esperando que ande: `npx` puede resolver una copia de su propio caché (potencialmente de otra versión a la declarada) sin instalarla en el `node_modules` del proyecto, dejando el repo en un estado inconsistente donde el test "corrió" pero la dependencia real nunca quedó instalada.

## 1.1. Bootstrap local: correr la suite fuera de la plataforma

`§1` y `§5` documentan el contrato en runtime real: la plataforma deja `ProductecaSdk`/`opeUtils`
armados como global (vía su propio `beforeEach`, del lado del servidor) antes de cada test. Ese
mecanismo no existe cuando alguien corre `npx vitest run` de forma aislada en su máquina, fuera de
la plataforma — en cuanto un `.spec.js` toca `ProductecaSdk` o `opeUtils` sin que nada los haya
armado antes, explota con `ReferenceError: ProductecaSdk is not defined`. Esto no es un bug del
código bajo test: es la ausencia del `beforeEach` de la plataforma en una corrida local.

**Solución: separación estructural, nunca conviven en el mismo checkout** — no feature-detection
en runtime (`if (!globalThis.ProductecaSdk)` para instalar un `beforeEach` propio solo si el
global real no existe): el mock real también se instala vía `beforeEach`, así que si ambos hooks
coexistieran en una misma corrida, el orden de registro decidiría cuál gana, con riesgo de pisar
silenciosamente al real. En vez de detectar en runtime, se evita la colisión de raíz: el archivo
que activa el mock local nunca existe en el mismo checkout que corre en CI/producción. Tres piezas
(ver examples.md para el contenido completo):

1. `tests/setup/localProductecaSdkMock.js` — **se commitea**. Builder de un stub liviano basado en
   `Proxy` para `ProductecaSdk`: cualquier path se puede asignar, y el que no fue stubeado
   explícitamente explota con `"{path} is not stubbed. Assign a stub to it in your test before
   calling it."` — el mismo contrato observable que ya documenta `§5` para el mock real de la
   plataforma. Se registra en su propio `beforeEach` y es inerte si nada lo referencia: sin el
   config de la pieza 3, este archivo no corre.
2. `tests/setup/vitest.config.example.mjs` — **se commitea**. Template que registra
   `setupFiles: ["./tests/setup/localProductecaSdkMock.js"]`. Extensión `.mjs` a propósito: el
   código fuente del ecosistema es CommonJS (`/generic-apps:core-architecture`), y Vitest necesita cargar el
   archivo de config como ESM. Vive junto al mock en `tests/setup/` en vez de la raíz del repo
   porque nada lo referencia directamente — solo se copia — así que no hace falta que "ensucie"
   la raíz como sí necesita el archivo de la pieza 3.
3. `vitest.config.mjs` — **en la raíz del repo** (ahí es donde Vitest lo busca por default) y
   **nunca se commitea**, va agregado a `.gitignore`. Cada dev lo crea una sola vez copiando el
   template (`cp tests/setup/vitest.config.example.mjs vitest.config.mjs`). Vive solo en el
   checkout de quien lo creó.

Con esto, `npx vitest run` / `npm test` sigue siendo el mismo comando en todos lados. En
CI/producción `vitest.config.mjs` no existe, así que no hay setup extra y cero riesgo de pisar el
mock real de la plataforma. Localmente, una vez bootstrapeado, la suite corre aislada.

**`opeUtils` en el mock local.** A diferencia de `ProductecaSdk`, `opeUtils` real es una instancia
con lógica de negocio propia (`isMinId`, `genericFilter`, `addFullProduct`, etc.), no un simple
stub por método — el mock local no puede reconstruir esa lógica. El stub local de `opeUtils` usa el
mismo `Proxy` base que `ProductecaSdk`, y solo hardcodea las dos funciones cuyo shape de error es
fijo y ya está documentado en `/generic-apps:core-ope-utils` §2 (`ignoreOrder(reason?)` y `error(code, message)`) —
el resto de los métodos de `opeUtils` sigue sin estar stubeado por defecto y explota igual que
cualquier path no asignado si un test los llama sin stubearlos primero.

**Excepción a tener en cuenta: cuándo este patrón choca con un `vitest.config` real.** Si un repo
puntual alguna vez necesita un `vitest.config.mjs`/`.js` **real y committeado** (alias de paths,
entorno DOM — el caso que menciona `§1`), va a chocar con la regla de `.gitignore` de este
bootstrap: no se puede tener a la vez un `vitest.config.mjs` committeado para CI y uno
gitignoreado para bootstrap local con el mismo nombre. No es un caso que este patrón resuelva
automáticamente — hay que decidirlo a mano en ese repo puntual (por ejemplo, fusionar el
`setupFiles` del bootstrap local dentro del config real committeado, en vez de mantener los dos
archivos separados) y dejarlo así documentado en ese repo, no perder de vista el conflicto.

## 1.2. Solo `ProductecaSdk`/`opeUtils` son bare globals seguros — cualquier otra librería, siempre `require()`

Hay al menos tres entornos de ejecución distintos, y no todos proveen los mismos globals:

1. **Runtime real de `code-executor`**, ejecutando el handler ya desplegado ante una invocación real.
2. **El pipeline de tests que corre como parte del deploy**: un runner de CI separado que ejecuta
   los `.spec.js` del repo antes de publicar una versión nueva.
3. **La máquina local de un dev**, corriendo `npx vitest run` de forma aislada (ver `§1.1`).

Lo único garantizado en los tres entornos es `ProductecaSdk`/`opeUtils`: el runtime real los
inyecta, el pipeline de CI arma su propio equivalente antes de correr los tests (por eso `§1.1`
solo necesita replicarlo para el entorno local), y ninguna otra librería tiene esa misma garantía
— aunque el runtime real de un repo puntual la inyecte como global para invocaciones reales, el
pipeline de tests de CI **no** replica necesariamente ese mismo global adicional.

**Ninguna librería de terceros (streams, utilidades, etc.) se asume como bare global en el código
fuente de la app, ni siquiera confirmando que el runtime real la inyecta así.** Siempre
`require()` explícito + dependencia real en `package.json` (nunca `devDependency`, porque ahora sí
la usa código de producción). Un `require()` no choca con que el runtime real también la exponga
como global — el paquete instalado y ese global terminan siendo la misma librería en la práctica —
pero omitir el `require()` porque "ya está confirmada como global" revienta con
`ReferenceError: {LIBRARY} is not defined` en cuanto el pipeline de CI corre el `.spec.js`
correspondiente, ya que ese entorno no la provee: solo confirma tener armado
`ProductecaSdk`/`opeUtils`, nada más. Con la librería requerida explícitamente, ni el bootstrap
local de `§1.1` ni ningún stub adicional hacen falta para este caso — es una dependencia normal.

## 2. Ubicación y naming

Los tests viven en una carpeta `tests/` en la raíz del repo, nunca colocados junto al código que
testean y nunca dentro de `__tests__/`. El nombre de archivo sigue `{Nombre}.spec.js` —
`{Nombre}.test.js` no se usa en este ecosistema.

Los datos de prueba (fixtures) se centralizan en `tests/testHelpers/`, con un archivo por
fixture que exporta el dato (`{caso}Input.js`, `{caso}Result.js`). Los tests importan desde ahí
en vez de declarar los objetos de prueba inline cuando el fixture es grande o se reutiliza en
más de un test.

## 3. Cómo correr los tests

**Antes que nada, verificar `node --version`.** El Node local con el que se edita un repo no
tiene por qué coincidir con el runtime real de Producteca (`code-executor`), y es común que un
repo tenga instalado un Node viejo (heredado de cuando se configuró el entorno originalmente).
Vitest exige una versión de Node relativamente moderna — si `npx vitest run` falla con un error
de sintaxis en una dependencia interna (ej. `SyntaxError: Unexpected token '.'`) antes de llegar
a correr un solo test, sospechar primero de la versión de Node, no del código del repo. Si hay
`nvm` (o `nvm4w` en Windows) disponible, cambiar a una versión moderna instalada (`nvm ls` para
ver cuáles hay, `nvm use {versión}`) solo para correr los tests — no hace falta que coincida con
ninguna versión particular del runtime real, alcanza con que sea reciente. Si se cambia la
versión activa de Node del entorno para poder correr los tests, avisar al usuario que quedó así
y preguntar si hay que revertirla al terminar — no revertirla ni dejarla cambiada por decisión
propia sin decirlo.

El comando base es `npx vitest run` (todo el repo) o `npx vitest run tests/{archivo}.spec.js`
(un archivo puntual); `npx vitest` sin `run` queda en watch mode para desarrollo. Si el
`package.json` del repo no define `scripts.test`, agregarlo (`"test": "vitest run"`) es una
mejora recomendada al tocar el repo, no un requisito para escribir el test en sí — no asumir
que `npm test` ya funciona sin revisar `package.json` primero.

## 4. Estilo de test: `describe` + `it`, o `it` plano

Ambos estilos son válidos en este ecosistema. Usar `describe` para agrupar varios casos de una
misma función o método (por ejemplo, distintos escenarios de un mismo mapper). Usar `it` plano,
sin `describe`, cuando cada test cubre un método distinto de una misma clase y agruparlos no
aporta claridad adicional — por ejemplo, un archivo de test que recorre uno por uno los métodos
de un cliente API.

## 5. Mocking de `ProductecaSdk` y `opeUtils`: ya vienen armados como global

El runner de §1 deja `ProductecaSdk` y `opeUtils` armados en `globalThis` **antes de cada test**,
así que un `.spec.js` nunca los importa ni los arma a mano — ni con `vi.stubGlobal`, ni con
`require`. La implementación de ese stub vive en el servidor de la plataforma, no en el repo de
la app ni en esta skill — no reimplementarla ni copiarla, alcanza con conocer su contrato
observable (ver examples.md):

- **Cualquier path se puede leer o asignar sin declararlo antes** — no hace falta un `mock` previo
  del shape completo del SDK. Asignar un método es "stubear" ese path:
  `ProductecaSdk.salesOrdersApi.update = vi.fn().mockResolvedValue({})`.
- **Llamar un path que el test no stubeó lanza un error con el path completo**
  (`ProductecaSdk.productsApi.get is not stubbed. Assign a stub to it...`) — es la señal de qué
  falta stubear, no un bug del mock. Si el handler dispara una llamada inesperada del SDK, el test
  falla apuntando exactamente a esa llamada.
- **No hace falta `mockRestore()` para estos stubs**: el mock se reconstruye entero (un `Proxy`
  nuevo) antes de cada test, así que lo que un test stubeó nunca se filtra al siguiente.
- `opeUtils` **no es un mock**: es una instancia real de la clase `OpeUtils` del runtime,
  construida con el `ProductecaSdk` ya mockeado. Si el handler llama a un método de `opeUtils` que
  internamente pega contra el SDK, lo que hay que stubear es el método de `ProductecaSdk`
  correspondiente — nunca `opeUtils` en sí (sigue aplicando §6: no se testea `opeUtils`
  directamente, es código del runtime).

`axiosClient` (el cliente axios crudo que algunas apps usan para binarios, ver `/generic-apps:core-axios-api`)
es un global distinto y **no** viene armado por el runner de la plataforma como `ProductecaSdk`/
`opeUtils` — si el handler bajo test lo usa directo, sigue haciendo falta stubearlo a mano con
`vi.stubGlobal("axiosClient", ...)`.

Para clases del propio repo (`services/`, `api/`) el patrón sigue siendo instanciar la clase real
(por ejemplo `new {System}Api(userConfig)`) y usar
`vi.spyOn(instancia, "metodo").mockResolvedValue(...)` para interceptar solo la llamada HTTP
interna, dejando que el resto de la lógica de la clase corra de verdad. A diferencia del mock de
`ProductecaSdk`, acá sí hace falta cerrar cada test con `spy.mockRestore()` explícito, porque el
spy queda sobre una instancia que el archivo de test sigue reutilizando.

Para funciones puras (mappers, filtros, helpers) no hace falta ningún mock: se llama la función
directamente con datos de entrada fijos y se compara el output esperado.

**Aislar el singleton de `baseConfig` cuando un mapper lo importa directo.** `/generic-apps:core-architecture` ya documenta que es común (aunque no ideal) que un mapper haga `require`/`import` de `baseConfig` al tope del archivo en vez de recibirla como parámetro — y como es un singleton que lee `process.env` una sola vez, al cargarse, un test no puede simplemente "pasarle" una config distinta. Dos técnicas válidas, elegir según el caso:

1. **Setear las env vars necesarias antes de requerir/importar el módulo bajo test** (en el `beforeEach`/al tope del archivo de test), y usar `vi.resetModules()` entre tests que necesiten valores de config distintos dentro del mismo archivo — sin eso, el `require` cacheado reutiliza el singleton armado en el primer test del archivo, no el de la env var seteada después.
2. **Armar el fixture de entrada de forma que no dependa del valor default de la config** (por ejemplo, si el mapper cae en un default de `baseConfig` cuando falta un campo en la orden, incluir ese campo explícito en el fixture de test para no depender de esa env var en absoluto). Es una salida legítima cuando la config solo aporta un valor de fallback y el input de test puede proveerlo directamente — no hace falta forzar el mock de la técnica 1 si alcanza con esto.

No dejar que `baseConfig` tire un error al importarse durante un test por falta de una env var sin abordarlo con alguna de las dos — ese es el síntoma de que el mapper depende del singleton sin que el test lo haya tenido en cuenta.

## 6. Qué testear, y con qué profundidad por capa

El conjunto esencial es chico a propósito: **mappers y services**. Son las capas donde un bug cambia lo que se manda al sistema externo o cómo se interpreta su respuesta. El handler y el cliente `api/` se cubren solo en lo que tienen de lógica propia.

| Capa | Qué cubrir (y nada más) | Tope orientativo |
|---|---|---|
| `mappers/` (transformación de datos) | El camino principal (input típico → output esperado) más 1-2 casos que de verdad cambien lo que recibe el sistema externo (campo requerido ausente, tipo inesperado). | 2 a 4 tests por mapper |
| `services/` (arma y dispara las llamadas al sistema externo) | Camino feliz + los errores reales del sistema externo que el service maneja de forma distinta (auth inválida, respuesta malformada). | 3 a 6 tests por service |
| `run.js` (handler) | Las ramas de decisión reales: qué filtro corta la ejecución y qué llamada al SDK se dispara en el camino feliz. Stubear solo el método puntual de `ProductecaSdk` que use cada rama (§5/§6.1). | 2 a 4 tests por handler |
| `api/` (cliente HTTP — `axiosApi`, `{system}Api`) | Solo si hay lógica propia (login/reintento ante 401, normalización de error específica). Un wrapper delgado sin lógica propia no necesita tests. | 2 a 4 tests por cliente |

Estos topes son orientativos, no un límite rígido a forzar artificialmente — pero si un archivo los supera claramente (8+ tests en un mapper, 12+ en un service), es señal de que se están testeando variaciones de dato que no cambian el comportamiento real, no de que el código sea "más complejo y necesite más cobertura". Ante esa señal, revisar con el criterio de la sección "Qué NO hacer" antes de sumar el test siguiente.

No testear `ProductecaSdk` ni `opeUtils` en sí mismos: son código del runtime, no del repo. Se
los usa como dependencia ya armada (mockeada en el caso de `ProductecaSdk`, real en el caso de
`opeUtils`) para poder testear el código propio que los llama — ver §5.

### Qué NO hacer (causa real de sobre-testeo observada)

Es fácil, sobre todo en mappers, empezar a generar un test por cada variación de dato imaginable — acentos en nombres de provincia, mayúsculas/minúsculas de un `docType`, orden de propiedades en un objeto, leaks de headers hipotéticos — hasta terminar con decenas de archivos de test para un puñado de mappers simples. Antes de agregar un test de edge case, preguntarse: **¿este caso cambia lo que se manda al sistema externo o cómo se interpreta su respuesta?** Si la respuesta es no (es una curiosidad de implementación, un bug hipotético no reportado, o una variante de formato que el sistema externo no diferencia), no amerita un test dedicado — mencionarlo como comentario si es útil, pero no multiplicar archivos de test por eso. La profundidad de test debe ser proporcional al riesgo real, no exhaustiva por defecto.

### Regla puntual: una rama de código = un test representativo, no uno por variante de input

Un patrón de sobre-testeo más sutil que el anterior (aparece incluso cuando cada test individual sí es "real", no cosmético): cuando una función tiene una sola rama condicional (ej. `Array.isArray(x) ? x : []`, o un `escapeODataValue(id)` aplicado dentro de un `$filter`), no escribir un test por cada posible input que cae en esa misma rama (`undefined`, `null`, `"no-array"`, objeto vacío, `data` ausente — los cuatro terminan en la misma línea de código). Un test que ejercita el lado feliz de la rama y **uno** que ejercita el lado alternativo alcanzan; el resto son variaciones del mismo caso, no casos nuevos.

Esto aplica también entre archivos: si un cliente API expone 10 endpoints y 4 de ellos aplican el mismo mecanismo de escapado/normalización sobre un parámetro, no hace falta re-probar ese mecanismo en los 4 — probarlo una vez (en el endpoint más representativo) y en los otros 3 solo verificar lo que cada uno tiene de distinto (URL, método, body). Antes de escribir el siguiente test de un archivo, preguntarse: **¿esto ejercita una rama de código que ningún test anterior de este archivo ya haya recorrido?** Si la respuesta es "no, es la misma rama con otro input", no agregarlo — es la forma más común en que un archivo termina superando el tope de la tabla de arriba sin que ningún test individual sea, por sí solo, cuestionable.

## 6.1. Testear el handler completo

Para testear el `handler` de punta a punta (camino feliz, o el filtro de negocio que corta la
ejecución antes de llegar al sistema externo) no hace falta armar nada extra: `ProductecaSdk` y
`opeUtils` ya están disponibles como global gracias al runner (§1/§5). El test solo necesita:

1. **Armar el `salesOrder`/payload de entrada** para que caiga en la rama que se quiere ejercitar
   — si el corte depende de una guarda real de `opeUtils` (`isMinId`, `genericFilter`, una
   condición propia del handler como `salesOrder.invoiceIntegration`), construir el fixture para
   que esa condición sea real, no simulada.
2. **Stubear solo los métodos de `ProductecaSdk` que la rama bajo test realmente llama** —
   asignar el método puntual (`ProductecaSdk.createInvoiceIntegration = vi.fn()...`), sin declarar
   el resto del SDK. Si la rama cortada por la guarda de negocio no llega a llamar al SDK, no hace
   falta stubear nada de `ProductecaSdk` para ese test.
3. Cuando el corte termina en `opeUtils.ignoreOrder(reason)` u `opeUtils.error(code, message)`, capturar
   el throw real de esas funciones (shape fijo, ver `/generic-apps:core-ope-utils`) con
   `expect(...).rejects.toMatchObject({ code: "IgnoredInvoiceByUserConfiguration" })` — no hay que
   simular ese shape, es el que produce la instancia real de `opeUtils`.

## 6.2. `run.example.js` como smoke test manual

Cada acción/handler puede tener, además de sus tests de Vitest, un `run.example.js` que arma un
`context`/`event` de prueba y ejecuta `handler(...).then(console.log)` para correrlo manualmente
en local. Es un complemento recomendado a los tests automatizados, no un reemplazo: nunca debe
commitearse con credenciales reales (usar valores de placeholder o leer de `.env.local` no
versionado), y no se ejecuta como parte de la suite de CI.

## 7. Cobertura

No asumir que existe un umbral de cobertura exigido por CI: verificar si hay configuración de
`coverage` en `vitest.config.js` antes de darlo por hecho. Cuando no existe, tratar un objetivo
de cobertura (por ejemplo, 80% en mappers y services) como un lineamiento de calidad recomendado
para código nuevo, no como una regla que el repo esté haciendo cumplir hoy.

## 8. Alcance y límites

Esta skill no cubre tests end-to-end contra el sistema externo real, ni testing del propio
runtime de Producteca (`ProductecaSdk`, `opeUtils`), que está fuera del código de los repos de
apps genéricas.
