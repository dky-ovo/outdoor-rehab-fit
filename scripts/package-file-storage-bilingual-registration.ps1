param([string]$ResumeStage = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageName = 'outdoor-fit-file-storage-bilingual-registration-20260910-update.zip'
$deployRoot = Join-Path $projectRoot 'deploy\2026-09-10'
$outputZip = Join-Path $deployRoot $packageName
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\file-storage-package-' + [guid]::NewGuid().ToString('N'))
if ($ResumeStage) {
    $stageRoot = (Resolve-Path -LiteralPath $ResumeStage).Path
    $expectedParent = Join-Path $projectRoot 'workspace-artifacts'
    if ((Split-Path -Parent $stageRoot) -ne $expectedParent -or (Split-Path -Leaf $stageRoot) -notmatch '^file-storage-package-[a-f0-9]{32}$') { throw 'Unexpected resume staging directory.' }
    if ((Get-Item -LiteralPath $stageRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked staging directory is not allowed.' }
}
$apiStage = Join-Path $stageRoot 'api'
$packageStage = Join-Path $stageRoot 'package'
$webExport = Join-Path $projectRoot 'workspace-artifacts\exports\file-storage-bilingual-registration-20260910'
$seedRoot = Join-Path $projectRoot 'workspace-artifacts\education-video-seed-20260910'
$installer = 'install-file-storage-bilingual-registration-20260910.sh'
$apiArchiveName = 'outdoor-fit-api-file-storage-bilingual-registration-20260910.tar.gz'
$webArchiveName = 'outdoor-fit-web-file-storage-bilingual-registration-20260910.zip'
$documents = @('file-storage-bilingual-registration-20260910.md','file-storage-education-seed-verification-20260910.md')
if (Test-Path -LiteralPath $outputZip) { throw 'Package already exists; a previous package will never be overwritten.' }
foreach ($required in @((Join-Path $webExport 'index.html'),(Join-Path $seedRoot 'manifest.json'),(Join-Path $deployRoot $installer))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing generated artifact: $required" }
}
foreach ($document in $documents) { if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "docs\$document") -PathType Leaf)) { throw "Missing final report: $document" } }
if ((Get-FileHash -LiteralPath (Join-Path $seedRoot 'manifest.json') -Algorithm SHA256).Hash -ne '8340866AE6E02AD1E6F1EE81A46966D84A9311AA5D8562A63FCCA078F0A7EF39') { throw 'The reviewed education manifest changed; repeat source verification first.' }
$manifest = [System.IO.File]::ReadAllText((Join-Path $seedRoot 'manifest.json'),[System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ($manifest.items.Count -ne 57 -or @($manifest.items | Where-Object { $null -ne $_.equipmentId }).Count -ne 54) { throw 'Expected 57 originals and 54 language bindings.' }
New-Item -ItemType Directory -Path $apiStage,$packageStage -Force | Out-Null
if (-not $ResumeStage) {
    foreach ($relative in @('src','package.json','package-lock.json')) { Copy-Item -LiteralPath (Join-Path (Join-Path $projectRoot 'server') $relative) -Destination $apiStage -Recurse }
    $seedStage = Join-Path $apiStage 'media-seed'
    New-Item -ItemType Directory -Path $seedStage | Out-Null
    Copy-Item -LiteralPath (Join-Path $seedRoot 'manifest.json') -Destination $seedStage
    Copy-Item -LiteralPath (Join-Path $seedRoot 'files') -Destination $seedStage -Recurse
}
node -e 'require(process.argv[1]).validateApiPayload(process.argv[2])' (Join-Path $PSScriptRoot 'validate-media-deploy-paths.cjs') $apiStage
if ($LASTEXITCODE -ne 0) { throw 'API or seed payload validation failed.' }
$sourceInventory = @()
foreach ($file in Get-ChildItem -LiteralPath $apiStage -File -Recurse) {
    $relative = $file.FullName.Substring($apiStage.Length + 1)
    $original = if ($relative.StartsWith('media-seed\')) { Join-Path $seedRoot $relative.Substring(11) } else { Join-Path (Join-Path $projectRoot 'server') $relative }
    if (-not (Test-Path -LiteralPath $original -PathType Leaf)) { throw "Unexpected staged source: $relative" }
    $sha = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    if ($sha -ne (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash) { throw "Source changed while copying: $relative" }
    $sourceInventory += [pscustomobject]@{ Path=$relative.Replace('\','/'); Bytes=$file.Length; SHA256=$sha; Source=$original }
}
if (-not (Test-Path -LiteralPath (Join-Path $packageStage $apiArchiveName))) {
    tar.exe -czf (Join-Path $packageStage $apiArchiveName) -C $apiStage src package.json package-lock.json media-seed
    if ($LASTEXITCODE -ne 0) { throw 'API archive creation failed.' }
}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$webArchivePath = Join-Path $packageStage $webArchiveName
if (Test-Path -LiteralPath $webArchivePath) {
    $priorArchive = Join-Path $stageRoot ('prior-web-archive-' + [guid]::NewGuid().ToString('N') + '.zip')
    Move-Item -LiteralPath $webArchivePath -Destination $priorArchive
}
# Windows PowerShell's .NET Framework CreateFromDirectory writes backslashes.
# Explicit POSIX entry names are required for predictable safe Linux extraction.
$webZip = [System.IO.Compression.ZipFile]::Open($webArchivePath,[System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($webFile in Get-ChildItem -LiteralPath $webExport -File -Recurse) {
        $entryName = $webFile.FullName.Substring($webExport.Length + 1).Replace('\','/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($webZip,$webFile.FullName,$entryName,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $webZip.Dispose() }
Copy-Item -LiteralPath (Join-Path $deployRoot $installer) -Destination $packageStage
$helpers = @('configure-media-upload-proxy.cjs','validate-media-deploy-paths.cjs','validate-media-deploy-archives.cjs','verify-file-storage-install.cjs')
foreach ($helper in $helpers) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $helper) -Destination $packageStage }
foreach ($document in $documents) { Copy-Item -LiteralPath (Join-Path $projectRoot "docs\$document") -Destination $packageStage }
node (Join-Path $packageStage 'validate-media-deploy-archives.cjs') (Join-Path $packageStage $apiArchiveName) (Join-Path $packageStage $webArchiveName)
if ($LASTEXITCODE -ne 0) { throw 'Archive extraction safety verification failed.' }
$checksums = foreach ($name in @($apiArchiveName,$webArchiveName) + $helpers) { $hash = (Get-FileHash -LiteralPath (Join-Path $packageStage $name) -Algorithm SHA256).Hash.ToLowerInvariant(); "$hash  $name" }
[System.IO.File]::WriteAllText((Join-Path $packageStage 'runtime-checksums.sha256'),(($checksums -join "`n") + "`n"),(New-Object System.Text.UTF8Encoding($false)))
$sourceCount = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'server\src') -File -Recurse).Count
if ($sourceCount -ne @($sourceInventory | Where-Object { $_.Path.StartsWith('src/') }).Count) { throw 'API source file list changed during packaging.' }
foreach ($item in $sourceInventory) { if ($item.SHA256 -ne (Get-FileHash -LiteralPath $item.Source -Algorithm SHA256).Hash) { throw "Source changed while packaging: $($item.Path)" } }
$inventory = [pscustomobject]@{ CreatedAt=[DateTime]::UtcNow.ToString('o'); ApiAndSeedFiles=@($sourceInventory | Select-Object Path,Bytes,SHA256); SeedImportId=$manifest.importId; SeedFiles=57; ReviewedVideoBindings=54; WebExport=$webExport }
[System.IO.File]::WriteAllText((Join-Path $packageStage 'build-inventory.json'),($inventory | ConvertTo-Json -Depth 6),(New-Object System.Text.UTF8Encoding($false)))
[System.IO.Compression.ZipFile]::CreateFromDirectory($packageStage,$outputZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$file = Get-Item -LiteralPath $outputZip
$hash = Get-FileHash -LiteralPath $outputZip -Algorithm SHA256
[pscustomobject]@{Path=$file.FullName;Bytes=$file.Length;MiB=[math]::Round($file.Length / 1MB,2);SHA256=$hash.Hash;Staging=$stageRoot;ApiSourceFiles=$sourceCount;SeedFiles=57} | ConvertTo-Json
