Dim shell, fso, scriptDir, psPath, startScript, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
psPath = shell.ExpandEnvironmentStrings("%WINDIR%\System32\WindowsPowerShell\v1.0\powershell.exe")
startScript = fso.BuildPath(scriptDir, "start-bridge.ps1")
command = """" & psPath & """ -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & startScript & """"

shell.Run command, 0, False
