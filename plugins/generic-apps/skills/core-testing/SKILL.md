---
name: core-testing
description: >-
  Estándar de testing con Vitest para las apps genéricas de Producteca:
  runner, ubicación de archivos, naming y mocking. Usar al escribir o revisar
  tests para un mapper, service, filtro o helper puro en cualquier tipo de
  app del ecosistema.
---

# Core Testing — Estándar con Vitest

## Skills relacionadas

- `/generic-apps:core-architecture` → dónde vive el código que esta skill testea.

## Objetivo

1. **No negociable**: todo código nuevo se entrega con tests; todo código existente que se toca sale de la tarea con cobertura de lo que cambió, tenga o no tests el resto del repo — ver reference.md §0.
2. **Tests mínimos y esenciales**: el núcleo a cubrir son `mappers/` y `services/` (lo que se manda al sistema externo y cómo se interpreta su respuesta), con camino principal + los errores que cambian ese resultado; el handler y el cliente `api/` solo en lo que tengan de lógica propia. Pocos tests por archivo, no un catálogo de variantes — ver reference.md §6 (tabla de topes y qué NO hacer).
3. **Una rama de código, un test representativo**: antes de sumar el siguiente test a un archivo, preguntarse si ejercita una rama que ningún test anterior de ese archivo ya haya recorrido — si es la misma rama con otro input (`null` vs `undefined` vs string vacío cayendo en el mismo `else`), no agregarlo. Así es como un archivo termina superando el tope sin que ningún test individual sea, por sí solo, cuestionable — ver reference.md §6 "Regla puntual".
4. Escribir tests con el mismo runner y en la misma ubicación en todo el ecosistema.
5. No dar por sentado tooling que el repo no tiene (`npm test`, cobertura) sin revisar `package.json`.

## Convenciones

| Item | Regla |
|---|---|
| Obligatoriedad | Sin excepción — código nuevo y código viejo tocado, ambos se entregan con tests |
| Profundidad | `mappers/` (2-4 tests) y `services/` (3-6): camino principal + errores reales. `run.js` (2-4): ramas de decisión. `api/` (2-4, solo si tiene lógica propia). No un catálogo de edge cases |
| Runner | Vitest |
| Ubicación | Carpeta `tests/` en la raíz del repo, nunca `__tests__/` |
| Naming de archivo | `{Nombre}.spec.js` (no `{Nombre}.test.js`) |
| Fixtures | `tests/testHelpers/` con datos de entrada y salida esperada exportados |
| Mocking de `ProductecaSdk`/`opeUtils` | El test nunca los crea ni los importa: el runner de la plataforma ya los deja armados como global antes de cada test. Solo hay que asignar el método puntual que se necesita (`ProductecaSdk.salesOrdersApi.update = vi.fn()...`), nunca `vi.stubGlobal` (ver reference.md §5) |
| Bootstrap local (fuera de la plataforma) | `tests/setup/localProductecaSdkMock.js` + `tests/setup/vitest.config.example.mjs` committeados; `vitest.config.mjs` en la **raíz** (ahí es donde Vitest lo busca por default), gitignoreado y creado una vez por dev (`cp tests/setup/vitest.config.example.mjs vitest.config.mjs`) — ver reference.md §1.1 |
| Ejecución | `npx vitest run`; agregar `scripts.test` es una mejora recomendada, no algo a asumir |

## Estructura de archivos

```
{repo-root}/
├── tests/
│   ├── {App}.spec.js
│   ├── testHelpers/
│   │   └── {fixture}.js
│   └── setup/
│       ├── localProductecaSdkMock.js     ← committeado, bootstrap local (reference.md §1.1)
│       └── vitest.config.example.mjs     ← committeado, template a copiar
├── {app}/
│   └── run.js            ← sin test colocado junto al handler
├── vitest.config.mjs      ← NO committeado (gitignore), creado por dev copiando el template
└── package.json
```

## Flujo típico

1. Leer [reference.md](reference.md) para el contrato de mocking y el comando de ejecución.
2. Usar [examples.md](examples.md) para copiar el patrón de función pura, `vi.spyOn` o el mock de `ProductecaSdk`.
3. Si el repo no tiene carpeta `tests/`, crearla en la raíz — nunca junto al handler.
4. Si vas a correr la suite fuera de la plataforma (`npx vitest run` en tu máquina) y el repo todavía no tiene `vitest.config.mjs`, bootstrapearlo con el patrón de reference.md §1.1 antes de asumir que un `ReferenceError: ProductecaSdk is not defined` es un bug del código bajo test.
