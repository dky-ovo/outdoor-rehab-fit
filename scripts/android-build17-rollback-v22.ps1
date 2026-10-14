param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Verify', 'Publish')]
    [string]$Action
)

$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'android-build17-rollback-v22.cjs') $Action
if ($LASTEXITCODE -ne 0) { throw 'ANDROID_V22_ROLLBACK_FAILED_SEE_ERROR_CODE' }
