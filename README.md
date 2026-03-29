# Codex Telegram Bridge

Puente en TypeScript para enviar ordenes desde Telegram a agentes de Codex en Windows.

Esta version funciona como servicio local: Telegram recibe el comando, el bridge lo enruta al agente configurado y Codex responde con `app-server` como transporte principal y `exec` como fallback configurable, con persistencia de hilos, colas por agente y control basico de acceso.

## Que hace

- Expone una experiencia en Telegram mas cercana a un asistente personal
- Muestra comandos en espanol como `/agentes`, `/estado`, `/ejecutar`, `/nuevo` y `/ultimo`
- Mantiene un hilo independiente por agente
- Serializa tareas por agente para evitar solapes
- Guarda estado local de jobs y `thread_id`
- Permite separar agentes por proyecto, repo o funcion
- Incluye scripts para dejarlo corriendo al iniciar sesion en Windows

## Requisitos

- Windows
- Node.js 20+
- `codex` instalado y autenticado en la misma maquina
- Un bot de Telegram creado con BotFather

## Estructura de configuracion

El repositorio publica solo ejemplos. Tu configuracion real debe quedarse fuera de Git.

- `.env.example`: ejemplo de variables de entorno
- `config/agents.example.json`: ejemplo de agentes
- `config/agents.local.json`: tu configuracion real, ignorada por Git

## Instalacion rapida

1. Instala dependencias:

```powershell
npm install
```

2. Crea tu archivo `.env` a partir de [`.env.example`](.env.example).

3. Copia [config/agents.example.json](config/agents.example.json) a `config/agents.local.json`.

4. Edita `.env` y `config/agents.local.json`.

5. Arranca en modo desarrollo:

```powershell
npm run dev
```

## Vincular Gmail en 2 minutos

Este proyecto ya no necesita Google Cloud ni OAuth para Gmail.

La vinculacion se hace con tu propia sesion web local:

1. Pon `permissions.gmailAccess=true` en el agente que vaya a usar Gmail.
2. Ejecuta:

```powershell
npm run auth:gmail
```

3. Se abrira tu navegador local.
4. Inicia sesion en Gmail si hace falta.
5. Cuando veas la bandeja de entrada, vuelve a la consola y pulsa Enter.

Eso guardara una sesion local en `./secrets/gmail-storage-state.json`, que no se sube a Git.

Prueba inicial recomendada:

```text
/nuevo Omega revisa mi Gmail no leido
```

Prueba segura de envio:

```text
/nuevo Omega redacta y envia un correo de prueba a mi propia cuenta con asunto Prueba Codex Telegram
```

## Variables de entorno

Ejemplo minimo:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
ALLOWED_TELEGRAM_USER_IDS=123456789
ALLOWED_TELEGRAM_CHAT_IDS=
AGENTS_FILE=./config/agents.local.json
STATE_FILE=./data/state.json
CODEX_BIN=C:\Users\Oliver\AppData\Roaming\npm\codex.cmd
CODEX_TRANSPORT=app-server
LOG_LEVEL=info
DEFAULT_RUN_TIMEOUT_MS=900000
```

Campos:

- `TELEGRAM_BOT_TOKEN`: token del bot de Telegram
- `ALLOWED_TELEGRAM_USER_IDS`: usuarios permitidos globalmente
- `ALLOWED_TELEGRAM_CHAT_IDS`: chats permitidos globalmente
- `AGENTS_FILE`: ruta al archivo privado de agentes
- `STATE_FILE`: ruta del estado persistente
- `CODEX_BIN`: binario de Codex
- `CODEX_TRANSPORT`: `app-server` para integracion nativa de skills locales o `exec` como fallback
- `BROWSER_CHANNEL`: navegador local que usara el bridge para integraciones web (`msedge` o `chrome`)
- `GMAIL_STORAGE_STATE_FILE`: sesion web persistida de Gmail para lectura y envio desde el bridge
- `DEFAULT_RUN_TIMEOUT_MS`: timeout maximo por ejecucion
- `addDirs`: directorios extra accesibles para el agente en ejecuciones nuevas
- `pathHints`: alias de lenguaje natural para rutas reales como `Escritorio` o `Desktop`
- `permissions.webAccess`: habilita o bloquea el uso de web para ese agente; por defecto debe quedarse en `false`
- `permissions.gmailAccess`: habilita o bloquea el uso de Gmail para ese agente; por defecto debe quedarse en `false`
- `allowedSkills`: lista de habilidades que ese agente puede activar desde Telegram; usa `["*"]` para permitir cualquier skill instalada
- `dangerouslyBypassApprovalsAndSandbox`: desactiva el sandbox de Codex para ese agente; util solo cuando el sandbox de Windows falle y el agente sea de confianza

## Ejemplo de agentes

Archivo `config/agents.local.json`:

```json
{
  "agents": [
    {
      "id": "backend",
      "name": "Backend Agent",
      "cwd": "D:\\Repos\\my-project",
      "model": "gpt-5.4",
      "sandbox": "workspace-write",
      "skipGitRepoCheck": false,
      "fullAuto": true,
      "dangerouslyBypassApprovalsAndSandbox": false,
      "forceNewThreadOnEachRun": false,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
      "permissions": {
        "webAccess": false,
        "gmailAccess": false
      },
      "allowedSkills": ["aspnet-core"],
      "addDirs": [
        "D:\\Users\\YourUser\\Desktop"
      ],
      "pathHints": {
        "desktop": "D:\\Users\\YourUser\\Desktop",
        "escritorio": "D:\\Users\\YourUser\\Desktop"
      },
      "extraArgs": []
    },
    {
      "id": "review-backend",
      "name": "Backend Reviewer",
      "cwd": "D:\\Repos\\my-project",
      "model": "gpt-5.4",
      "sandbox": "read-only",
      "skipGitRepoCheck": false,
      "fullAuto": true,
      "dangerouslyBypassApprovalsAndSandbox": false,
      "forceNewThreadOnEachRun": true,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
      "permissions": {
        "webAccess": false,
        "gmailAccess": false
      },
      "allowedSkills": [],
      "addDirs": [],
      "pathHints": {},
      "extraArgs": []
    }
  ]
}
```

## Patron recomendado: un agente principal

La forma mas comoda de usar el bridge es tener:

- un agente principal o coordinador
- uno o varios agentes especialistas

Ejemplo:

- `Omega`: coordinador general
- `Fenix`: especialista del proyecto Fenix
- `Telegram`: especialista del propio bridge

Tu flujo diario puede ser simplemente hablar con `Omega`:

- `/new Omega revisa el proyecto y delega si hace falta`
- `/run Omega busca este archivo y enviamelo`
- `/run Omega analiza el bot y si conviene delega en Telegram`

Con la delegacion entre agentes, `Omega` puede pedir ayuda localmente a otros agentes configurados sin que tengas que invocarlos tu a mano.

## Ejemplo de arquitectura coordinador + especialistas

En un setup compartible, una estructura buena es:

```json
{
  "agents": [
    {
      "id": "coordinator",
      "name": "Coordinator Agent",
      "cwd": "D:\\Workspaces",
      "model": "gpt-5.4",
      "sandbox": "workspace-write",
      "skipGitRepoCheck": true,
      "fullAuto": true,
      "dangerouslyBypassApprovalsAndSandbox": false,
      "forceNewThreadOnEachRun": false,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
      "permissions": {
        "webAccess": false,
        "gmailAccess": false
      },
      "allowedSkills": ["*"],
      "addDirs": [
        "D:\\Users\\YourUser\\Desktop",
        "D:\\Repos\\my-project",
        "D:\\Repos\\telegram-bridge"
      ],
      "pathHints": {
        "desktop": "D:\\Users\\YourUser\\Desktop",
        "escritorio": "D:\\Users\\YourUser\\Desktop",
        "project": "D:\\Repos\\my-project",
        "bridge": "D:\\Repos\\telegram-bridge"
      },
      "extraArgs": []
    },
    {
      "id": "backend",
      "name": "Backend Agent",
      "cwd": "D:\\Repos\\my-project",
      "model": "gpt-5.4",
      "sandbox": "workspace-write",
      "skipGitRepoCheck": false,
      "fullAuto": true,
      "dangerouslyBypassApprovalsAndSandbox": false,
      "forceNewThreadOnEachRun": false,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
      "permissions": {
        "webAccess": false,
        "gmailAccess": false
      },
      "allowedSkills": ["aspnet-core"],
      "addDirs": [],
      "pathHints": {},
      "extraArgs": []
    },
    {
      "id": "bridge",
      "name": "Bridge Agent",
      "cwd": "D:\\Repos\\telegram-bridge",
      "model": "gpt-5.4",
      "sandbox": "workspace-write",
      "skipGitRepoCheck": false,
      "fullAuto": true,
      "dangerouslyBypassApprovalsAndSandbox": false,
      "forceNewThreadOnEachRun": false,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
      "permissions": {
        "webAccess": false,
        "gmailAccess": false
      },
      "allowedSkills": ["telegram-codex-bridge"],
      "addDirs": [],
      "pathHints": {},
      "extraArgs": []
    }
  ]
}
```

Regla practica:

- habla normalmente con el coordinador
- usa los especialistas solo cuando quieras dirigir una tarea de forma manual

## Comandos de Telegram

- `/agentes`
- `/habilidades [agente]`
- `/estado <agente>`
- `/ultimo <agente>`
- `/ejecutar <agente> [--habilidades skill1,skill2] <mensaje>`
- `/nuevo <agente> [--habilidades skill1,skill2] <mensaje>`
- `/quiensoy`
- `/ayuda`

Por compatibilidad, el bridge sigue aceptando los alias anteriores en ingles (`/agents`, `/status`, `/run`, `/new`, `/last`, `/whoami`, `/help`), pero la interfaz publica del bot ya se presenta en espanol.

## Habilidades de Codex desde Telegram

Puedes activar skills locales desde Telegram si el agente tiene permiso para usarlas.

Configuracion por agente:

```json
{
  "allowedSkills": ["aspnet-core", "pdf"]
}
```

Reglas:

- `allowedSkills=[]`: el agente no puede activar habilidades
- `allowedSkills=["*"]`: el agente puede usar cualquier skill instalada localmente
- las habilidades se descubren en `skills/` del repo, en `%USERPROFILE%\\.codex\\skills` y en los plugins instalados por Codex como Gmail o Google Drive
- el bridge solo activa las skills que pidas explicitamente o las que menciones como `$nombre`
- con `CODEX_TRANSPORT=app-server`, las skills locales y de `%USERPROFILE%\\.codex\\skills` se inyectan como skills nativas del runtime en vez de solo como texto

Formas de uso:

- `/habilidades` para ver skills instaladas
- `/habilidades <agente>` para ver las que puede usar ese agente
- `/ejecutar Fenix --habilidades aspnet-core revisa este proyecto`
- `/nuevo Fenix usa $aspnet-core para revisar la arquitectura`

Limites:

- maximo 3 habilidades por ejecucion
- la allowlist se aplica por agente
- si una skill no esta instalada o no esta permitida, el bridge rechaza la ejecucion antes de encolarla
- las skills de conectores curados como Gmail, Google Drive o Google Calendar siguen dependiendo de que el runtime exponga esos plugins como herramientas reales; hoy el bridge no los tiene operativos aunque el plugin este habilitado en Codex

## Permisos de web y Gmail

Los permisos se configuran por agente en `config/agents.local.json`, dentro de `permissions`:

```json
{
  "permissions": {
    "webAccess": false,
    "gmailAccess": false
  }
}
```

Reglas:

- `webAccess=false`: el bridge instruye al agente para no navegar ni buscar en internet
- `webAccess=true`: el agente puede usar web cuando la tarea lo necesite
- `gmailAccess=false`: el bridge instruye al agente para no leer ni enviar correo con Gmail
- `gmailAccess=true`: el agente solo debe usar Gmail si existe una integracion real disponible en el runtime
- Si omites `permissions`, ambos permisos quedan en `false`

Si cambias estos permisos, usa `/new <agentId> ...` para abrir un hilo nuevo y evitar que el agente siga arrastrando contexto anterior.

## Integracion propia de Gmail

El bridge ya puede consultar y enviar correos de Gmail usando una sesion web local cuando:

- `permissions.gmailAccess=true` en el agente
- existe `GMAIL_STORAGE_STATE_FILE`

Preparacion local:

1. Ejecuta:

```powershell
npm run auth:gmail
```

2. Se abrira tu navegador local.
3. Inicia sesion en Gmail manualmente.
4. Cuando la bandeja este visible, vuelve a la consola y pulsa Enter.

Eso guardara la sesion en `./secrets/gmail-storage-state.json`.

Puntos importantes:

- no necesitas crear un cliente OAuth
- no necesitas Google Cloud Console
- la sesion queda solo en local, fuera de Git
- si Gmail te vuelve a pedir login, solo repite `npm run auth:gmail`

Comportamiento actual:

- si el prompt habla de Gmail, correo, email, inbox o bandeja y el agente tiene permiso, el bridge consulta Gmail antes de lanzar el turno
- el agente recibe un bloque `GMAIL_CONTEXT` con datos reales extraidos de la sesion web del usuario
- si el agente decide enviar un correo, el bridge lo ejecuta con la misma sesion web local
- el envio se hace desde el bridge, no desde un conector MCP externo

Ejemplos:

- `/nuevo Omega revisa mi Gmail`
- `/nuevo Omega revisa mi correo no leido`
- `/nuevo Omega revisa mi Gmail de usuario@dominio.com`
- `/nuevo Omega redacta y envia un correo a usuario@dominio.com con asunto Seguimiento`
- `/nuevo Omega responde a este correo con un mensaje breve y envialo`

## Envio de archivos a Telegram

El bridge puede adjuntar archivos si el usuario los pide expresamente y el agente consigue localizarlos.

Condiciones:

- El archivo debe existir de verdad
- Debe estar dentro de `cwd` o de alguna ruta declarada en `addDirs`
- El agente debe devolver la ruta absoluta en el bloque interno de adjuntos que usa el bridge
- El bot envia como maximo 5 archivos por respuesta
- Se aplica un limite prudente de tamano por archivo para evitar fallos de envio

Para que funcione bien en Windows:

- Declara rutas extra en `addDirs`
- Declara alias utiles en `pathHints`, por ejemplo `desktop` o `escritorio`
- Si acabas de cambiar esas rutas, usa `/new <agentId> ...` para abrir un hilo nuevo

## Colaboracion entre agentes

El bridge ya puede orquestar una delegacion simple entre agentes.

Flujo:

- Un agente responde normalmente
- Si necesita ayuda de otro, devuelve un bloque interno `agent_handoff`
- El bridge ejecuta al agente objetivo
- Si `return_to_source=true`, el bridge reanuda despues el agente original con la respuesta del agente delegado

La delegacion esta limitada de forma intencional:

- Solo se procesa un handoff por ejecucion
- No se permite delegar en el mismo agente
- La delegacion debe respetar los permisos del usuario y del agente objetivo
- El retorno al agente origen se programa como una nueva ejecucion para evitar bloqueos de cola

Esto permite patrones como:

- `Omega` delega analisis de codigo en `Fenix`
- `Fenix` devuelve hallazgos
- `Omega` retoma el hilo y responde al usuario con una conclusion final

## Flujo recomendado

1. Arranca el bridge con `npm run dev`
2. Habla con el bot en Telegram
3. Ejecuta `/whoami` para obtener tu `user_id`
4. Mete ese `user_id` en `.env` y en `config/agents.local.json`
5. Reinicia el bridge
6. Si has cambiado `addDirs` o `pathHints`, usa `/new <agentId> ...` al menos una vez para arrancar un hilo nuevo con ese contexto
7. Prueba `/agents`, `/status <agentId>` y `/new <agentId> <prompt>`

## Dejarlo siempre encendido en Windows

La forma mas simple de operarlo es compilarlo y registrarlo como tarea programada al iniciar sesion.

### Preparacion

1. Verifica que `.env` y `config/agents.local.json` funcionan con `npm run dev`
2. Compila el proyecto:

```powershell
npm run build
```

3. Instala la tarea:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1
```

### Arranque manual inmediato

```powershell
Start-ScheduledTask -TaskName CodexTelegramBridge
```

### Reinicio rapido con BAT

Si quieres recompilar, dejar actualizada la tarea programada y reiniciar el bridge de una vez, puedes usar:

```bat
scripts\restart-bridge.bat
```

Este `.bat` hace tres cosas:

- ejecuta `npm run build`
- intenta registrar o actualizar la tarea `CodexTelegramBridge`
- si Windows no deja crear la tarea, instala un acceso directo oculto en la carpeta `Inicio` del usuario
- la reinicia y te muestra su estado

Ademas deja el bridge configurado para iniciarse automaticamente al iniciar sesion en Windows, incluso sin permisos de administrador.

### Ver estado

```powershell
Get-ScheduledTask -TaskName CodexTelegramBridge
Get-ScheduledTaskInfo -TaskName CodexTelegramBridge
```

### Parar

```powershell
Stop-ScheduledTask -TaskName CodexTelegramBridge
```

### Desinstalar

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-startup-task.ps1
```

### Logs

- `logs/bridge.stdout.log`
- `logs/bridge.stderr.log`

El script [scripts/start-bridge.ps1](scripts/start-bridge.ps1) reinicia el proceso si se cae.

## Seguridad

- No publiques `.env`
- No publiques `config/agents.local.json`
- Usa agentes `read-only` para tareas de revision
- Usa `workspace-write` solo en repos concretos
- Activa `dangerouslyBypassApprovalsAndSandbox` solo en agentes locales de confianza y solo cuando el sandbox de Windows falle de verdad
- Evita usar un agente apuntando a `D:\` o rutas demasiado amplias salvo que lo necesites de verdad
- Si expones el bot en grupos, limita usuarios y chats permitidos

## Limitaciones actuales

- Depende de una instalacion local de Codex ya autenticada
- Usa `codex app-server` como transporte principal; `exec` queda como fallback configurable
- El estado persistente esta en JSON, no en SQLite
- Esta pensado para Windows y uso local
- Las skills locales ya se pueden pasar al runtime de forma nativa con `app-server`
- Los conectores curados tipo Gmail, Google Drive y Google Calendar siguen sin quedar expuestos como herramientas efectivas para el bridge aunque el plugin este habilitado en Codex
- Gmail ya tiene una integracion propia por sesion web local para lectura, busqueda y envio; Google Drive aun no

## Roadmap

- Conseguir que `app-server` exponga conectores curados como Gmail y Google Drive dentro del bridge
- Anadir aprobaciones para acciones sensibles
- Anadir cancelacion y plantillas de tareas
- Mover el estado a SQLite
- Empaquetarlo mejor como skill de Codex o instalacion guiada

## Skill de Codex

El repo incluye una skill reutilizable en [skills/telegram-codex-bridge](skills/telegram-codex-bridge) para que Codex pueda ayudarte a instalar, configurar y operar este bridge sin meter secretos ni agentes privados en Git.

### Instalar la skill en tu Codex local

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-codex-skill.ps1
```

Luego puedes pedirle a Codex algo como:

```text
Usa $telegram-codex-bridge para configurar este repo sin exponer secretos en Git.
```

### Desinstalar la skill

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-codex-skill.ps1
```

## Licencia

MIT. Consulta [LICENSE](LICENSE).
