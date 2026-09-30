param([string]$WebDirectory = '', [switch]$StageOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$release = 'team-about-20260924'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-24'
$outputZip = Join-Path $deployRoot 'outdoor-fit-team-about-20260924-update.zip'
$installer = 'install-team-about-20260924.sh'
$checker = 'verify-team-about-release.cjs'
$utf8 = New-Object Text.UTF8Encoding($false)
function Get-ReleaseSha256([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
if (-not $StageOnly -and (Test-Path -LiteralPath $outputZip)) { throw 'Release ZIP exists and will not be overwritten.' }
if ([string]::IsNullOrWhiteSpace($WebDirectory)) { $WebDirectory = Join-Path $projectRoot 'workspace-artifacts\team-about-20260924-web' }
$webRoot = (Resolve-Path -LiteralPath $WebDirectory).Path
$apiRoot = Join-Path $projectRoot 'server'
$catalog = Join-Path $apiRoot 'src\appTextCatalog.json'
$catalogHash = Get-ReleaseSha256 $catalog
if ((Get-ReleaseSha256 (Join-Path $projectRoot 'constants\AppTextCatalog.json')) -ne $catalogHash) { throw 'APP and API text catalogs differ; regenerate before packaging.' }
$supportJson = & node (Join-Path $PSScriptRoot $checker) support-inventory $apiRoot
if ($LASTEXITCODE -ne 0) { throw 'Backend does not support the reviewed text catalog.' }
$support = ConvertFrom-Json -InputObject ($supportJson -join "`n")
$inventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0) { throw 'Unsafe or mixed-platform Web export.' }
# Reconstruct plain records: Windows PowerShell 5.1 can otherwise serialize a
# pipeline array as a {value,Count} wrapper rather than the intended JSON list.
$webInventory = foreach ($item in (ConvertFrom-Json -InputObject ($inventoryJson -join "`n"))) {
  [ordered]@{path=[string]$item.path;sha256=[string]$item.sha256;bytes=[long]$item.bytes}
}
$packageStage = Join-Path $projectRoot ('workspace-artifacts\team24-' + [guid]::NewGuid().ToString('N').Substring(0,12) + '\package')
New-Item -ItemType Directory -Path (Join-Path $packageStage 'web') -Force | Out-Null
foreach ($item in $webInventory) {
  $destination = Join-Path (Join-Path $packageStage 'web') $item.path
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $webRoot $item.path) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot $checker) -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'team-about-release-README.md') -Destination (Join-Path $packageStage 'README.md')
Copy-Item -LiteralPath $catalog -Destination (Join-Path $packageStage 'appTextCatalog.json')
$manifest = [ordered]@{version=1;release=$release;web=@($webInventory);catalog=[ordered]@{path='src/appTextCatalog.json';archive='appTextCatalog.json';sha256=$catalogHash;bytes=(Get-Item -LiteralPath $catalog).Length};support=$support}
[IO.File]::WriteAllText((Join-Path $packageStage 'release-manifest.json'),(($manifest | ConvertTo-Json -Depth 6) + "`n"),$utf8)
$checksumNames = @($checker,'release-manifest.json','README.md','appTextCatalog.json')
$checksums = foreach ($name in $checksumNames) { (Get-ReleaseSha256 (Join-Path $packageStage $name)) + '  ' + $name }
$template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot ($installer + '.in'))).Replace("`r`n","`n")
if ([regex]::Matches($template,'@@EMBEDDED_CHECKSUMS@@').Count -ne 1) { throw 'Expected one embedded checksum placeholder.' }
[IO.File]::WriteAllText((Join-Path $packageStage $installer),$template.Replace('@@EMBEDDED_CHECKSUMS@@',($checksums -join "`n")),$utf8)
& node (Join-Path $PSScriptRoot $checker) package $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Staged package verification failed.' }
& node (Join-Path $PSScriptRoot $checker) backend $apiRoot $packageStage
if ($LASTEXITCODE -ne 0) { throw 'Local backend compatibility verification failed.' }
$finalInventoryJson = & node (Join-Path $PSScriptRoot $checker) web-inventory $webRoot
if ($LASTEXITCODE -ne 0 -or ($finalInventoryJson -join '') -ne ($inventoryJson -join '')) { throw 'Web export changed while packaging.' }
if ((Get-ReleaseSha256 $catalog) -ne $catalogHash) { throw 'Catalog changed while packaging.' }
$bash = 'C:\Program Files\Git\bin\bash.exe'
if (Test-Path -LiteralPath $bash) {
  & $bash -n ((Join-Path $packageStage $installer).Replace('\','/'))
  if ($LASTEXITCODE -ne 0) { throw 'Installer Bash syntax failed.' }
}
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

