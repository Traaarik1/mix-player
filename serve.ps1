# Локальный сервер для Mix: powershell -ExecutionPolicy Bypass -File serve.ps1
param([int]$Port = 5173, [switch]$NoOpen)
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.wasm' = 'application/wasm'; '.ico' = 'image/x-icon'; '.mp3' = 'audio/mpeg'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() }
catch {
  # Mix уже запущен: просто открываем его ещё раз
  if (-not $NoOpen) { Start-Process "http://localhost:$Port" }
  exit 0
}
Write-Host "Mix: http://localhost:$Port  (Ctrl+C - stop)"
if (-not $NoOpen) { Start-Process "http://localhost:$Port" }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  # Импорт плейлиста из Spotify: браузер сам страницу Spotify прочитать не может, сервер Mix пересылает её
  if ($path -eq 'proxy') {
    $res = $ctx.Response
    $u = $ctx.Request.QueryString['u']
    if ($u -match '^https://open\.spotify\.com/embed/(playlist|album)/[A-Za-z0-9]+$' -or $u -match '^https://music\.apple\.com/[a-z]{2}/(playlist|album)/[^?#]+$') {
      try {
        $page = Invoke-WebRequest -Uri $u -UseBasicParsing -UserAgent 'Mozilla/5.0' -TimeoutSec 20
        $bytes = [Text.Encoding]::UTF8.GetBytes($page.Content)
        $res.ContentType = 'text/html; charset=utf-8'
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } catch { $res.StatusCode = 502 }
    } else { $res.StatusCode = 403 }
    $res.Close(); continue
  }
  if ($path -eq '') { $path = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  $res = $ctx.Response
  if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-cache')
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $res.StatusCode = 404 }
  $res.Close()
}
