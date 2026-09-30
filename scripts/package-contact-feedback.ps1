param(
  [Parameter(Mandatory=$true)][string]$WebDirectory,
  [switch]$StageOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'contact-feedback-20260918'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-18'
$outputZip = Join-Path $deployRoot 'outdoor-fit-contact-feedback-20260918-update.zip'
$priorZip = Join-Path $projectRoot 'deploy\2026-09-17\outdoor-fit-ai-chatbox-guide-backend-20260917-update.zip'
$installer = 'install-contact-feedback-20260918.sh'
$checker = 'verify-contact-feedback-release.cjs'
$priorChecker = 'verify-ai-chatbox-guide-backend-patch.cjs'
$payload = @('app.js','assistant.js','assistantSymptomEvidence.js','assistantTcm.js','equipmentGuideEvidence.json','assistantGuide.js','database.js','feedback.js')
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP already exists; it will not be overwritten.' }
if ((Get-FileHash -LiteralPath $priorZip -Algorithm SHA256).Hash -ne '2DA2EA429534319C9D6C1A516C65291D09591274FC0F6540E0233EAA5E1A4C65') { throw 'The reviewed September 17 archive has changed.' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$inventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Web export is unsafe or not a web-only export.' }
# Windows PowerShell 5.1 emits a top-level JSON array as one pipeline object.
# Assign it directly before enumerating; @(... | ConvertFrom-Json) nests it.
$webInventory = ConvertFrom-Json -InputObject ($inventoryJson -join "`n")
Add-Type -AssemblyName System.IO.Compression.FileSystem
$oldZip = [IO.Compression.ZipFile]::OpenRead($priorZip)
try {
  $entry = $oldZip.GetEntry('patch-manifest.json')
  if (-not $entry) { throw 'Reviewed baseline inventory is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  $entry = $oldZip.GetEntry($priorChecker)
  if (-not $entry) { throw 'Reviewed runtime/smoke verifier is missing.' }
  $stream = $entry.Open(); $memory = New-Object IO.MemoryStream
  try { $stream.CopyTo($memory); $priorCheckerBytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
} finally { $oldZip.Dispose() }
if ($oldManifest.version -ne 4 -or $oldManifest.release -ne 'ai-chatbox-guide-20260917' -or $oldManifest.baselines.Count -ne 4) { throw 'Unexpected reviewed baseline release.' }
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $priorCheckerHash = [BitConverter]::ToString($algorithm.ComputeHash($priorCheckerBytes)).Replace('-','').ToLowerInvariant() } finally { $algorithm.Dispose() }
if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $priorChecker) -Algorithm SHA256).Hash -ne $priorCheckerHash) { throw 'Local prior runtime/smoke verifier differs from reviewed archive.' }
$expectedReleases = @('pdf-app-timer-20260911','ai-symptom-evidence-20260914','ai-tcm-excerpts-20260916','ai-tcm-prose-20260916')
$baselines = @()
foreach ($baseline in $oldManifest.baselines) {
  if ($baseline.release -ne $expectedReleases[$baselines.Count]) { throw 'Unexpected baseline order.' }
  $inventory = [ordered]@{}
  foreach ($property in $baseline.files.PSObject.Properties) {
    if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
    $inventory[$property.Name] = $property.Value
  }
  $baselines += [ordered]@{release=$baseline.release;files=$inventory}
}
$previousFiles = [ordered]@{}
foreach ($name in $baselines[3].files.Keys) { $previousFiles[$name] = $baselines[3].files[$name] }
foreach ($item in $oldManifest.files) { $previousFiles[$item.path] = $item.sha256.ToLowerInvariant() }
$baselines += [ordered]@{release=$oldManifest.release;files=$previousFiles}
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $previousFiles.Keys) {
  if ($name -notin $payloadPaths -or $name -in @('src/assistant.js','src/assistantSymptomEvidence.js','src/assistantTcm.js','src/assistantGuide.js','src/equipmentGuideEvidence.json')) {
    if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $previousFiles[$name]) { throw "Unrelated backend/dependency change requires review: $name" }
  }
}
$expectedSource = @($previousFiles.Keys | Where-Object { $_.StartsWith('src/') }) + @('src/feedback.js')
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object) ($actualSource | Sort-Object)).Count) { throw 'Backend inventory differs from the reviewed eight-file release.' }
# Keep the staging prefix short for Windows PowerShell 5.1/.NET MAX_PATH when
# Expo assets preserve long dependency/font paths inside their static tree.
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\cf-' + [guid]::NewGuid().ToString('N').Substring(0,12))
$packageStage = Join-Path $stageRoot 'package'
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
$fileEntries = foreach ($name in $payload) {
  $source = Join-Path $projectRoot ('server\src\' + $name)
  if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backend source rejected.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $packageStage $name)
  [ordered]@{path=('src/' + $name);archive=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $deployRoot $installer) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
[IO.File]::WriteAllBytes((Join-Path $packageStage $priorChecker),$priorCheckerBytes)
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-contact-feedback-20260918.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=1;release=$release;files=@($fileEntries);baselines=$baselines;web=@($webInventory)}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'),(($manifest | ConvertTo-Json -Depth 10) + "`n"),$utf8)
$checksumNames = $payload + @($installer,$checker,$priorChecker,'release-manifest.json','README.md')
$checksums = foreach ($name in $checksumNames) { (Get-FileHash -LiteralPath (Join-Path $packageStage $name) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name }
[IO.File]::WriteAllText((Join-Path $packageStage 'checksums.sha256'),(($checksums -join "`n") + "`n"),$utf8)
& node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Release package verification failed.' }
& node (Join-Path $PSScriptRoot $checker) baseline (Join-Path $projectRoot 'server') $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Final source/base compatibility verification failed.' }
foreach ($item in $fileEntries) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $item.path)) -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Source changed during packaging.' }
}
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=5} | ConvertTo-Json; exit 0 }
# .NET Framework on Windows PowerShell 5.1 can write backslash ZIP members.
# Linux installation deliberately rejects them, so create every entry with an
# explicit portable slash path from the already-verified release inventory.
$zipStream = [IO.File]::Open($outputZip,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$newZip = New-Object IO.Compression.ZipArchive($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  $zipMembers = @($checksumNames) + @('checksums.sha256') + @($webInventory | ForEach-Object { 'web/' + $_.path })
  foreach ($member in $zipMembers) {
    if ($member.Contains('\') -or $member -match '(^|/)\.\.?(/|$)|^/|:') { throw 'Nonportable ZIP member rejected.' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($newZip,(Join-Path $packageStage $member),$member,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $newZip.Dispose(); $zipStream.Dispose() }
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($outputZip + '.sha256'),($hash + '  ' + $artifact.Name + "`n"),$utf8)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=$hash;PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=5} | ConvertTo-Json
