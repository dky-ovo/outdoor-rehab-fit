param([string]$WebDirectory = '', [switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'activity-advice-account-deletion-20260923'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-23'
$outputZip = Join-Path $deployRoot ('outdoor-fit-' + $release + '-update.zip')
if ([string]::IsNullOrWhiteSpace($WebDirectory)) { $WebDirectory = Join-Path $projectRoot 'workspace-artifacts\activity-advice-account-deletion-20260923-web' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$installer = 'install-' + $release + '.sh'
$checker = 'verify-activity-advice-account-deletion-release.cjs'
$helpers = @('verify-contact-feedback-release.cjs', 'verify-ai-chatbox-guide-backend-patch.cjs', 'verify-participant-facility-learning-release.cjs')
$payload = @('app.js', 'appTextCatalog.json')
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
$previous = Read-VerifiedManifest 'deploy\2026-09-23\outdoor-fit-admin-text-registration-research-20260923-update.zip' 'DFDCF4EF711D87C048BC27B6C6900D9CF0BC89403852925ACFA6B46C91666AEB'
if ($previous.version -ne 1 -or $previous.release -ne 'admin-text-registration-research-20260923') { throw 'Unexpected reviewed baseline release.' }
$base = @($previous.baselines | Where-Object { $_.release -eq 'ai-recommendation-context-20260922' })
if ($base.Count -ne 1) { throw 'Reviewed parent inventory is missing.' }
$newer = [ordered]@{}
foreach ($property in $base[0].files.PSObject.Properties) { $newer[$property.Name] = $property.Value }
foreach ($item in $previous.files) { $newer[$item.path] = $item.sha256 }
$payloadPaths = @($payload | ForEach-Object { 'src/' + $_ })
foreach ($name in $newer.Keys) {
  if ($name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$' -or $newer[$name] -notmatch '^[a-f0-9]{64}$') { throw 'Unsafe approved inventory.' }
  if ($name -notin $payloadPaths -and (Get-FileHash -LiteralPath (Join-Path $projectRoot ('server\' + $name)) -Algorithm SHA256).Hash -ne $newer[$name]) { throw ('Unrelated source/dependency change: ' + $name) }
}
$expectedSource = @($newer.Keys | Where-Object { $_.StartsWith('src/') })
$actualSource = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -Force | ForEach-Object { 'src/' + $_.Name })
if (@(Compare-Object ($expectedSource | Sort-Object -Unique) ($actualSource | Sort-Object)).Count) { throw 'Unexpected source inventory outside the approved two-file payload.' }
$webJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Fresh Web export inventory validation failed.' }
$webInventory = foreach ($item in ($webJson | ConvertFrom-Json)) {
  # Rebuild native ordered objects: Windows PowerShell 5 otherwise serializes
  # ConvertFrom-Json's wrapped array as {value: [...], Count: ...}.
  [ordered]@{path=[string]$item.path;sha256=[string]$item.sha256;bytes=[long]$item.bytes}
}
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\activity23-' + [guid]::NewGuid().ToString('N').Substring(0, 12))
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
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'activity-advice-account-deletion-release-README.md') -Destination (Join-Path $packageStage 'README.md')
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
$manifest = [ordered]@{version=1;release=$release;files=@($fileEntries);baselines=@([ordered]@{release='admin-text-registration-research-20260923';files=$newer});web=@($webInventory)}
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
  if ($name.EndsWith('.json')) { ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $packageStage $name))) | Out-Null }
  else {
    & node --check (Join-Path $packageStage $name)
    if ($LASTEXITCODE -ne 0) { throw ('Invalid source: ' + $name) }
  }
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
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;PayloadFiles=2;WebFiles=$webInventory.Count;ServerUpload=$false} | ConvertTo-Json; exit 0 }
$stagedZip = Join-Path $stageRoot 'release.zip'
$zipStream = [IO.File]::Open($stagedZip, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
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
if ((Get-Item -LiteralPath $stagedZip).Length -gt 536870912) { throw 'Release archive exceeds installer limit.' }
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
# Atomic no-overwrite promotion. A failed compression never creates the final ZIP.
[IO.File]::Move($stagedZip, $outputZip)
$artifact = Get-Item -LiteralPath $outputZip
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;MiB=[math]::Round($artifact.Length/1MB,2);SHA256=(Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash;PackageStage=$packageStage;PayloadFiles=2;WebFiles=$webInventory.Count;ServerUpload=$false} | ConvertTo-Json
