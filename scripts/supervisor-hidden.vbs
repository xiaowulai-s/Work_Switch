' WorkSwitch supervisor hidden launcher (all-in-one package).
' Starts scripts\supervisor.js with the bundled Node runtime, fully hidden.
' ASCII only: WSH reads this file with the user code page.

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
node = scriptDir & "\runtime\node\node.exe"
If Not fso.FileExists(node) Then node = "node.exe"

shell.CurrentDirectory = scriptDir
shell.Run """" & node & """ """ & scriptDir & "\supervisor.js""", 0, False
