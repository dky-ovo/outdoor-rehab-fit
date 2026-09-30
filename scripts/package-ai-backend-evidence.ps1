param([switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-14'
$outputZip = Join-Path $deployRoot 'outdoor-fit-ai-backend-evidence-20260914-update.zip'
$baselineZip = Join-Path $projectRoot 'deploy\2026-09-11\outdoor-fit-pdf-app-timer-20260911-update.zip'
$installer = 'install-ai-symptom-evidence-20260914.sh'
$checker = 'verify-ai-backend-patch.cjs'
$payload = @('app.js','assistant.js','assistantSymptomEvidence.js','equipmentGuideEvidence.json')
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Package already exists; it will not be overwritten.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$oldZip = [IO.Compression.ZipFile]::OpenRead($baselineZip)
try {
  $entry = $oldZip.GetEntry('build-inventory.json')
  if (-not $entry) { throw 'Reviewed baseline inventory is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldInventory = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $oldZip.Dispose() }
$baselineFiles = [ordered]@{}
foreach ($item in $oldInventory.ApiAndSeedFiles) {
  if ($item.Path.StartsWith('media-seed/')) { continue }
  if ($item.Path -notmatch '^(src/[A-Za-z0-9_-]+\.js|package(?:-lock)?\.json)$' -or $item.SHA256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
  $baselineFiles[$item.Path] = $item.SHA256.ToLowerInvariant()
  if ($item.Path -notin @('src/app.js','src/assistant.js')) {
    $currentHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $item.Path)) -Algorithm SHA256).Hash
    if ($currentHash -ne $item.SHA256) { throw "Unrelated backend change requires review: $($item.Path)" }
  }
}
if ($baselineFiles['src/app.js'] -ne '4b1eba855adb18bf14d04256037685b9d719d7bf8fad0feaa43765fc83902236' -or $baselineFiles['src/assistant.js'] -ne '9fc5da23a4ab4f9f785fdec8cf534dc9182ee14127c72c1fef6eb49520b9d637') { throw 'Unexpected baseline release.' }
$expectedCurrent = @($baselineFiles.Keys | Where-Object { $_.StartsWith('src/') }) + @('src/assistantSymptomEvidence.js','src/equipmentGuideEvidence.json')
$actualCurrent = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -File | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedCurrent | Sort-Object) ($actualCurrent | Sort-Object)).Count) { throw 'Backend source inventory differs from the reviewed four-file patch.' }
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\ai-backend-package-' + [guid]::NewGuid().ToString('N'))
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
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-ai-backend-evidence-20260914.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=1;release='ai-symptom-evidence-20260914';files=@($fileEntries);baseline=[ordered]@{release='pdf-app-timer-20260911';files=$baselineFiles}}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $packageStage 'patch-manifest.json'),(($manifest | ConvertTo-Json -Depth 7) + "`n"),$utf8)
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
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BaselineFiles=$baselineFiles.Count;PayloadFiles=$payload.Count} | ConvertTo-Json; exit 0 }
[IO.Compression.ZipFile]::CreateFromDirectory($packageStage,$outputZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash
[IO.File]::WriteAllText(($outputZip + '.sha256'),($hash.ToLowerInvariant() + '  ' + $artifact.Name + "`n"),$utf8)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;KiB=[math]::Round($artifact.Length/1KB,2);SHA256=$hash;PackageStage=$packageStage;PayloadFiles=4;BaselineFiles=$baselineFiles.Count} | ConvertTo-Json
