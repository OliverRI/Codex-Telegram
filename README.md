# Codex Telegram Bridge

Servicio en TypeScript para enviar ordenes desde Telegram a agentes de Codex en Windows. Esta primera version usa `codex exec` y `codex exec resume` por debajo, con una capa propia de colas, permisos y estado persistente para que luego podamos sustituir el adaptador por `app-server` sin cambiar los comandos del bot.

## Que incluye

- Bot de Telegram con `/agents`, `/status`, `/last`, `/run`, `/new` y `/whoami`
- ACL global por `user_id` y `chat_id`
- ACL por agente
- Cola por agente para evitar ejecuciones solapadas
- Persistencia local de `thread_id`, jobs y ultimo estado
- Adaptador de Codex desacoplado

## Requisitos

- Node.js 20+
- `codex` instalado y autenticado en la misma maquina
- Un bot de Telegram creado con BotFather

## Arranque rapido

1. Instala dependencias:

```powershell
npm install
```

2. Crea tu `.env` a partir de `.env.example`.

3. Copia [config/agents.example.json](/D:/OneDrive/Escritorio/Programacion/Codex%20Telegram/config/agents.example.json) a `config/agents.local.json` y edita ese archivo privado. El repo solo publica el ejemplo.

4. Lanza el servicio:

```powershell
npm run dev
```

## Variables de entorno

- `TELEGRAM_BOT_TOKEN`
- `ALLOWED_TELEGRAM_USER_IDS`
- `ALLOWED_TELEGRAM_CHAT_IDS`
- `AGENTS_FILE`
- `STATE_FILE`
- `CODEX_BIN`
- `DEFAULT_RUN_TIMEOUT_MS`

## Formato de agentes

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
      "forceNewThreadOnEachRun": false,
      "allowedTelegramUserIds": [123456789],
      "allowedChatIds": [],
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

## Dejarlo siempre encendido en Windows

La forma mas practica en este proyecto es ejecutarlo en modo produccion y registrarlo como tarea programada al iniciar sesion.

### Preparacion

1. Verifica que [`.env`](/D:/OneDrive/Escritorio/Programacion/Codex%20Telegram/.env) y `config/agents.local.json` ya funcionan con `npm run dev`.
2. Compila el proyecto:

```powershell
npm run build
```

3. Instala la tarea programada:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1
```

### Arranque manual inmediato

Para no esperar al siguiente inicio de sesion:

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

Los logs se escriben en:

- `logs/bridge.stdout.log`
- `logs/bridge.stderr.log`

El script [scripts/start-bridge.ps1](/D:/OneDrive/Escritorio/Programacion/Codex%20Telegram/scripts/start-bridge.ps1) reinicia el proceso si se cae, para que no tengas que volver a abrirlo a mano.

## Siguientes pasos recomendados

- Pasar el adaptador a `codex app-server`
- Anadir aprobaciones para comandos sensibles
- Exponer `pause`, `cancel` y plantillas de tareas
- Persistir auditoria en SQLite
