# Bundles index.html + css + js into one file (dist/prototype.html) for publishing as a claude.ai Artifact.
# The Artifact publisher wraps the page in its own <html>/<head>/<body>, so those tags are stripped.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$utf8 = New-Object System.Text.UTF8Encoding($false)
$read = { param($p) [IO.File]::ReadAllText((Join-Path $Root $p), $utf8) }
$html = & $read 'index.html'

$html = $html.Replace('<link rel="stylesheet" href="css/styles.css">', "<style>`n" + (& $read 'css/styles.css') + "`n</style>")
foreach ($m in [regex]::Matches($html, '<script src="(js/[a-z]+\.js)"></script>')) {
  $js = & $read $m.Groups[1].Value
  if ($js.Contains('</script')) { throw "$($m.Groups[1].Value) contains a closing script tag" }
  $html = $html.Replace($m.Value, "<script>`n" + $js + "`n</script>")
}
foreach ($t in @('<!doctype html>', '<html lang="ru">', '<head>', '</head>', '<body>', '</body>', '</html>', '<meta charset="utf-8">',
                 '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')) {
  $html = $html.Replace($t, '')
}
$html = $html.Replace('<title>', '<meta name="claude:viewport-fit-sides" content="cover">' + "`n  <title>")
$html = $html.Trim() + "`n"
$out = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force $out | Out-Null
[IO.File]::WriteAllText((Join-Path $out 'prototype.html'), $html, $utf8)
Write-Output ("Built dist/prototype.html, {0:N0} KB" -f ($html.Length / 1KB))
