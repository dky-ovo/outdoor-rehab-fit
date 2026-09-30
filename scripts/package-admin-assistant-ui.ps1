param([Parameter(Mandatory=$true)][string]$WebDirectory,[switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'admin-assistant-ui-20260921'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-21'
$outputZip = Join-Path $deployRoot 'outdoor-fit-admin-assistant-ui-20260921-update.zip'
$installer = 'install-admin-assistant-ui-20260921.sh'
$checkers = @('verify-admin-assistant-ui-release.cjs','verify-contact-feedback-release.cjs','verify-ai-chatbox-guide-backend-patch.cjs')
$utf8 = New-Object Text.UTF8Encoding($false)
# Avoid dependence on inherited PSModulePath when Windows PowerShell 5.1 is
# launched by another runtime. Hash through its built-in .NET implementation.
function Get-ReleaseSha256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP exists and will not be overwritten.' }
if (-not $StageOnly -and (Test-Path -LiteralPath ($outputZip + '.sha256'))) { throw 'Release checksum exists and will not be overwritten.' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$inventoryJson = & node (Join-Path $PSScriptRoot $checkers[0]) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Unsafe or mixed-platform Web export, or reviewed helper changed.' }
# Direct assignment avoids PowerShell 5.1 nesting the top-level JSON array.
$webInventory = ConvertFrom-Json -InputObject ($inventoryJson -join "`n")
$packageStage = Join-Path $projectRoot ('workspace-artifacts\aaui21-' + [guid]::NewGuid().ToString('N').Substring(0,12) + '\package')
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
foreach ($checker in $checkers) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage }
Copy-Item -LiteralPath (Join-Path $deployRoot $installer) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $deployRoot 'README-admin-assistant-ui-20260921.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=1;release=$release;web=@($webInventory)}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'),(($manifest | ConvertTo-Json -Depth 6) + "`n"),$utf8)
$checksumNames = @($installer) + $checkers + @('release-manifest.json','README.md')
$checksums = foreach ($name in $checksumNames) { (Get-ReleaseSha256 (Join-Path $packageStage $name)) + '  ' + $name }
[IO.File]::WriteAllText((Join-Path $packageStage 'checksums.sha256'),(($checksums -join "`n") + "`n"),$utf8)
& node (Join-Path $PSScriptRoot $checkers[0]) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Staged package verification failed.' }
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;WebFiles=$webInventory.Count} | ConvertTo-Json; exit 0 }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Build inside staging first; initialization/compression failures never publish
# an empty or partially written release ZIP. Old release artifacts are retained.
$stagedZip = Join-Path (Split-Path -Parent $packageStage) 'release.zip'
$zipStream = $null
$newZip = $null
try {
  $zipStream = [IO.File]::Open($stagedZip,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $newZip = New-Object IO.Compression.ZipArchive($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
  $zipMembers = @($checksumNames) + @('checksums.sha256') + @($webInventory | ForEach-Object { 'web/' + $_.path })
  foreach ($member in $zipMembers) {
    if ($member.Contains('\') -or $member -match '(^|/)\.\.?(/|$)|^/|:') { throw 'Nonportable ZIP member rejected.' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($newZip,(Join-Path $packageStage $member),$member,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  if ($null -ne $newZip) { $newZip.Dispose() }
  if ($null -ne $zipStream) { $zipStream.Dispose() }
}
# File.Move refuses an existing destination even if another build created it.
[IO.File]::Move($stagedZip,$outputZip)
$artifact = Get-Item -LiteralPath $outputZip
$hash = Get-ReleaseSha256 $outputZip
[IO.File]::WriteAllText(($outputZip + '.sha256'),($hash + '  ' + $artifact.Name + "`n"),$utf8)
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=$hash;PackageStage=$packageStage;WebFiles=$webInventory.Count} | ConvertTo-Json
