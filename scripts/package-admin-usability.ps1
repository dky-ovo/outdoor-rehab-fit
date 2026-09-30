param([string]$WebDirectory = '', [switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'admin-usability-20260923'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-23'
$outputZip = Join-Path $deployRoot 'outdoor-fit-admin-usability-20260923-update.zip'
$installer = 'install-admin-usability-20260923.sh'
$checker = 'verify-admin-usability-release.cjs'
$utf8 = New-Object Text.UTF8Encoding($false)
function Get-ReleaseSha256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP exists and will not be overwritten.' }
if ([string]::IsNullOrWhiteSpace($WebDirectory)) { $WebDirectory = Join-Path $projectRoot 'workspace-artifacts\admin-usability-20260923-web' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$inventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Unsafe or mixed-platform Web export.' }
# Reconstruct plain records: Windows PowerShell 5.1 can otherwise serialize a
# pipeline array as a {value,Count} wrapper rather than the intended JSON list.
$webInventory = foreach ($item in (ConvertFrom-Json -InputObject ($inventoryJson -join "`n"))) {
  [ordered]@{path=[string]$item.path;sha256=[string]$item.sha256;bytes=[long]$item.bytes}
}
$packageStage = Join-Path $projectRoot ('workspace-artifacts\admu23-' + [guid]::NewGuid().ToString('N').Substring(0,12) + '\package')
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'admin-usability-release-README.md') -Destination (Join-Path $packageStage 'README.md')
$manifest = [ordered]@{version=1;release=$release;web=@($webInventory)}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'),(($manifest | ConvertTo-Json -Depth 6) + "`n"),$utf8)
$checksumNames = @($checker,'release-manifest.json','README.md')
$checksums = foreach ($name in $checksumNames) { (Get-ReleaseSha256 (Join-Path $packageStage $name)) + '  ' + $name }
$template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot ($installer + '.in'))).Replace("`r`n","`n")
if ([regex]::Matches($template,'@@EMBEDDED_CHECKSUMS@@').Count -ne 1) { throw 'Expected one embedded checksum placeholder.' }
[IO.File]::WriteAllText((Join-Path $packageStage $installer),$template.Replace('@@EMBEDDED_CHECKSUMS@@',($checksums -join "`n")),$utf8)
& node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Staged package verification failed.' }
if ($StageOnly) { [pscustomobject]@{PackageStage=$packageStage;WebFiles=@($webInventory).Count;Release=$release} | ConvertTo-Json; exit 0 }
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stagedZip = Join-Path (Split-Path -Parent $packageStage) 'release.zip'
$zipStream = $null
$newZip = $null
try {
  $zipStream = [IO.File]::Open($stagedZip,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  $newZip = New-Object IO.Compression.ZipArchive($zipStream,[IO.Compression.ZipArchiveMode]::Create,$false)
  $zipMembers = @($installer) + $checksumNames + @($webInventory | ForEach-Object { 'web/' + $_.path })
  foreach ($member in $zipMembers) {
    if ($member.Contains('\') -or $member -match '(^|/)\.\.?(/|$)|^/|:') { throw 'Nonportable ZIP member rejected.' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($newZip,(Join-Path $packageStage $member),$member,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  if ($null -ne $newZip) { $newZip.Dispose() }
  if ($null -ne $zipStream) { $zipStream.Dispose() }
}
if ((Get-Item -LiteralPath $stagedZip).Length -gt 536870912) { throw 'Release archive exceeds installer limit.' }
New-Item -ItemType Directory -Path $deployRoot -Force | Out-Null
# Atomic, no-overwrite promotion: never replace older or concurrent artifacts.
[IO.File]::Move($stagedZip,$outputZip)
$artifact = Get-Item -LiteralPath $outputZip
[pscustomobject]@{Path=$artifact.FullName;Bytes=$artifact.Length;SHA256=(Get-ReleaseSha256 $outputZip);PackageStage=$packageStage;WebFiles=@($webInventory).Count;Release=$release} | ConvertTo-Json
