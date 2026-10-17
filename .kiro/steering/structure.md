# Repository structure

```
tutor-agent/
├── .kiro/
│   ├── steering/            # product.md, tech.md, structure.md
│   └── specs/               # one spec per phase (fase-0-base, fase-1-tutor, ...)
├── shared/                  # API contract: zod schemas and TypeScript types (web + api)
├── web/                     # Vite + React + TypeScript
│   └── src/
│       ├── api/             # client.ts (single HTTP/SSE exit point)
│       ├── components/      # Header, LessonPanel, EditorPanel, ResultsPanel, TutorChat
│       └── hooks/           # useExercise, useChat, useRunCode
├── api/                     # API Lambdas (TypeScript, Node.js 22)
│   ├── src/handlers/        # one handler per responsibility
│   ├── src/lib/             # content, AgentCore client, utilities
│   └── tests/               # Vitest
├── agent/                   # Strands agent for AgentCore Runtime (Python 3.13, uv) - from Phase 1
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/agent/
│   └── tests/
├── infra/                   # CDK in TypeScript
│   ├── bin/app.ts
│   ├── lib/                 # web-stack, api-stack, agent-stack, content-stack, auth-stack
│   └── test/
├── content/                 # lessons and exercises
│   └── modulo-03-condicionales/
│       ├── leccion.md
│       ├── ejercicios.json
│       └── errores-comunes.md
├── scripts/                 # agent packaging and utilities
├── docs/posts/              # draft of each post
├── stacky.md                # POC source document
└── README.md                # roadmap and commands
```

## Organization rules
- One spec per phase in `.kiro/specs/<phase>/` with `requirements.md`, `design.md` and `tasks.md`.
- `shared/` is the only source of truth for contract types; `web/` and `api/` do not redefine them.
- `agent/` is the only Python component; do not mix Python code into `api/` or `infra/`.
- Pedagogical content lives only in `content/`; the reference solution is never copied to `web/`.
- Each phase adds and does not restructure: the directories above exist from Phase 0 or are created
  in the indicated phase (`agent/` in Phase 1).
- Content files and folders keep their Spanish names (`leccion.md`, `ejercicios.json`,
  `errores-comunes.md`, `modulo-NN-*`) because they hold student-facing material.

## `ejercicios.json` schema
```json
{
  "id": "m03-e01",
  "moduleId": "modulo-03-condicionales",
  "title": "Clasifica edades",
  "statement": "...",
  "difficulty": 1,
  "prerequisites": ["modulo-02"],
  "starterCode": "def clasificar(edad):\n    pass\n",
  "hints": ["level 1", "level 2", "level 3"],
  "tests": [{ "name": "menor de edad", "call": "clasificar(15)", "expected": "menor" }],
  "solution": "server only"
}
```
