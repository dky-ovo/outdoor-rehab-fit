param(
  [Parameter(Mandatory=$true)][string]$WebDirectory,
  [switch]$StageOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'learning-voice-input-20260921'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-21'
$outputZip = Join-Path $deployRoot 'outdoor-fit-learning-voice-input-20260921-update.zip'
$priorZip = Join-Path $projectRoot 'deploy\2026-09-18\outdoor-fit-v24-activity-content-20260918-update.zip'
$installer = 'install-learning-voice-input-20260921.sh'
$checker = 'verify-learning-voice-input-release.cjs'
$priorChecker = 'verify-ai-chatbox-guide-backend-patch.cjs'
$payload = @('app.js','assistant.js')
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP already exists; it will not be overwritten.' }
if (-not $StageOnly -and (Test-Path -LiteralPath ($outputZip + '.sha256'))) { throw 'Release checksum already exists; it will not be overwritten.' }
if ((Get-FileHash -LiteralPath $priorZip -Algorithm SHA256).Hash -ne '0B02C151847701FF9977AD05F868A4887F9EA196C69EBF7CF8CCCF6E988B1E00') { throw 'The reviewed V24 archive has changed.' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$inventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Web export is unsafe or not a web-only export.' }
# Windows PowerShell 5.1 emits a top-level JSON array as one pipeline object.
# Assign it directly before enumerating; @(... | ConvertFrom-Json) nests it.
$webInventory = ConvertFrom-Json -InputObject ($inventoryJson -join "`n")
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$oldZip = [IO.Compression.ZipFile]::OpenRead($priorZip)
try {
  $entry = $oldZip.GetEntry('release-manifest.json')
  if (-not $entry) { throw 'Reviewed baseline inventory is missing.' }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
  $entry = $oldZip.GetEntry($priorChecker)
  if (-not $entry) { throw 'Reviewed runtime/smoke verifier is missing.' }
  $stream = $entry.Open(); $memory = New-Object IO.MemoryStream
  try { $stream.CopyTo($memory); $priorCheckerBytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
} finally { $oldZip.Dispose() }
if ($oldManifest.version -ne 1 -or $oldManifest.release -ne 'v24-activity-content-20260918' -or $oldManifest.baselines.Count -ne 1) { throw 'Unexpected reviewed baseline release.' }
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $priorCheckerHash = [BitConverter]::ToString($algorithm.ComputeHash($priorCheckerBytes)).Replace('-','').ToLowerInvariant() } finally { $algorithm.Dispose() }
if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $priorChecker) -Algorithm SHA256).Hash -ne $priorCheckerHash) { throw 'Local prior runtime/smoke verifier differs from reviewed archive.' }
$previousFiles = [ordered]@{}
foreach ($property in $oldManifest.baselines[0].files.PSObject.Properties) {
  if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
  $previousFiles[$property.Name] = $property.Value
}
foreach ($item in $oldManifest.files) {
  if ($item.path -notmatch '^src/[A-Za-z0-9_-]+\.(?:js|json)$' -or $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid reviewed payload entry.' }
  $previousFiles[$item.path] = $item.sha256.ToLowerInvariant()
}
$baselines = @([ordered]@{release=$oldManifest.release;files=$previousFiles})
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $previousFiles.Keys) {
  if ($name -notin $payloadPaths) {
    if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $previousFiles[$name]) { throw "Unrelated backend/dependency change requires review: $name" }
  }
}
$expectedSource = @($previousFiles.Keys | Where-Object { $_.StartsWith('src/') })
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object -Unique) ($actualSource | Sort-Object)).Count) { throw 'Backend inventory differs from the reviewed two-file release.' }
# Keep the staging prefix short for Windows PowerShell 5.1/.NET MAX_PATH when
# Expo assets preserve long dependency/font paths inside their static tree.
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\lv21-' + [guid]::NewGuid().ToString('N').Substring(0,12))
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
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-learning-voice-input-20260921.md') -Destination (Join-Path $packageStage 'README.md')
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
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=1} | ConvertTo-Json; exit 0 }
# .NET Framework on Windows PowerShell 5.1 can write backslash ZIP members.
# Linux installation deliberately rejects them, so create every entry with an
# explicit portable slash path from the already-verified release inventory.
$stagedZip = Join-Path $stageRoot 'release.zip'
$zipStream = [IO.File]::Open($stagedZip,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
$newZip = New-Object IO.Compression.ZipArchive($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  $zipMembers = @($checksumNames) + @('checksums.sha256') + @($webInventory | ForEach-Object { 'web/' + $_.path })
  foreach ($member in $zipMembers) {
    if ($member.Contains('\') -or $member -match '(^|/)\.\.?(/|$)|^/|:') { throw 'Nonportable ZIP member rejected.' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($newZip,(Join-Path $packageStage $member),$member,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $newZip.Dispose(); $zipStream.Dispose() }
[IO.File]::Move($stagedZip,$outputZip)
$artifact = Get-Item -LiteralPath $outputZip
$hash = (Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash.ToLowerInvariant()
$checksumStream = [IO.File]::Open(($outputZip + '.sha256'),[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
try {
  $checksumBytes = $utf8.GetBytes($hash + '  ' + $artifact.Name + "`n")
  $checksumStream.Write($checksumBytes,0,$checksumBytes.Length)
  $checksumStream.Flush()
} finally { $checksumStream.Dispose() }
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=$hash;PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=1} | ConvertTo-Json



