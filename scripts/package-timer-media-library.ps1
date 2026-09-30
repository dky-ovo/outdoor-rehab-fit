param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageName = 'outdoor-fit-timer-media-library-20260909-update.zip'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-09'
$outputZip = Join-Path $deployRoot $packageName
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\timer-media-package-' + [guid]::NewGuid().ToString('N'))
$apiStage = Join-Path $stageRoot 'api'
$packageStage = Join-Path $stageRoot 'package'
$webExport = Join-Path $projectRoot 'workspace-artifacts\exports\timer-media-library-web-20260909'
$seedRoot = Join-Path $projectRoot 'workspace-artifacts\media-seed-20260909-v2'
if (Test-Path -LiteralPath $outputZip) { throw 'Package already exists. Inspect it before creating a replacement.' }
foreach ($required in @((Join-Path $webExport 'index.html'),(Join-Path $seedRoot 'manifest.json'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing generated artifact: $required" }
}
New-Item -ItemType Directory -Path $apiStage,$packageStage -Force | Out-Null
foreach ($relative in @('src','package.json','package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path (Join-Path $projectRoot 'server') $relative) -Destination $apiStage -Recurse
}
Copy-Item -LiteralPath $seedRoot -Destination (Join-Path $apiStage 'media-seed') -Recurse
$apiArchive = Join-Path $packageStage 'outdoor-fit-api-timer-media-library-20260909.tar.gz'
tar.exe -czf $apiArchive -C $apiStage src package.json package-lock.json media-seed
if ($LASTEXITCODE -ne 0) { throw 'API archive failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webArchive = Join-Path $packageStage 'outdoor-fit-web-timer-media-library-20260909.zip'
[System.IO.Compression.ZipFile]::CreateFromDirectory($webExport,$webArchive,[System.IO.Compression.CompressionLevel]::Optimal,$false)
Copy-Item -LiteralPath (Join-Path $deployRoot 'install-timer-media-library-20260909.sh') -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'configure-media-upload-proxy.cjs') -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'validate-media-deploy-paths.cjs') -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\timer-media-library-update-20260909.md') -Destination $packageStage
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\android-native-countdown-alarm-fix-20260909.md') -Destination $packageStage
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageStage,$outputZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$file = Get-Item -LiteralPath $outputZip
$hash = Get-FileHash -LiteralPath $outputZip -Algorithm SHA256
[pscustomobject]@{Path=$file.FullName;Bytes=$file.Length;MiB=[math]::Round($file.Length / 1MB,2);SHA256=$hash.Hash;Staging=$stageRoot} | ConvertTo-Json
