---
name: external-demo
description: Skill externa de prueba con carpetas scripts/ y references/, para verificar que una skill suelta empaquetada en external-skills encuentra sus archivos auxiliares. Usar cuando se pida "probar external-demo" o "test de skill externa con scripts".
---

# external-demo

1. Leé `${CLAUDE_SKILL_DIR}/references/notes.md` y mostrá la frase clave que contiene.
2. Ejecutá el script incluido y mostrá su salida:

   ```bash
   node "${CLAUDE_SKILL_DIR}/scripts/hello.mjs"
   ```

3. Si ambos pasos funcionan, informá: "external-demo OK: references y scripts accesibles".
