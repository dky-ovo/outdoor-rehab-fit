param(
    [Parameter(Mandatory = $true)][ValidateSet('Export', 'Verify', 'Publish')][string]$Action,
    [string]$Message = 'Aliyun API, favorites, About and Contact fixes for Android Build 17',
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'app.json'
$backupPath = Join-Path $projectRoot 'app.json.android-build17-ota-backup'
$helper = Join-Path $PSScriptRoot 'android-build17-ota-manifest.cjs'
$outputPath = Join-Path $projectRoot 'workspace-artifacts/android-build17-aliyun-fixes-20260924-v1/export'

function Invoke-Manifest([string]$Step) {
    & node $helper $Step
    if ($LASTEXITCODE -ne 0) { throw "OTA_MANIFEST_STEP_FAILED: $Step" }
}

if ($Action -eq 'Verify') {
    Invoke-Manifest 'verify'
    return
}
foreach ($name in @('app.json.android-update-backup', 'app.json.android-build-backup', 'app.json.android-build17-ota-backup')) {
    if (Test-Path -LiteralPath (Join-Path $projectRoot $name)) { throw 'OTA_CONFIG_BACKUP_ALREADY_EXISTS' }
}
if ($Action -eq 'Export') { Invoke-Manifest 'init' } else { Invoke-Manifest 'verify' }

$original = [System.IO.File]::ReadAllBytes($configPath)
$backup = [System.IO.File]::Open($backupPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write)
try { $backup.Write($original, 0, $original.Length); $backup.Flush($true) } finally { $backup.Dispose() }
$environmentNames = @('EXPO_PUBLIC_API_BASE_URL', 'EXPO_NO_DOTENV', 'EXPO_OFFLINE', 'CI')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$restored = $false

try {
    $config = [Text.Encoding]::UTF8.GetString($original).TrimStart([char]0xFEFF) | ConvertFrom-Json
    $config.expo.owner = 'dky2004'
    $config.expo.extra.eas.projectId = 'bcee8c37-e833-4f4d-b660-aa457accd96d'
    $config.expo.updates.url = 'https://u.expo.dev/bcee8c37-e833-4f4d-b660-aa457accd96d'
    $config.expo.version = '1.2.3'
    $config.expo.runtimeVersion = '1.2.3'
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 100), [Text.UTF8Encoding]::new($false))
    [Environment]::SetEnvironmentVariable('EXPO_NO_DOTENV', '1', 'Process')
    Push-Location $projectRoot
    try {
        Invoke-Manifest 'assert-config'
        if ($Action -eq 'Export') {
            [Environment]::SetEnvironmentVariable('EXPO_PUBLIC_API_BASE_URL', 'https://api.outdoorfit.hk/api', 'Process')
            [Environment]::SetEnvironmentVariable('EXPO_OFFLINE', '1', 'Process')
            [Environment]::SetEnvironmentVariable('CI', '1', 'Process')
            & node (Join-Path $projectRoot 'node_modules/expo/bin/cli') export --platform android --max-workers 2 --output-dir $outputPath
            if ($LASTEXITCODE -ne 0) { throw 'OTA_ANDROID_EXPORT_FAILED' }
        } else {
            [Environment]::SetEnvironmentVariable('EXPO_OFFLINE', $null, 'Process')
            $arguments = @('--yes', 'eas-cli@24.7.0', 'update', '--platform', 'android', '--channel', 'preview',
                '--input-dir', $outputPath, '--skip-bundler', '--message', $Message)
            if ($NonInteractive) { $arguments += '--non-interactive' }
            & npx @arguments
            if ($LASTEXITCODE -ne 0) { throw 'OTA_ANDROID_PUBLISH_FAILED' }
        }
    } finally { Pop-Location }
} finally {
    try {
        [System.IO.File]::WriteAllBytes($configPath, $original)
        $restored = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath)) -ceq [Convert]::ToBase64String($original)
        if (-not $restored) { throw 'OTA_CONFIG_RESTORE_FAILED_BACKUP_RETAINED' }
    } finally {
        foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
        if ($restored) { Remove-Item -LiteralPath $backupPath }
    }
}

if ($Action -eq 'Export') { Invoke-Manifest 'seal' } else { Invoke-Manifest 'verify'; Write-Host 'OTA_ANDROID_PREVIEW_PUBLISHED=YES' }
Write-Host 'ORIGINAL_CONFIG_AND_ENV_RESTORED=YES'
