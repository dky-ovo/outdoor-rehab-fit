param([switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'ai-tcm-prose-20260916'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-16'
$outputZip = Join-Path $deployRoot 'outdoor-fit-ai-tcm-prose-backend-20260916-update.zip'
$priorZip = Join-Path $deployRoot 'outdoor-fit-ai-tcm-backend-20260916-update.zip'
$installer = 'install-ai-tcm-prose-20260916.sh'
$checker = 'verify-ai-tcm-prose-backend-patch.cjs'
$payload = @('app.js','assistant.js','assistantSymptomEvidence.js','assistantTcm.js','equipmentGuideEvidence.json')
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Package already exists; it will not be overwritten.' }
if ((Get-FileHash -LiteralPath $priorZip -Algorithm SHA256).Hash -ne '65A4567772D270EC3AEAADC84EB4C9B492EE1DB41AE6FBEB0790F7AF8BA892F9') { throw 'The reviewed September 16 card archive has changed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$oldZip = [IO.Compression.ZipFile]::OpenRead($priorZip)
try {
  $entry = $oldZip.GetEntry('patch-manifest.json')
  if (-not $entry) { throw 'Reviewed baseline inventory is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $oldZip.Dispose() }
if ($oldManifest.version -ne 2 -or $oldManifest.release -ne 'ai-tcm-excerpts-20260916' -or $oldManifest.baselines.Count -ne 2) { throw 'Unexpected baseline release.' }
$expectedReleases = @('pdf-app-timer-20260911','ai-symptom-evidence-20260914')
$baselines = @()
foreach ($baseline in $oldManifest.baselines) {
  if ($baseline.release -ne $expectedReleases[$baselines.Count]) { throw 'Unexpected baseline order.' }
  $inventory = [ordered]@{}
  foreach ($property in $baseline.files.PSObject.Properties) {
    if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
    $inventory[$property.Name] = $property.Value.ToLowerInvariant()
  }
  $baselines += [ordered]@{release=$baseline.release;files=$inventory}
}
$previousFiles = [ordered]@{}
foreach ($name in $baselines[1].files.Keys) { $previousFiles[$name] = $baselines[1].files[$name] }
foreach ($item in $oldManifest.files) { $previousFiles[$item.path] = $item.sha256.ToLowerInvariant() }
$baselines += [ordered]@{release=$oldManifest.release;files=$previousFiles}
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $previousFiles.Keys) {
  if ($name -notin $payloadPaths) {
    if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $previousFiles[$name]) { throw "Unrelated backend change requires review: $name" }
  }
}
# These two support files are unchanged and included for older approved servers.
foreach ($name in @('src/assistant.js','src/equipmentGuideEvidence.json')) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $previousFiles[$name]) { throw "Unexpected supporting AI file change: $name" }
}
$expectedSource = @($previousFiles.Keys | Where-Object { $_.StartsWith('src/') })
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object) ($actualSource | Sort-Object)).Count) { throw 'Backend source inventory differs from the reviewed five-file patch.' }
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\ai-tcm-prose-backend-package-' + [guid]::NewGuid().ToString('N'))
$packageStage = Join-Path $stageRoot 'package'
New-Item -ItemType Directory -Path $packageStage -Force | Out-Null
$fileEntries = foreach ($name in $payload) {
  $source = Join-Path $projectRoot ('server\src\' + $name)
  if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source file rejected.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $packageStage $name)
  [ordered]@{path=('src/' + $name);archive=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
Copy-Item -LiteralPath (Join-Path $deployRoot $installer) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-ai-tcm-prose-backend-20260916.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=3;release=$release;files=@($fileEntries);baselines=$baselines}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $packageStage 'patch-manifest.json'),(($manifest | ConvertTo-Json -Depth 8) + "`n"),$utf8)
$checksumNames = $payload + @($installer,$checker,'patch-manifest.json','README.md')
$checksums = foreach ($name in $checksumNames) { (Get-FileHash -LiteralPath (Join-Path $packageStage $name) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name }
[IO.File]::WriteAllText((Join-Path $packageStage 'checksums.sha256'),(($checksums -join "`n") + "`n"),$utf8)
node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Patch package verification failed.' }
node (Join-Path $PSScriptRoot $checker) baseline (Join-Path $projectRoot 'server') $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Final source/base compatibility verification failed.' }
foreach ($item in $fileEntries) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $item.path)) -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Source changed during packaging.' }
}
$baselineCounts = @($baselines | ForEach-Object { $_.files.Count })
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BaselineFiles=$baselineCounts;PayloadFiles=$payload.Count} | ConvertTo-Json; exit 0 }
[IO.Compression.ZipFile]::CreateFromDirectory($packageStage,$outputZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($outputZip + '.sha256'),($hash.ToLowerInvariant() + '  ' + $artifact.Name + "`n"),$utf8)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;KiB=[math]::Round($artifact.Length/1KB,2);SHA256=$hash;PackageStage=$packageStage;PayloadFiles=$payload.Count;BaselineFiles=$baselineCounts} | ConvertTo-Json
