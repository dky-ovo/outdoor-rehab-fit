param([switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'ai-tcm-excerpts-20260916'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-16'
$outputZip = Join-Path $deployRoot 'outdoor-fit-ai-tcm-backend-20260916-update.zip'
$priorZip = Join-Path $projectRoot 'deploy\2026-09-14\outdoor-fit-ai-backend-evidence-20260914-update.zip'
$installer = 'install-ai-tcm-excerpts-20260916.sh'
$checker = 'verify-ai-tcm-backend-patch.cjs'
$payload = @('app.js','assistant.js','assistantSymptomEvidence.js','assistantTcm.js','equipmentGuideEvidence.json')
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Package already exists; it will not be overwritten.' }
if ((Get-FileHash -LiteralPath $priorZip -Algorithm SHA256).Hash -ne '23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B') { throw 'The reviewed September 14 archive has changed.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$oldZip = [IO.Compression.ZipFile]::OpenRead($priorZip)
try {
  $entry = $oldZip.GetEntry('patch-manifest.json')
  if (-not $entry) { throw 'Reviewed baseline inventory is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $oldZip.Dispose() }
if ($oldManifest.release -ne 'ai-symptom-evidence-20260914' -or $oldManifest.baseline.release -ne 'pdf-app-timer-20260911') { throw 'Unexpected baseline release.' }
$september11 = [ordered]@{}
$september14 = [ordered]@{}
foreach ($property in $oldManifest.baseline.files.PSObject.Properties) {
  if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.js|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
  $september11[$property.Name] = $property.Value.ToLowerInvariant()
  $september14[$property.Name] = $property.Value.ToLowerInvariant()
}
foreach ($item in $oldManifest.files) { $september14[$item.path] = $item.sha256.ToLowerInvariant() }
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $september14.Keys) {
  if ($name -notin $payloadPaths) {
    $currentHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash
    if ($currentHash -ne $september14[$name]) { throw "Unrelated backend change requires review: $name" }
  }
}
# These two support files are carried forward unchanged for September 11 servers.
foreach ($name in @('src/assistant.js','src/equipmentGuideEvidence.json')) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $september14[$name]) { throw "Unexpected supporting AI file change: $name" }
}
$expectedSource = @($september14.Keys | Where-Object { $_.StartsWith('src/') }) + @('src/assistantTcm.js')
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object) ($actualSource | Sort-Object)).Count) { throw 'Backend source inventory differs from the reviewed five-file patch.' }
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\ai-tcm-backend-package-' + [guid]::NewGuid().ToString('N'))
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
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-ai-tcm-backend-20260916.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=2;release=$release;files=@($fileEntries);baselines=@(
  [ordered]@{release='pdf-app-timer-20260911';files=$september11},
  [ordered]@{release='ai-symptom-evidence-20260914';files=$september14}
)}
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
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BaselineFiles=@($september11.Count,$september14.Count);PayloadFiles=$payload.Count} | ConvertTo-Json; exit 0 }
[IO.Compression.ZipFile]::CreateFromDirectory($packageStage,$outputZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($outputZip + '.sha256'),($hash.ToLowerInvariant() + '  ' + $artifact.Name + "`n"),$utf8)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;KiB=[math]::Round($artifact.Length/1KB,2);SHA256=$hash;PackageStage=$packageStage;PayloadFiles=$payload.Count;BaselineFiles=@($september11.Count,$september14.Count)} | ConvertTo-Json
