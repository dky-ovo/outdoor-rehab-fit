param(
	[string]$Message = "Add editing for completed exercise records",
	[string]$InputDir = "",
	[switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectConfigPath = Join-Path $projectRoot "app.json"
$backupConfigPath = Join-Path $projectRoot "app.json.android-update-backup"

if (Test-Path -LiteralPath $backupConfigPath) {
	throw "A previous app.json backup already exists: $backupConfigPath"
}
if (Test-Path -LiteralPath (Join-Path $projectRoot "app.json.android-build-backup")) {
	throw "An Android build is already using app.json. Wait for that command to finish first."
}

Copy-Item -LiteralPath $projectConfigPath -Destination $backupConfigPath

try {
	$config = Get-Content -LiteralPath $projectConfigPath -Raw | ConvertFrom-Json
	$config.expo.owner = "dky2004"
	$config.expo.extra.eas.projectId = "bcee8c37-e833-4f4d-b660-aa457accd96d"
	$config.expo.updates.url = "https://u.expo.dev/bcee8c37-e833-4f4d-b660-aa457accd96d"
	$config | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $projectConfigPath -Encoding utf8

	Push-Location $projectRoot
	try {
		$easUpdateArguments = @("eas-cli@latest", "update", "--platform", "android", "--channel", "preview", "--message", $Message)
		# Allow isolated release output without replacing an earlier dist export.
		if ($InputDir) { $easUpdateArguments += @("--input-dir", $InputDir) }
		if ($NonInteractive) { $easUpdateArguments += "--non-interactive" }
		& npx @easUpdateArguments
		if ($LASTEXITCODE -ne 0) {
			throw "EAS Update failed with exit code $LASTEXITCODE."
		}
	} finally {
		Pop-Location
	}
} finally {
	Move-Item -LiteralPath $backupConfigPath -Destination $projectConfigPath -Force
}

Write-Host "Android preview update published. The maxcch.c iOS configuration has been restored."
