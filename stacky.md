# POC: Tutor de programación con agentes de IA en AWS

> Documento fuente para que Kiro genere los specs (requirements, design, tasks) de cada fase.
> Nombre del proyecto: **por definir** (candidatos: CodIA, Pythia, Hintly). Usar `tutor-agent` como nombre de trabajo.

---

## 1. Objetivo

Construir una aplicación web donde un alumno aprende **Python para principiantes** con un agente tutor de IA.
El alumno ve la lección, escribe código en un editor, ejecuta tests y conversa con el tutor, que usa el
método socrático (orienta con preguntas y pistas, no entrega la solución).

El proyecto es también la base de una **serie de posts en AWS Builder Center** (categoría DevTools):
cada fase produce una demo funcional y un post.

### Criterios de éxito de la POC
- El alumno completa al menos un módulo de punta a punta con el tutor.
- El tutor nunca entrega la solución completa sin haber agotado las pistas.
- El código del alumno se ejecuta en un sandbox aislado.
- El agente recuerda el progreso entre sesiones.
- Todo se despliega con un solo comando de CDK.

### Fuera de alcance
Otros lenguajes, POO avanzado, certificados, gamificación, pagos, panel de docente, app móvil.

---

## 2. Restricciones técnicas obligatorias

| Tema | Decisión |
|---|---|
| Lambdas (API) | **TypeScript** en runtime **Node.js 22.x**, arm64, con **`NodejsFunction`** de `aws-cdk-lib/aws-lambda-nodejs` (empaquetado con esbuild) |
| Despliegue de Lambdas | **Direct code deploy** (bundle zip como asset generado por esbuild, **sin imágenes de contenedor**) |
| Gestión de Python (agente) | **uv** con entorno virtual (`.venv`) y **Python 3.13**; aplica solo al agente de AgentCore y a sus herramientas |
| Infraestructura | **AWS CDK en TypeScript** (un solo proyecto, stacks separados por responsabilidad) |
| Despliegue de agentes | **Amazon Bedrock AgentCore Runtime con direct code deploy** (zip en S3, arm64, Python 3.13 generado con uv), sin contenedor, si el servicio lo soporta en la región elegida |
| Capacidades del agente | Servicios de **AgentCore** cuando existan: Runtime, Memory, Code Interpreter, Gateway, Identity, Observability |
| Lenguaje y framework del agente | **Python 3.13 + Strands Agents SDK** (obligatorio; el agente de AgentCore no se escribe en TypeScript) |
| Modelo | Amazon Bedrock (Claude); el ID del modelo se configura por variable, no se escribe en el código |
| Front | Vite + React + TypeScript (strict) |
| Idioma | Interfaz y tutor en español; código y comentarios en inglés |

### Reglas de Lambdas en TypeScript (NodejsFunction)
- Toda Lambda se define con `NodejsFunction` (runtime `NODEJS_22_X`, arquitectura `ARM_64`), apuntando a su `entry` en `api/src/handlers/*.ts`.
- El empaquetado lo hace CDK con esbuild (`bundling`: `minify`, `sourceMap`, `target: node22`, `format: ESM` o CJS según se decida); no hay scripts de empaquetado manuales ni contenedores.
- Dependencias del AWS SDK v3 se mantienen externas cuando el runtime ya las incluye; el resto se empaqueta en el bundle.
- Preferir esbuild local (instalado como `devDependency` en `infra/`) para que el bundling no requiera Docker.
- Handlers con `strict` TypeScript, validación de entrada con `zod` y tipos del contrato compartidos con el front.
- Las Lambdas se exponen **detrás de Amazon API Gateway (REST API)**; ningún endpoint de la API es público fuera de API Gateway.
- Streaming del chat (**verificado en la documentación de AWS**): API Gateway REST soporta `responseTransferMode: STREAM` con integración de proxy de Lambda. Requisitos: Lambda invocada con `InvokeWithResponseStream` (URI de integración terminada en `/response-streaming-invocations`), handler con `awslambda.streamifyResponse` y `HttpResponseStream.from` para enviar metadatos, y redeploy de la API tras el cambio. Una función que devuelva formato no streaming responde 500. Validar en la documentación vigente la región y los límites de timeout (hasta 15 minutos según la guía de proxy HTTP) y el tope de payload; la alternativa de respaldo es una Function URL en modo `RESPONSE_STREAM` solo para `/api/chat`.
- En CDK, el modo de transferencia puede requerir el recurso L1 (`CfnMethod`, propiedad de integración `ResponseTransferMode`) si el L2 `LambdaIntegration` aún no lo expone.
- Para invocar al agente desde la Lambda se usa el cliente de AWS SDK v3 para Bedrock AgentCore (`InvokeAgentRuntime`).

### Reglas de entorno Python del agente (uv)
- Crear entorno: `uv venv --python 3.13`; sincronizar dependencias con `uv sync`.
- Dependencias declaradas en `pyproject.toml` y bloqueadas en `uv.lock` (versionado en git).
- Ejecutar siempre con `uv run` (por ejemplo `uv run pytest`).
- Un único `pyproject.toml` en `agent/`, con su propio `.venv`.
- Prohibido usar `pip install` directo o `requirements.txt` escrito a mano; si hace falta uno para empaquetar, se genera con `uv export`.

### Reglas de empaquetado del agente (direct code deploy en AgentCore Runtime)
- El agente se empaqueta para **arm64** (Graviton) con Python 3.13.
- Generar el paquete con uv instalando dependencias para la plataforma de destino, por ejemplo:
  `uv export --no-dev --frozen -o build/requirements.txt` y
  `uv pip install --target build/package --python-platform aarch64-manylinux2014 --python-version 3.13 -r build/requirements.txt`.
- Copiar el código del agente dentro de `build/package`, comprimirlo y publicarlo como artefacto S3 (con CDK, como asset del `AgentStack`).
- Un script `scripts/package-agent.(sh|ps1)` deja el zip listo antes de `cdk deploy`.
- **Verificado en la documentación de AWS:** AgentCore Runtime soporta direct code deployment (zip en S3, sin Docker ni ECR), solo arm64, con entrypoint `.py` que use `@app.entrypoint` (SDK de AgentCore) o exponga `/invocations` (POST) y `/ping` (GET). Ajustar permisos POSIX de los archivos antes de comprimir.
- Instalar dependencias con `uv pip install --python-platform aarch64-manylinux2014 --only-binary=:all: --target=deployment_package`.
- **CDK:** `aws-cdk-lib` incluye el módulo `aws_bedrockagentcore` con el construct `Runtime` y `AgentRuntimeArtifact.fromCodeAsset` (empaqueta y sube a un bucket administrado por CDK) o `AgentRuntimeArtifact.fromS3` (bucket, clave del zip, versión de Python y entrypoint). Preferir `fromCodeAsset`; si el módulo no cubre algo (por ejemplo Memory o Code Interpreter), usar el L1 correspondiente.
- Validar siempre la versión de Python soportada (3.13) y los límites de tamaño del zip en la documentación vigente.

---

## 3. Principios pedagógicos (obligatorios en el prompt del agente)

1. **Método socrático:** preguntar y orientar antes que explicar.
2. **Pistas progresivas en 3 niveles:** (1) orientación, (2) estructura, (3) casi la solución. Solo se entrega la solución si el alumno la pide tras agotar las pistas, y siempre con explicación.
3. **La solución de referencia nunca sale del servidor** hacia el front.
4. **Errores como oportunidad:** el tutor explica el mensaje de error con palabras simples.
5. **Adaptación:** si el alumno falla 3 veces el mismo concepto, cambiar de analogía o bajar la dificultad.
6. **Respuestas cortas**, con analogías y ejemplos pequeños.
7. Mantener el tono: paciente, curioso, celebra los intentos.

---

## 4. Arquitectura objetivo

```
Navegador (React + Vite)
   │  HTTPS
   ▼
CloudFront ── S3 (sitio estático)
   │
   ├── /api/*  ──▶ Amazon API Gateway (REST API: CORS, throttling, autorizador Cognito, WAF opcional)
   │                  │
   │                  ▼
   │              Lambda (TypeScript, Node.js 22, arm64, NodejsFunction)
   │                  │  autenticación: Cognito JWT (Fase 5)
   │                  ├── contenido: S3 / Knowledge Base (Fase 4)
   │                  ├── progreso: DynamoDB (opcional, ver decisiones abiertas)
   │                  └── invoca ──▶ AgentCore Runtime (agente Strands, direct code deploy)
   │                                    ├── Amazon Bedrock (modelo)
   │                                    ├── AgentCore Code Interpreter (Fase 2)
   │                                    ├── AgentCore Memory (Fase 3)
   │                                    ├── Bedrock Knowledge Bases + Guardrails (Fase 4)
   │                                    └── AgentCore Observability (Fase 5)
```

### Decisiones de diseño ya tomadas
- **Contrato de API estable desde la Fase 0**: el front no cambia cuando el backend pasa de mock a agente real.
- **SSE para el chat**: streaming de texto del tutor.
- **API Gateway delante de las Lambdas (opción B)**: aporta throttling, planes de uso, autorizador de Cognito, validación de solicitudes y WAF sin tocar el código de los handlers. La Lambda conserva la lógica de negocio y la invocación al agente.
- **Ejecución de código solo en Code Interpreter** (Fase 2): nunca en la Lambda de la API.
- **El front llama a la API propia**, nunca directamente a AgentCore ni a Bedrock.
- **Infra como código desde la Fase 0** para tener una URL pública en el primer post.

---

## 5. Estructura del repositorio

```
tutor-agent/
├── .kiro/
│   ├── steering/            # product.md, tech.md, structure.md
│   └── specs/               # un spec por fase (fase-0-base, fase-1-tutor, ...)
├── web/                     # Vite + React + TypeScript
├── shared/                  # Contrato de API: esquemas zod y tipos TypeScript (web + api)
├── api/                     # Lambdas de la API (TypeScript, Node.js 22)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/handlers/        # un handler por endpoint o un handler enrutador
│   ├── src/lib/             # contenido, cliente de AgentCore, utilidades
│   └── tests/               # Vitest
├── agent/                   # Agente Strands para AgentCore Runtime (uv, Python 3.13)
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/agent/
│   └── tests/
├── infra/                   # CDK en TypeScript
│   ├── bin/app.ts
│   ├── lib/                 # web-stack, api-stack, agent-stack, content-stack, auth-stack
│   └── test/
├── content/                 # lecciones y ejercicios (Markdown + JSON)
├── scripts/                 # empaquetado, utilidades
├── docs/posts/              # borradores de cada post
└── README.md
```

---

## 6. Contrato de API (estable en todas las fases)

| Método | Ruta | Descripción | Respuesta |
|---|---|---|---|
| GET | `/api/modules` | Lista de módulos | `Module[]` |
| GET | `/api/modules/{id}/lesson` | Lección en Markdown | `{ moduleId, title, markdown }` |
| GET | `/api/exercises/{id}` | Ejercicio (sin solución) | `Exercise` |
| POST | `/api/chat` | Mensaje al tutor, respuesta por streaming | SSE: `token`, `done`, `error` |
| POST | `/api/hint` | Pista del nivel 1 a 3 | `{ level, text }` |
| POST | `/api/run` | Ejecuta código contra los tests | `RunResult` |
| GET | `/api/progress` | Progreso del alumno | `Progress` |

```ts
interface Module { id: string; title: string; exerciseCount: number }

interface Exercise {
  id: string; moduleId: string; title: string; statement: string;
  difficulty: 1 | 2 | 3; starterCode: string; hintsAvailable: number;
}

interface ChatRequest { sessionId: string; exerciseId: string; message: string }
// SSE: event: token  data: {"text": "..."}  |  event: done  data: {}  |  event: error  data: {"message": "..."}

interface HintRequest { exerciseId: string; level: 1 | 2 | 3 }

interface RunRequest { exerciseId: string; code: string }
interface RunResult {
  passed: boolean;
  tests: { name: string; passed: boolean; message?: string }[];
  stdout: string; stderr: string;
}

interface Progress { completedExerciseIds: string[]; totalExercises: number }
```

Reglas: el campo `solution` jamás aparece en una respuesta; la **fuente de verdad del contrato es `shared/`** (esquemas zod y tipos), consumida por `web/` y `api/`; el `openapi.json` se genera a partir de ella si se necesita documentación.

---

## 7. Modelo de contenido

### Currículo (8 módulos)
1. Primeros pasos: `print`, variables, tipos, `input`
2. Operadores y strings
3. Condicionales: `if/elif/else`, booleanos
4. Bucles: `for`, `while`, `range`
5. Listas y diccionarios
6. Funciones
7. Archivos y errores: `try/except`
8. Mini proyecto integrador

### Estructura por módulo
```
content/modulo-03-condicionales/
├── leccion.md            # explicación corta con analogías y ejemplos
├── ejercicios.json       # ver esquema
└── errores-comunes.md    # fallos típicos y cómo explicarlos
```

### Esquema de `ejercicios.json`
```json
{
  "id": "m03-e01",
  "moduleId": "modulo-03-condicionales",
  "title": "Clasifica edades",
  "statement": "...",
  "difficulty": 1,
  "prerequisites": ["modulo-02"],
  "starterCode": "def clasificar(edad):\n    pass\n",
  "hints": ["nivel 1", "nivel 2", "nivel 3"],
  "tests": [{ "name": "menor de edad", "call": "clasificar(15)", "expected": "menor" }],
  "solution": "solo servidor"
}
```

Fase 0 entrega el módulo 3 con 3 ejercicios; el resto del currículo llega en la Fase 4.

---

## 8. Fases, entregables y posts

Cada fase tiene su propio spec en `.kiro/specs/`. El criterio de cierre de toda fase es **"se puede probar en el navegador"** y se etiqueta en git (`fase-0`, `fase-1`, ...).

### Fase 0: Base (front + API mock + infraestructura mínima)
- Repo, steering, estructura y README con roadmap.
- Front Vite + React con layout de tres zonas: lección, editor (Monaco) con resultados, chat con el tutor.
- API en TypeScript (Node.js 22) con el contrato completo y respuestas fijas (chat simulado con streaming SSE).
- Paquete `shared/` con los esquemas zod y tipos del contrato.
- Módulo 3 de ejemplo.
- CDK: stack de web (S3 + CloudFront) y stack de API (API Gateway REST con `NodejsFunction` arm64 detrás, CORS y streaming en `/api/chat`).
- Pruebas: Vitest en front y API, tests de assertions básicos en CDK.
- El proyecto Python con uv (`agent/`) se crea en la Fase 1.
- **Post 1:** cómo planificar un proyecto de agentes con Kiro (spec-driven).

### Fase 1: Tutor real
- Agente Strands con prompt socrático y pistas en 3 niveles.
- Despliegue en **AgentCore Runtime con direct code deploy**.
- La API invoca el agente y retransmite el stream por SSE.
- **Post 2:** primer agente tutor con Strands, Bedrock y AgentCore Runtime.

### Fase 2: Ejecución de código
- Integrar **AgentCore Code Interpreter** como herramienta del agente.
- `/api/run` ejecuta el código del alumno contra los tests y devuelve `RunResult`.
- Límites de tiempo, memoria y sin acceso a red para el código del alumno.
- **Post 3:** ejecución segura de código con Code Interpreter.

### Fase 3: Memoria y progreso
- **AgentCore Memory** para nivel, conceptos dominados y débiles, y preferencias.
- Panel de progreso en el front.
- **Post 4:** un agente que recuerda.

### Fase 4: Contenido y guardrails
- Currículo completo (8 módulos) cargado en una Knowledge Base.
- Bedrock Guardrails (temas fuera de alcance, intento de obtener la solución directa, contenido inapropiado).
- **Post 5:** RAG y guardrails para un tutor confiable.

### Fase 5: Producción
- Login con Cognito, autorizador de Cognito en API Gateway y autenticación hacia el agente (AgentCore Identity si aplica).
- Throttling y plan de uso en API Gateway, y AWS WAF delante si se justifica por costo.
- Observabilidad (AgentCore Observability, métricas y alarmas), presupuestos y control de costos.
- Dominio `.dev` con ACM y Route 53.
- **Post 6:** producción, observabilidad y costos reales.

---

## 9. Infraestructura (CDK, TypeScript)

| Stack | Recursos | Fase |
|---|---|---|
| `WebStack` | S3, CloudFront (OAC), despliegue del build de `web/` | 0 |
| `ApiStack` | API Gateway REST (recursos, validación de solicitudes, CORS, throttling, logs de acceso) y `NodejsFunction` (Node.js 22, arm64, bundling esbuild) como integración; streaming en `/api/chat` | 0 |
| `AgentStack` | Artefacto S3, AgentCore Runtime (direct code deploy), roles IAM, permisos a Bedrock | 1 |
| `AgentStack` (ampliación) | Code Interpreter, Memory | 2, 3 |
| `ContentStack` | Bucket de contenido, Knowledge Base, Guardrails | 4 |
| `AuthStack` | Cognito User Pool y app client, dominio y certificado | 5 |

Reglas CDK:
- Una `App` con stacks por responsabilidad; salidas (`CfnOutput`) para URLs y ARNs.
- Permisos de IAM de mínimo privilegio; sin credenciales en código ni en variables del front.
- Configuración por contexto (`cdk.json`) o variables: región, ID del modelo, nombre del proyecto.
- Etiquetas (`Project`, `Phase`) en todos los recursos para seguimiento de costos.
- `cdk synth` y los tests de CDK deben pasar antes de `cdk deploy`.
- Verificar con la documentación actual qué constructs de AgentCore existen (L2 o L1) y su soporte de direct code deploy.

---

## 10. Requisitos no funcionales

- **Seguridad:** la solución de referencia solo en servidor; el código del alumno solo se ejecuta en Code Interpreter; CORS restringido; sin secretos en el front; validación de entrada en la API.
- **Rendimiento:** primer token del tutor visible en menos de 3 s en condiciones normales.
- **Costos:** estimación por alumno documentada en cada fase; límite de tokens por mensaje y por sesión; presupuesto con alarma.
- **Observabilidad:** logs estructurados y un identificador de sesión en cada solicitud.
- **Accesibilidad:** editor y chat navegables con teclado; contraste adecuado.
- **Calidad:** TypeScript strict; tipos y contrato sincronizados; linters (ruff en Python, ESLint en el front).

---

## 11. Estrategia de pruebas

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Front | Vitest + React Testing Library | Cliente de API, streaming SSE, estados de botones, panel de resultados |
| API | Vitest | Contrato de cada handler (con esquemas de `shared/`) y ausencia de `solution` |
| Agente | `uv run pytest` | Herramientas, reglas de pistas, prompt (evaluaciones con casos fijos) |
| Infra | Jest en CDK (assertions) | Recursos clave, permisos y salidas |
| E2E manual | Navegador | Recorrido: abrir módulo, chatear, pedir pistas, ejecutar, completar |

Evaluación del tutor (Fase 1 en adelante): conjunto de conversaciones de prueba donde el alumno pide la solución directamente; el agente no debe entregarla antes del nivel 3.

---

## 12. Decisiones abiertas

1. Nombre del proyecto y dominio `.dev`.
2. Estilos del front: CSS Modules o Tailwind.
3. Persistencia del progreso: solo AgentCore Memory o también DynamoDB.
4. Decidido: **API Gateway REST + Lambda (opción B)**. Pendiente validar el streaming de respuesta de API Gateway REST con `NodejsFunction` en la región elegida; si no es viable, usar una Function URL en `RESPONSE_STREAM` solo para `/api/chat`, manteniendo API Gateway para el resto.
4b. Una Lambda enrutadora para todos los endpoints o una Lambda por endpoint. Recomendado: una Lambda por responsabilidad (contenido, chat/pistas, ejecución, progreso) para permisos de IAM mínimos y despliegues independientes.
5. Región de despliegue y disponibilidad de AgentCore (Runtime, Memory, Code Interpreter) y del modelo elegido.
6. Generar `openapi.json` desde los esquemas zod de `shared/` (por ejemplo con `zod-to-openapi`) o prescindir de él.
7. Autenticación hacia el agente: JWT de Cognito con AgentCore Identity o IAM desde la Lambda.

---

## 13. Instrucciones para Kiro

1. Leer este documento completo y los steering files antes de crear cualquier spec.
2. Crear **un spec por fase**, empezando por `fase-0-base`; no mezclar fases.
3. En cada spec: requisitos en formato EARS, diseño con diagramas y contrato, y tareas pequeñas enlazadas a requisitos.
4. Cada spec debe incluir tareas de **front, API/agente, infraestructura CDK y pruebas**, y una tarea final de documentación y borrador del post.
5. Respetar las restricciones de la sección 2 en todas las tareas: Lambdas en TypeScript con `NodejsFunction`, CDK en TypeScript, agente en Python 3.13 con uv, y direct code deploy tanto en Lambdas como en AgentCore Runtime.
6. No implementar funcionalidades de fases posteriores; dejar los puntos de extensión del contrato.
7. Antes de usar un servicio de AgentCore o un construct de CDK, consultar la documentación vigente (por ejemplo con el MCP de documentación de AWS) y registrar en el diseño cualquier limitación encontrada.
8. Ante una decisión abierta (sección 12), proponer una opción recomendada en el diseño y dejarla marcada para confirmación.
