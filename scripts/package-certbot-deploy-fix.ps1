param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputZip = Join-Path $projectRoot 'deploy\2026-09-10\outdoor-fit-certbot-deploy-fix-20260910.zip'
if (Test-Path -LiteralPath $outputZip) { throw 'Existing patch ZIP will not be overwritten.' }
$stageRoot = Join-Path $projectRoot ('workspace-artifacts\certbot-patch-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stageRoot | Out-Null
$sources = @{
    'install-file-storage-certbot-fix-20260910.sh' = (Join-Path $projectRoot 'deploy\2026-09-10\install-file-storage-certbot-fix-20260910.sh')
    'configure-media-upload-proxy.cjs' = (Join-Path $PSScriptRoot 'configure-media-upload-proxy.cjs')
    'README.md' = (Join-Path $projectRoot 'docs\certbot-deploy-fix-20260910.md')
}
foreach ($name in $sources.Keys) { Copy-Item -LiteralPath $sources[$name] -Destination (Join-Path $stageRoot $name) }
$checksums = foreach ($name in ($sources.Keys | Sort-Object)) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $stageRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name"
}
[IO.File]::WriteAllText((Join-Path $stageRoot 'patch-checksums.sha256'),(($checksums -join "`n") + "`n"),(New-Object Text.UTF8Encoding($false)))
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::Open($outputZip,[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $stageRoot -File) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$file.FullName,$file.Name,[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($outputZip)
try {
    if ($archive.Entries.Count -ne 4) { throw 'Unexpected patch archive entry count.' }
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notin (@($sources.Keys) + 'patch-checksums.sha256')) { throw 'Unexpected patch entry.' }
        $stream = $entry.Open()
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { $actual = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','') } finally { $algorithm.Dispose(); $stream.Dispose() }
        $expected = (Get-FileHash -LiteralPath (Join-Path $stageRoot $entry.FullName) -Algorithm SHA256).Hash
        if ($actual -ne $expected) { throw 'Patch archive content differs from staged content.' }
        if ($sources.ContainsKey($entry.FullName) -and $actual -ne (Get-FileHash -LiteralPath $sources[$entry.FullName] -Algorithm SHA256).Hash) { throw 'Source changed during packaging.' }
    }
} finally { $archive.Dispose() }
$file = Get-Item -LiteralPath $outputZip
[pscustomobject]@{Path=$file.FullName;Bytes=$file.Length;KiB=[math]::Round($file.Length/1KB,2);SHA256=(Get-FileHash -LiteralPath $outputZip -Algorithm SHA256).Hash;VerifiedEntries=4;Staging=$stageRoot} | ConvertTo-Json
