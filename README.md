# skills-plugins-test

PoC de un marketplace unificado de Claude Code (`test-marketplace`) con tres fuentes:

| Plugin | Fuente | Contenido |
|---|---|---|
| `generic-apps` | `./plugins/generic-apps` | Skills propias (`cdm-api`, `syncer`, `core-testing`) bajo `/generic-apps:<skill>` |
| `external-skills` | `./plugins/external-skills` | Wrapper para skills externas sueltas (`hello-external`, `external-demo`) |
| `superpowers` | GitHub `obra/superpowers` | Plugin público referenciado directo desde su repo |

## Probar localmente

```bash
claude plugin validate .
claude plugin marketplace add .
claude plugin install generic-apps@test-marketplace
claude plugin install external-skills@test-marketplace
claude plugin install superpowers@test-marketplace
```

Para agregar una skill externa: copiar su carpeta (con `SKILL.md` y sus `scripts/` / `references/`) dentro de `plugins/external-skills/skills/`. Los scripts se referencian con `${CLAUDE_SKILL_DIR}`.
