param([Parameter(Mandatory=$true)][string]$PackageStage)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageRoot = (Resolve-Path -LiteralPath $PackageStage).Path
$checker = Join-Path $packageRoot 'verify-ai-chatbox-guide-backend-patch.cjs'
$release = 'ai-chatbox-guide-20260917'
$baselineTar = Join-Path $projectRoot 'workspace-artifacts\ai-tcm-prose-upgrade-29b5fefab8734e678869ddaef72b8ce9\baseline-api.tar.gz'
$dependencies = Join-Path $projectRoot 'server\node_modules'
$archives = @{
  'ai-symptom-evidence-20260914' = @{
    Path = Join-Path $projectRoot 'deploy\2026-09-14\outdoor-fit-ai-backend-evidence-20260914-update.zip'
    Hash = '23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B'
  }
  'ai-tcm-excerpts-20260916' = @{
    Path = Join-Path $projectRoot 'deploy\2026-09-16\outdoor-fit-ai-tcm-backend-20260916-update.zip'
    Hash = '65A4567772D270EC3AEAADC84EB4C9B492EE1DB41AE6FBEB0790F7AF8BA892F9'
  }
  'ai-tcm-prose-20260916' = @{
    Path = Join-Path $projectRoot 'deploy\2026-09-16\outdoor-fit-ai-tcm-prose-backend-20260916-update.zip'
    Hash = '47FEC604B5EA1421EFB8957537EF27F6F02FDD66369C8AA0EB80578B018BC938'
  }
}

function Invoke-Checker {
  param([string[]]$Arguments)
  $output = & node $checker @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Release verification failed: ' + ($Arguments -join ' ')) }
  return (($output -join "`n") | ConvertFrom-Json)
}

function Assert-Inventory {
  param([string]$ApiRoot, $Inventory)
  $expected = @($Inventory.PSObject.Properties | ForEach-Object { $_.Name })
  $actual = @('package.json','package-lock.json') + @(Get-ChildItem -LiteralPath (Join-Path $ApiRoot 'src') -Force | ForEach-Object { 'src/' + $_.Name })
  if (@(Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)).Count) { throw 'Fixture source inventory differs from the approved baseline.' }
  foreach ($item in $Inventory.PSObject.Properties) {
    if ($item.Name -notmatch '^(src/[A-Za-z0-9_-]+\.(?:js|json)|package(?:-lock)?\.json)$') { throw 'Unsafe fixture inventory path.' }
    $source = Join-Path $ApiRoot $item.Name
    $info = Get-Item -LiteralPath $source
    if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Fixture source must be a regular file.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $item.Value) { throw ('Fixture SHA-256 mismatch: ' + $item.Name) }
  }
}

function Expand-ReviewedPatch {
  param([string]$ArchivePath, [string]$ApiRoot, $Baseline)
  $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
  try {
    $entry = $zip.GetEntry('patch-manifest.json')
    if (-not $entry) { throw 'Old patch manifest is missing.' }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    if ($oldManifest.release -ne $Baseline.release) { throw 'Old patch release does not match the expected baseline.' }
    foreach ($item in $oldManifest.files) {
      if ($item.path -notmatch '^src/[A-Za-z0-9_-]+\.(?:js|json)$' -or $item.archive -ne $item.path.Substring(4)) { throw 'Unsafe old patch payload.' }
      $expected = $Baseline.files.PSObject.Properties[$item.path]
      if (-not $expected -or $item.sha256 -ne $expected.Value) { throw 'Old payload hash is not the approved baseline hash.' }
      $payloadEntry = $zip.GetEntry($item.archive)
      if (-not $payloadEntry -or $payloadEntry.Length -gt 2097152) { throw 'Old payload is missing or oversized.' }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($payloadEntry, (Join-Path $ApiRoot $item.path), $true)
      if ((Get-FileHash -LiteralPath (Join-Path $ApiRoot $item.path) -Algorithm SHA256).Hash -ne $expected.Value) { throw 'Extracted old payload digest mismatch.' }
    }
  } finally { $zip.Dispose() }
}

# Validate the new package before accepting any manifest path. The historical
# archives are fixed inputs; only approved source and package files are extracted.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$packageCheck = Invoke-Checker -Arguments @('package',$packageRoot)
if ($packageCheck.package -ne 'verified' -or $packageCheck.release -ne $release) { throw 'Unexpected package verification response.' }
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'patch-manifest.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $baselineTar -Algorithm SHA256).Hash -ne '13975D689773E4D9E6F0CF77C27176694B27008E8156F8710B903B2E48C7D7D6') { throw 'Original source fixture archive has changed.' }
foreach ($archive in $archives.Values) {
  if ((Get-FileHash -LiteralPath $archive.Path -Algorithm SHA256).Hash -ne $archive.Hash) { throw 'Reviewed old patch archive has changed.' }
}
$originalBaseline = @($manifest.baselines | Where-Object { $_.release -eq 'pdf-app-timer-20260911' })
if ($originalBaseline.Count -ne 1) { throw 'The original approved source baseline is missing.' }
$originalInventory = $originalBaseline[0].files
$originalNames = @($originalInventory.PSObject.Properties | ForEach-Object { $_.Name })
if ($originalNames.Count -ne 19) { throw 'Unexpected original source inventory.' }
if (-not (Test-Path -LiteralPath $dependencies -PathType Container)) { throw 'Existing local dependencies are unavailable.' }
$runRoot = Join-Path $projectRoot ('workspace-artifacts\ai-chatbox-guide-upgrades-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null
$results = @()
foreach ($baseline in $manifest.baselines) {
  $fixtureRoot = Join-Path $runRoot ($baseline.release + '-' + [guid]::NewGuid().ToString('N'))
  $apiRoot = Join-Path $fixtureRoot 'api'
  $scratchRoot = Join-Path $fixtureRoot 'smoke'
  New-Item -ItemType Directory -Path $apiRoot,$scratchRoot | Out-Null
  & tar -xzf $baselineTar -C $apiRoot -- @originalNames
  if ($LASTEXITCODE -ne 0) { throw 'Original source extraction failed.' }
  Assert-Inventory -ApiRoot $apiRoot -Inventory $originalInventory
  if ($archives.ContainsKey($baseline.release)) {
    Expand-ReviewedPatch -ArchivePath $archives[$baseline.release].Path -ApiRoot $apiRoot -Baseline $baseline
  } elseif ($baseline.release -ne 'pdf-app-timer-20260911') { throw 'Unsupported baseline fixture.' }
  Assert-Inventory -ApiRoot $apiRoot -Inventory $baseline.files
  $before = Invoke-Checker -Arguments @('baseline',$apiRoot,$packageRoot)
  if ($before.state -ne 'baseline' -or $before.release -ne $baseline.release) { throw 'Old fixture was not recognized as its complete baseline.' }
  # Only this disposable API copy is updated. Existing dependencies are reused;
  # no package installation, production database or production service is used.
  New-Item -ItemType Junction -Path (Join-Path $apiRoot 'node_modules') -Target $dependencies | Out-Null
  foreach ($item in $manifest.files) {
    Copy-Item -LiteralPath (Join-Path $packageRoot $item.archive) -Destination (Join-Path $apiRoot $item.path) -Force
  }
  $after = Invoke-Checker -Arguments @('baseline',$apiRoot,$packageRoot)
  if ($after.state -ne 'installed' -or $after.release -ne $release) { throw 'Upgraded fixture was not recognized as the complete release.' }
  $smoke = Invoke-Checker -Arguments @('smoke',$apiRoot,$scratchRoot)
  if ($smoke.smoke -ne 'passed' -or $smoke.database -ne 'memory' -or $smoke.externalAiCalls -ne 0) { throw 'Isolated upgrade smoke did not pass its safety conditions.' }
  $results += [ordered]@{Baseline=$baseline.release;ApiRoot=$apiRoot;Before=$before;After=$after;Smoke=$smoke}
  Write-Host ('Passed upgrade and isolated smoke: ' + $baseline.release)
}
$report = [ordered]@{Release=$release;PackageStage=$packageRoot;RunRoot=$runRoot;Passed=$results.Count;Results=$results}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $runRoot 'upgrade-results.json'), (($report | ConvertTo-Json -Depth 10) + "`n"), $utf8)
$report | ConvertTo-Json -Depth 10
