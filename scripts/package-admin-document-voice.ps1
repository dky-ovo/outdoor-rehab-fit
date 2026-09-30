param(
  [Parameter(Mandatory=$true)][string]$WebDirectory,
  [switch]$StageOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'admin-document-voice-20260921'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-21'
$outputZip = Join-Path $deployRoot 'outdoor-fit-admin-document-voice-20260921-update.zip'
$installer = 'install-admin-document-voice-20260921.sh'
$checker = 'verify-admin-document-voice-release.cjs'
$priorChecker = 'verify-ai-chatbox-guide-backend-patch.cjs'
$payload = @('app.js','assistant.js','database.js','adminAssistant.js','adminAssistantPrivacy.js','equipmentDocumentImport.js','package.json','package-lock.json')
$utf8 = New-Object Text.UTF8Encoding($false)
function Payload-Path([string]$name) { if ($name.StartsWith('package')) { return $name }; return ('src/' + $name) }
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP already exists; it will not be overwritten.' }
if (-not $StageOnly -and (Test-Path -LiteralPath ($outputZip + '.sha256'))) { throw 'Release checksum already exists; it will not be overwritten.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-ReviewedRelease([string]$relative,[string]$expectedHash,[string]$releaseName) {
  $zipPath = Join-Path $projectRoot $relative
  if ((Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash -ne $expectedHash) { throw ('Reviewed archive hash changed: ' + $releaseName) }
  $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entry = $archive.GetEntry('release-manifest.json')
    if (-not $entry) { throw 'Reviewed release manifest missing.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($manifest.version -ne 1 -or $manifest.release -ne $releaseName -or $manifest.baselines.Count -ne 1) { throw 'Unexpected reviewed release inventory.' }
    $helper = $archive.GetEntry($priorChecker)
    if (-not $helper) { throw 'Reviewed runtime helper missing.' }
    $stream = $helper.Open(); $memory = New-Object IO.MemoryStream
    try { $stream.CopyTo($memory); $helperBytes = $memory.ToArray() } finally { $stream.Dispose(); $memory.Dispose() }
    $files = [ordered]@{}
    foreach ($property in $manifest.baselines[0].files.PSObject.Properties) {
      if ($property.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $property.Value -notmatch '^[a-f0-9]{64}$') { throw 'Invalid reviewed baseline entry.' }
      $files[$property.Name] = $property.Value
    }
    foreach ($item in $manifest.files) {
      if ($item.path -notmatch '^src/[A-Za-z0-9_-]+\.(?:js|json)$' -or $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid reviewed payload entry.' }
      $files[$item.path] = $item.sha256
    }
    return [pscustomobject]@{Files=$files;HelperBytes=$helperBytes;Manifest=$manifest}
  } finally { $archive.Dispose() }
}
$v24 = Read-ReviewedRelease 'deploy\2026-09-18\outdoor-fit-v24-activity-content-20260918-update.zip' '0B02C151847701FF9977AD05F868A4887F9EA196C69EBF7CF8CCCF6E988B1E00' 'v24-activity-content-20260918'
$learning = Read-ReviewedRelease 'deploy\2026-09-21\outdoor-fit-learning-voice-input-20260921-update.zip' '8D2140C5B02658B56D449E0FA38921003105D19B2B02A4DE7A226EF2BD35D776' 'learning-voice-input-20260921'
$baselines = @([ordered]@{release='v24-activity-content-20260918';files=$v24.Files}, [ordered]@{release='learning-voice-input-20260921';files=$learning.Files})
$priorCheckerBytes = $learning.HelperBytes
$algorithm = [Security.Cryptography.SHA256]::Create()
try { $priorCheckerHash = [BitConverter]::ToString($algorithm.ComputeHash($priorCheckerBytes)).Replace('-','').ToLowerInvariant() } finally { $algorithm.Dispose() }
if ((Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $priorChecker) -Algorithm SHA256).Hash -ne $priorCheckerHash) { throw 'Local runtime helper differs from reviewed archive.' }
$payloadPaths = @($payload | ForEach-Object { Payload-Path $_ })
foreach ($baseline in $baselines) {
  foreach ($name in $baseline.files.Keys) {
    if ($name -notin $payloadPaths -and (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $baseline.files[$name]) { throw ('Unrelated backend change requires review: ' + $name) }
  }
}
if ((Get-FileHash -LiteralPath (Join-Path $projectRoot 'server\src\assistant.js') -Algorithm SHA256).Hash -ne $learning.Files['src/assistant.js']) { throw 'Shared learning-release assistant.js drifted; review required.' }
$expectedSource = @($learning.Files.Keys | Where-Object { $_.StartsWith('src/') }) + @($payloadPaths | Where-Object { $_.StartsWith('src/') })
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object -Unique) ($actualSource | Sort-Object)).Count) { throw 'Backend inventory differs from reviewed release.' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$inventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Web export is unsafe or not web-only.' }
$webInventory = ConvertFrom-Json -InputObject ($inventoryJson -join "`n")
# Keep the staging prefix short for Windows PowerShell 5.1/.NET MAX_PATH when
# Expo assets preserve long dependency/font paths inside their static tree.
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\adv21-' + [guid]::NewGuid().ToString('N').Substring(0,12))
$packageStage = Join-Path $stageRoot 'package'
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
$fileEntries = foreach ($name in $payload) {
  $relative = Payload-Path $name
  $source = Join-Path $projectRoot ('server\' + $relative)
  if ((Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backend source rejected.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $packageStage $name)
  [ordered]@{path=$relative;archive=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $deployRoot $installer) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
[IO.File]::WriteAllBytes((Join-Path $packageStage $priorChecker),$priorCheckerBytes)
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-admin-document-voice-20260921.md') -Destination (Join-Path $packageStage 'README.md')
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
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=2} | ConvertTo-Json; exit 0 }
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
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=$hash;PackageStage=$packageStage;BackendFiles=$payload.Count;WebFiles=$webInventory.Count;Baselines=2} | ConvertTo-Json





