param([switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'participant-facility-learning-20260922'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-22'
$outputZip = Join-Path $deployRoot ('outdoor-fit-' + $release + '-update.zip')
$baselineZip = Join-Path $projectRoot 'deploy\2026-09-21\outdoor-fit-admin-document-voice-20260921-update.zip'
$expectedBaselineHash = '5CD0720B99595A8813FC50BC24CA55AC7C93D7705796EF7E2BAF2C3448F1192F'
$installer = 'install-' + $release + '.sh'
$checker = 'verify-participant-facility-learning-release.cjs'
$payload = @('app.js', 'database.js', 'learningProgress.js')
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP already exists; no overwrite is allowed.' }
if ((Get-FileHash -LiteralPath $baselineZip -Algorithm SHA256).Hash -ne $expectedBaselineHash) { throw 'The reviewed September 21 backend archive has changed.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($baselineZip)
try {
  $entry = $archive.GetEntry('release-manifest.json')
  if (-not $entry) { throw 'Reviewed baseline manifest is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
if ($oldManifest.version -ne 1 -or $oldManifest.release -ne 'admin-document-voice-20260921' -or $oldManifest.baselines.Count -ne 2) { throw 'Unexpected reviewed backend baseline.' }
$base = $oldManifest.baselines | Where-Object { $_.release -eq 'learning-voice-input-20260921' }
if (-not $base -or @($base).Count -ne 1) { throw 'Reviewed parent source inventory is missing or ambiguous.' }
$baselineFiles = [ordered]@{}
foreach ($property in $base.files.PSObject.Properties) {
  if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'Unsafe baseline inventory entry.' }
  $baselineFiles[$property.Name] = $property.Value
}
foreach ($item in $oldManifest.files) {
  if ($item.path -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Unsafe baseline payload entry.' }
  $baselineFiles[$item.path] = $item.sha256
}
if ($baselineFiles['src/app.js'] -ne '3e273cb4436441608c99d1d0b4f8f357e4189ad0b901259f360882fc1ec53eb9' -or
    $baselineFiles['src/database.js'] -ne '5f101948741cba4cfd2037b79b3c28a18e2d895eeaf0da05cf16dd01a8691650') { throw 'Unexpected approved app/database source.' }
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $baselineFiles.Keys) {
  if ($name -notin $payloadPaths -and (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $baselineFiles[$name]) {
    throw ('Unrelated backend or dependency change requires review: ' + $name)
  }
}
$expectedSource = @($baselineFiles.Keys | Where-Object { $_.StartsWith('src/') }) + @('src/learningProgress.js')
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object -Unique) ($actualSource | Sort-Object)).Count) { throw 'Source inventory differs from the approved three-file learning update.' }

$stageRoot = Join-Path $projectRoot ('workspace-artifacts\pfl22-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
$packageStage = Join-Path $stageRoot 'package'
New-Item -ItemType Directory -Path $packageStage -Force | Out-Null
$fileEntries = foreach ($name in $payload) {
  $source = Join-Path $projectRoot ('server\src\' + $name)
  $stat = Get-Item -LiteralPath $source
  if ($stat.PSIsContainer -or ($stat.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $stat.Length -gt 2MB) { throw 'Source file type or size rejected.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $packageStage $name)
  [ordered]@{path=('src/' + $name);archive=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'participant-facility-learning-release-README.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=1;release=$release;files=@($fileEntries);baseline=[ordered]@{release='admin-document-voice-20260921';files=$baselineFiles}}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'), (($manifest | ConvertTo-Json -Depth 8) + "`n"), $utf8)
$checksumNames = $payload + @($checker, 'release-manifest.json', 'README.md')
$checksums = foreach ($name in $checksumNames) { (Get-FileHash -LiteralPath (Join-Path $packageStage $name) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name }
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot ('install-' + $release + '.sh.in')) -Raw -Encoding UTF8
if ([regex]::Matches($template, '@@EMBEDDED_CHECKSUMS@@').Count -ne 1) { throw 'Installer checksum placeholder is invalid.' }
$installerContents = $template.Replace('@@EMBEDDED_CHECKSUMS@@', ($checksums -join "`n")).Replace("`r`n", "`n")
[IO.File]::WriteAllText((Join-Path $packageStage $installer), $installerContents, $utf8)
& node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Release package verification failed.' }
& node (Join-Path $PSScriptRoot $checker) baseline (Join-Path $projectRoot 'server') $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Final local source/baseline verification failed.' }
foreach ($name in $payload) {
  & node --check (Join-Path $packageStage $name)
  if ($LASTEXITCODE -ne 0) { throw ('Invalid JavaScript payload: ' + $name) }
}
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $bash) {
  & $bash -n ((Join-Path $packageStage $installer).Replace('\', '/'))
  if ($LASTEXITCODE -ne 0) { throw 'Installer Bash syntax check failed.' }
}
foreach ($item in $fileEntries) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $item.path)) -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Source changed during packaging; freeze and retry.' }
}
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;PayloadFiles=3;BaselineFiles=$baselineFiles.Count;ServerUpload=$false} | ConvertTo-Json; exit 0 }
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
$zipStream = [IO.File]::Open($outputZip, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $zip = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    foreach ($name in ($payload + @($installer, $checker, 'release-manifest.json', 'README.md'))) {
      $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
      $input = [IO.File]::OpenRead((Join-Path $packageStage $name)); $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $zipStream.Dispose() }
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash
# Keep a directly accessible, identical installer. No cloud checksum sidecar is required.
Copy-Item -LiteralPath (Join-Path $packageStage $installer) -Destination (Join-Path $deployRoot $installer)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;KiB=[math]::Round($artifact.Length/1KB,2);SHA256=$hash;PackageStage=$packageStage;PayloadFiles=3;BaselineFiles=$baselineFiles.Count;ServerUpload=$false} | ConvertTo-Json
