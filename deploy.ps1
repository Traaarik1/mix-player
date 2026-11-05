# Подготовка Mix к публикации: powershell -ExecutionPolicy Bypass -File deploy.ps1
# Обновляет версию и список файлов в sw.js. Сама ничего не публикует.
# С ключом -Push ещё и отправляет изменения на GitHub (git add, commit, push), если репозиторий уже создан.
param([switch]$Push, [string]$Message = 'Обновление Mix')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = $PSScriptRoot
$sw = Join-Path $root 'sw.js'

$files = New-Object System.Collections.ArrayList
foreach ($f in 'index.html', 'manifest.webmanifest') { [void]$files.Add($f) }
foreach ($pat in @(@('css', '*.css'), @('icons', '*.png'), @('js', '*.js'), @('vendor', '*.js'), @('vendor', '*.wasm'))) {
  $dir = Join-Path $root $pat[0]
  if (Test-Path $dir) {
    Get-ChildItem $dir -Recurse -File -Filter $pat[1] | Sort-Object FullName | ForEach-Object {
      [void]$files.Add($_.FullName.Substring($root.Length + 1).Replace('\', '/'))
    }
  }
}
foreach ($f in $files) { if (-not (Test-Path (Join-Path $root $f))) { throw "Нет файла: $f" } }

$utf8 = New-Object Text.UTF8Encoding($false)
$text = [IO.File]::ReadAllText($sw, $utf8)
$nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }
$list = "// PRECACHE:BEGIN$nl" + "const APP = [$nl" + (($files | ForEach-Object { "  '$_'," }) -join $nl) + "$nl];$nl// PRECACHE:END"
if ($text -notmatch '(?s)// PRECACHE:BEGIN.*// PRECACHE:END') { throw 'В sw.js не найден список файлов' }
$text = [regex]::Replace($text, '(?s)// PRECACHE:BEGIN.*// PRECACHE:END', { param($m) $list })
$version = Get-Date -Format 'yyyy-MM-dd-HHmm'
$text = [regex]::Replace($text, "const VERSION = '[^']*';", "const VERSION = '$version';")
[IO.File]::WriteAllText($sw, $text, $utf8)
Write-Host "sw.js: версия $version, файлов в списке: $($files.Count)"

if ($Push) {
  if (-not (Test-Path (Join-Path $root '.git'))) { throw 'Репозиторий ещё не создан. Сначала сделай шаги из docs/DEPLOY.md' }
  git -C $root add -A
  git -C $root commit -m $Message
  git -C $root push
  Write-Host 'Отправлено. Сайт обновится через пару минут.'
} else {
  Write-Host 'Дальше: открой GitHub Desktop, нажми Commit to main, затем Push origin.'
}
