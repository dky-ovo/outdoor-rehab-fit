param([Parameter(Mandatory=$true)][string]$PackageStage)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageRoot = (Resolve-Path -LiteralPath $PackageStage).Path
$checker = Join-Path $packageRoot 'verify-contact-feedback-release.cjs'
$baselineTar = Join-Path $projectRoot 'workspace-artifacts\ai-tcm-prose-upgrade-29b5fefab8734e678869ddaef72b8ce9\baseline-api.tar.gz'
$archives = @{
 'ai-symptom-evidence-20260914' = @('deploy\2026-09-14\outdoor-fit-ai-backend-evidence-20260914-update.zip','23BF32F928B6ECDB217E1193036D05C6E26423569C7FCDF67E09A6D0248DA59B')
 'ai-tcm-excerpts-20260916' = @('deploy\2026-09-16\outdoor-fit-ai-tcm-backend-20260916-update.zip','65A4567772D270EC3AEAADC84EB4C9B492EE1DB41AE6FBEB0790F7AF8BA892F9')
 'ai-tcm-prose-20260916' = @('deploy\2026-09-16\outdoor-fit-ai-tcm-prose-backend-20260916-update.zip','47FEC604B5EA1421EFB8957537EF27F6F02FDD66369C8AA0EB80578B018BC938')
 'ai-chatbox-guide-20260917' = @('deploy\2026-09-17\outdoor-fit-ai-chatbox-guide-backend-20260917-update.zip','2DA2EA429534319C9D6C1A516C65291D09591274FC0F6540E0233EAA5E1A4C65')
}
function Verify {
 param([string[]]$Arguments)
 $value = & node $checker @Arguments
 if ($LASTEXITCODE -ne 0) { throw ('Checker failed: ' + ($Arguments -join ' ')) }
 return (($value -join "`n") | ConvertFrom-Json)
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$verified = Verify -Arguments @('package',$packageRoot)
if ($verified.package -ne 'verified') { throw 'Unverified package' }
$manifest = Get-Content -LiteralPath (Join-Path $packageRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $baselineTar).Hash -ne '13975D689773E4D9E6F0CF77C27176694B27008E8156F8710B903B2E48C7D7D6') { throw 'Original fixture changed' }
$originalNames = @($manifest.baselines[0].files.PSObject.Properties | ForEach-Object { $_.Name })
if ($originalNames.Count -ne 19 -or @($originalNames | Where-Object { $_ -notmatch '^(src/[A-Za-z0-9_-]+\.(js|json)|package(-lock)?\.json)$' }).Count) { throw 'Unsafe source inventory' }
$runRoot = Join-Path $projectRoot ('workspace-artifacts\contact-feedback-upgrades-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runRoot | Out-Null
$results = @()
foreach ($baseline in $manifest.baselines) {
 $fixture = Join-Path $runRoot $baseline.release
 $api = Join-Path $fixture 'api'
 $feedbackScratch = Join-Path $fixture 'feedback-smoke'
 $aiScratch = Join-Path $fixture 'ai-smoke'
 New-Item -ItemType Directory -Path $api,$feedbackScratch,$aiScratch | Out-Null
 & tar -xzf $baselineTar -C $api -- @originalNames
 if ($LASTEXITCODE -ne 0) { throw 'Original fixture extraction failed' }
 if ($archives.ContainsKey($baseline.release)) {
  $archive = Join-Path $projectRoot $archives[$baseline.release][0]
  if ((Get-FileHash -LiteralPath $archive).Hash -ne $archives[$baseline.release][1]) { throw 'Reviewed historical archive changed' }
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  try {
   $reader = [IO.StreamReader]::new($zip.GetEntry('patch-manifest.json').Open())
   try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
   if ($oldManifest.release -ne $baseline.release) { throw 'Wrong historical release' }
   foreach ($item in $oldManifest.files) {
    if ($item.path -notmatch '^src/[A-Za-z0-9_-]+\.(js|json)$' -or $item.archive -ne $item.path.Substring(4)) { throw 'Unsafe historical member' }
    $expected = $baseline.files.PSObject.Properties[$item.path]
    if (-not $expected -or $item.sha256 -ne $expected.Value) { throw 'Historical checksum mismatch' }
    $entry = $zip.GetEntry($item.archive)
    if (-not $entry -or $entry.Length -gt 2097152) { throw 'Historical member missing or too large' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,(Join-Path $api $item.path),$true)
   }
  } finally { $zip.Dispose() }
 }
 $before = Verify -Arguments @('baseline',$api,$packageRoot)
 if ($before.release -ne $baseline.release -or $before.state -ne 'baseline') { throw 'Original baseline rejected' }
 New-Item -ItemType Junction -Path (Join-Path $api 'node_modules') -Target (Join-Path $projectRoot 'server\node_modules') | Out-Null
 foreach ($item in $manifest.files) { Copy-Item -LiteralPath (Join-Path $packageRoot $item.archive) -Destination (Join-Path $api $item.path) -Force }
 $after = Verify -Arguments @('baseline',$api,$packageRoot)
 if ($after.release -ne $manifest.release -or $after.state -ne 'installed') { throw 'Upgraded baseline rejected' }
 $feedback = Verify -Arguments @('feedback-smoke',$api,$feedbackScratch)
 $ai = Verify -Arguments @('ai-smoke',$api,$aiScratch)
 if ($feedback.smoke -ne 'passed' -or $ai.smoke -ne 'passed' -or $ai.externalAiCalls -ne 0) { throw 'Isolated smoke failed' }
 $results += [ordered]@{Baseline=$baseline.release;Before=$before;After=$after;Feedback=$feedback;AI=$ai}
 Write-Host ('Upgrade verified: ' + $baseline.release)
}
$report = [ordered]@{Release=$manifest.release;PackageStage=$packageRoot;RunRoot=$runRoot;Passed=$results.Count;Results=$results}
[IO.File]::WriteAllText((Join-Path $runRoot 'results.json'),($report | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
$report | ConvertTo-Json -Depth 12
