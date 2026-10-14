param(
    [Parameter(Mandatory = $true)][ValidateSet('android', 'ios')][string]$Platform,
    [Parameter(Mandatory = $true)][ValidateSet('Verify', 'Publish')][string]$Action,
    [string]$Message = 'v28: show complete goals and pause guided audio during text narration',
    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$helper = Join-Path $PSScriptRoot 'goal-audio-v28-mobile-release.cjs'
$artifact = Join-Path $projectRoot "workspace-artifacts/goal-audio-20261014-v28-$Platform"
$stagedProject = Join-Path $artifact 'project'
$outputPath = Join-Path $artifact 'export'
$channel = if ($Platform -eq 'android') { 'preview' } else { 'production' }

& node $helper verify $Platform
if ($LASTEXITCODE -ne 0) { throw 'OTA_V28_VERIFICATION_FAILED' }
if ($Action -eq 'Verify') { return }

$environmentNames = @('EXPO_PUBLIC_API_BASE_URL', 'EXPO_NO_DOTENV', 'EXPO_OFFLINE', 'EXPO_OVERRIDE_METRO_CONFIG', 'EAS_PROJECT_ROOT', 'EAS_NO_VCS', 'CI')
$savedEnvironment = @{}
foreach ($name in $environmentNames) { $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    [Environment]::SetEnvironmentVariable('EXPO_PUBLIC_API_BASE_URL', 'https://api.outdoorfit.hk/api', 'Process')
    [Environment]::SetEnvironmentVariable('EXPO_NO_DOTENV', '1', 'Process')
    [Environment]::SetEnvironmentVariable('EXPO_OFFLINE', $null, 'Process')
    [Environment]::SetEnvironmentVariable('EXPO_OVERRIDE_METRO_CONFIG', $null, 'Process')
    [Environment]::SetEnvironmentVariable('EAS_PROJECT_ROOT', $stagedProject, 'Process')
    [Environment]::SetEnvironmentVariable('EAS_NO_VCS', '1', 'Process')
    Push-Location -LiteralPath $stagedProject
    try {
        $arguments = @('--yes', 'eas-cli@24.7.0', 'update', '--platform', $Platform,
            '--channel', $channel, '--input-dir', $outputPath, '--skip-bundler', '--message', $Message)
        if ($NonInteractive) { $arguments += '--non-interactive' }
        & npx @arguments
        if ($LASTEXITCODE -ne 0) { throw 'OTA_V28_PUBLISH_FAILED' }
    } finally { Pop-Location }
} finally {
    foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
}
Write-Host ('OTA_V28_{0}_PUBLISHED=YES' -f $Platform.ToUpperInvariant())
Write-Host ('OTA_CHANNEL={0}' -f $channel)
Write-Host 'ROOT_APP_CONFIG_UNCHANGED=YES'
