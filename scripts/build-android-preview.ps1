param(
    [string]$Message = "Add timer notification display and camera permissions",
    [switch]$NoWait,
    [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot 'verify-reply-only-config.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Reply-only speech configuration checks failed; build not submitted.' }
$projectConfigPath = Join-Path $projectRoot "app.json"
$backupConfigPath = Join-Path $projectRoot "app.json.android-build-backup"

if (Test-Path -LiteralPath $backupConfigPath) {
    throw "A previous app.json backup already exists: $backupConfigPath. Check it before starting another build."
}
if (Test-Path -LiteralPath (Join-Path $projectRoot "app.json.android-update-backup")) {
    throw "An Android update is already using app.json. Wait for that command to finish first."
}

Copy-Item -LiteralPath $projectConfigPath -Destination $backupConfigPath
try {
    $config = Get-Content -LiteralPath $projectConfigPath -Raw | ConvertFrom-Json
    $config.expo.owner = "dky2004"
    $config.expo.extra.eas.projectId = "bcee8c37-e833-4f4d-b660-aa457accd96d"
    $config.expo.updates.url = "https://u.expo.dev/bcee8c37-e833-4f4d-b660-aa457accd96d"
    # A native module and camera declarations require a new APK, not eas update.
    $json = $config | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($projectConfigPath, $json, [Text.UTF8Encoding]::new($false))
    Push-Location $projectRoot
    try {
        $buildArguments = @('eas-cli@latest', 'build', '--platform', 'android', '--profile', 'preview', '--message', $Message)
        if ($NoWait) { $buildArguments += '--no-wait' }
        if ($NonInteractive) { $buildArguments += @('--non-interactive', '--freeze-credentials') }
        & npx @buildArguments
        if ($LASTEXITCODE -ne 0) { throw "EAS Android build failed with exit code $LASTEXITCODE." }
    } finally { Pop-Location }
} finally {
    Move-Item -LiteralPath $backupConfigPath -Destination $projectConfigPath -Force
}

if ($NoWait) { Write-Host "Android build submitted. Wait for EAS to finish before installing its new APK." }
else { Write-Host "Android build completed. Install the new APK; existing installations do not gain native features through OTA." }
Write-Host "The maxcch.c iOS project configuration has been restored."
