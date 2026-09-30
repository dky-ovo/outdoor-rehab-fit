param([switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'ai-recommendation-context-20260922'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-22'
$outputZip = Join-Path $deployRoot ('outdoor-fit-' + $release + '-update.zip')
$webRoot = Join-Path $projectRoot 'workspace-artifacts\ai-recommendation-context-20260922-web'
$installer = 'install-' + $release + '.sh'
$checker = 'verify-ai-recommendation-context-release.cjs'
$helpers = @('verify-contact-feedback-release.cjs', 'verify-ai-chatbox-guide-backend-patch.cjs', 'verify-participant-facility-learning-release.cjs')
$payload = @('app.js', 'database.js', 'learningProgress.js', 'assistantSymptomEvidence.js', 'assistantSymptomRecommendations.js')
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP already exists; no overwrite is allowed.' }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Read-VerifiedManifest([string]$relative, [string]$expected) {
  $file = Join-Path $projectRoot $relative
  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $expected) { throw ('Reviewed archive changed: ' + $relative) }
  $archive = [IO.Compression.ZipFile]::OpenRead($file)
  try {
    $entry = $archive.GetEntry('release-manifest.json')
    if (-not $entry -or $entry.Length -gt 8MB) { throw 'Reviewed manifest missing or oversized.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Dispose() }
  } finally { $archive.Dispose() }
}
$old = Read-VerifiedManifest 'deploy\2026-09-21\outdoor-fit-admin-document-voice-20260921-update.zip' '5CD0720B99595A8813FC50BC24CA55AC7C93D7705796EF7E2BAF2C3448F1192F'
$learning = Read-VerifiedManifest 'deploy\2026-09-22\outdoor-fit-participant-facility-learning-20260922-update.zip' '299BA0D7ECF76651727126E9A27410D0E31944258484CF51B2A7B4E413DBBA14'
if ($old.version -ne 1 -or $old.release -ne 'admin-document-voice-20260921' -or $learning.version -ne 1 -or $learning.release -ne 'participant-facility-learning-20260922') { throw 'Unexpected reviewed baseline release.' }
$base = $old.baselines | Where-Object { $_.release -eq 'learning-voice-input-20260921' }
if (@($base).Count -ne 1) { throw 'Reviewed parent inventory is missing.' }
$older = [ordered]@{}
foreach ($property in $base.files.PSObject.Properties) { $older[$property.Name] = $property.Value }
foreach ($item in $old.files) { $older[$item.path] = $item.sha256 }
$newer = [ordered]@{}
foreach ($property in $learning.baseline.files.PSObject.Properties) {
  if ($older[$property.Name] -ne $property.Value) { throw 'Learning release parent differs from reviewed September 21 release.' }
  $newer[$property.Name] = $property.Value
}
if ($newer.Count -ne $older.Count) { throw 'Learning parent inventory mismatch.' }
foreach ($item in $learning.files) { $newer[$item.path] = $item.sha256 }
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $newer.Keys) {
  if ($name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $newer[$name] -notmatch '^[a-f0-9]{64}$') { throw 'Unsafe approved inventory.' }
  if ($name -notin $payloadPaths -and (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $newer[$name]) { throw ('Unrelated source/dependency change: ' + $name) }
}
foreach ($name in @('src/database.js', 'src/learningProgress.js')) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $newer[$name]) { throw 'Existing learning functionality changed; explicit review is required.' }
}
$expectedSource = @($newer.Keys | Where-Object { $_.StartsWith('src/') }) + @('src/assistantSymptomRecommendations.js')
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object -Unique) ($actualSource | Sort-Object)).Count) { throw 'Unexpected source inventory outside the approved five-file payload.' }
$webJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Fresh Web export inventory validation failed.' }
$webInventory = foreach ($item in ($webJson | ConvertFrom-Json)) {
  # Rebuild native ordered objects: Windows PowerShell 5 otherwise serializes
  # ConvertFrom-Json's wrapped array as {value: [...], Count: ...}.
  [ordered]@{path=[string]$item.path;sha256=[string]$item.sha256;bytes=[long]$item.bytes}
}
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\aictx22-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
$packageStage = Join-Path $stageRoot 'package'
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
$fileEntries = foreach ($name in $payload) {
  $source = Join-Path $projectRoot ('server\src\' + $name)
  $stat = Get-Item -LiteralPath $source
  if ($stat.PSIsContainer -or ($stat.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $stat.Length -gt 2MB) { throw 'Unsafe source type or size.' }
  Copy-Item -LiteralPath $source -Destination (Join-Path $packageStage $name)
  [ordered]@{path=('src/' + $name);archive=$name;sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant()}
}
foreach ($name in (@($checker) + $helpers)) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $packageStage }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'ai-recommendation-context-release-README.md') -Destination (Join-Path $packageStage 'README.md')
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
$manifest = [ordered]@{version=1;release=$release;files=@($fileEntries);baselines=@([ordered]@{release='admin-document-voice-20260921';files=$older},[ordered]@{release='participant-facility-learning-20260922';files=$newer});web=@($webInventory)}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'), (($manifest | ConvertTo-Json -Depth 8) + "`n"), $utf8)
$checksumNames = $payload + @($checker) + $helpers + @('release-manifest.json', 'README.md')
$checksums = foreach ($name in $checksumNames) { (Get-FileHash -LiteralPath (Join-Path $packageStage $name) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $name }
$template = Get-Content -LiteralPath (Join-Path $PSScriptRoot ($installer + '.in')) -Raw -Encoding UTF8
if ([regex]::Matches($template, '@@EMBEDDED_CHECKSUMS@@').Count -ne 1) { throw 'Invalid inline checksum placeholder.' }
[IO.File]::WriteAllText((Join-Path $packageStage $installer), $template.Replace('@@EMBEDDED_CHECKSUMS@@', ($checksums -join "`n")).Replace("`r`n", "`n"), $utf8)
& node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Package validation failed.' }
& node (Join-Path $PSScriptRoot $checker) baseline (Join-Path $projectRoot 'server') $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Source/dependency validation failed.' }
foreach ($name in $payload) {
  & node --check (Join-Path $packageStage $name)
  if ($LASTEXITCODE -ne 0) { throw ('Invalid JavaScript: ' + $name) }
}
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $bash) {
  & $bash -n ((Join-Path $packageStage $installer).Replace('\', '/'))
  if ($LASTEXITCODE -ne 0) { throw 'Installer Bash syntax failed.' }
}
foreach ($item in $fileEntries) {
  if ((Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $item.path)) -Algorithm SHA256).Hash -ne $item.sha256) { throw 'Source changed during packaging.' }
}
$finalWebJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0 -or ($finalWebJson -join '') -ne ($webJson -join '')) { throw 'Web export changed during packaging.' }
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;PayloadFiles=5;WebFiles=$webInventory.Count;ServerUpload=$false} | ConvertTo-Json; exit 0 }
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
$zipStream = [IO.File]::Open($outputZip, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
  $zip = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create, $true)
  try {
    $members = $checksumNames + @($installer) + @($webInventory | ForEach-Object { 'web/' + $_.path })
    foreach ($name in $members) {
      $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
      $input = [IO.File]::OpenRead((Join-Path $packageStage $name)); $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $zipStream.Dispose() }
$artifact = Get-Item -LiteralPath $outputZip
Copy-Item -LiteralPath (Join-Path $packageStage $installer) -Destination (Join-Path $deployRoot $installer)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;MiB=[math]::Round($artifact.Length/1MB,2);SHA256=(Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash;PackageStage=$packageStage;PayloadFiles=5;WebFiles=$webInventory.Count;ServerUpload=$false} | ConvertTo-Json
