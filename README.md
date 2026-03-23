# Codex Telegram Bridge

Puente en TypeScript para enviar ordenes desde Telegram a agentes de Codex en Windows.

Esta version funciona como servicio local: Telegram recibe el comando, el bridge lo enruta al agente configurado y Codex responde usando `exec` o `exec resume`, con persistencia de hilos, colas por agente y control basico de acceso.

## Que hace

- Expone comandos de Telegram como `/agents`, `/status`, `/run`, `/new` y `/last`
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

## Variables de entorno

Ejemplo minimo:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
ALLOWED_TELEGRAM_USER_IDS=123456789
ALLOWED_TELEGRAM_CHAT_IDS=
AGENTS_FILE=./config/agents.local.json
STATE_FILE=./data/state.json
CODEX_BIN=C:\Users\Oliver\AppData\Roaming\npm\codex.cmd
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
- `DEFAULT_RUN_TIMEOUT_MS`: timeout maximo por ejecucion
- `addDirs`: directorios extra accesibles para el agente en ejecuciones nuevas
- `pathHints`: alias de lenguaje natural para rutas reales como `Escritorio` o `Desktop`
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
      "addDirs": [],
      "pathHints": {},
      "extraArgs": []
    }
  ]
}
```

## Comandos de Telegram

- `/agents`
- `/status <agentId>`
- `/last <agentId>`
- `/run <agentId> <prompt>`
- `/new <agentId> <prompt>`
- `/whoami`

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
- Usa `codex exec` y `codex exec resume`, no `app-server`
- El estado persistente esta en JSON, no en SQLite
- Esta pensado para Windows y uso local

## Roadmap

- Migrar el adaptador a `codex app-server`
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
