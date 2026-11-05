# Ярлык Mix на рабочем столе: powershell -ExecutionPolicy Bypass -File make-shortcut.ps1
# Запускает локальный сервер без окна и открывает плеер. Повторный запуск просто открывает плеер.
$root = $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $desktop 'Mix.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\serve.ps1`""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$root\icons\mix.ico"
$lnk.Description = 'Mix music player'
$lnk.Save()
Write-Output "Created: $desktop\Mix.lnk"
