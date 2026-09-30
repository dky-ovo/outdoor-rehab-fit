param(
    [ValidateSet('Check', 'Publish')][string]$Action = 'Check',
    [string]$ProxyUrl,
    [switch]$Direct
)

$ErrorActionPreference = 'Stop'
if ($Direct -and $ProxyUrl) { throw 'CHOOSE_PROXY_OR_DIRECT' }
if ([Environment]::GetEnvironmentVariable('NODE_TLS_REJECT_UNAUTHORIZED', 'Process') -eq '0') {
    throw 'TLS_VERIFICATION_MUST_BE_ENABLED'
}
if ($ProxyUrl) {
    $proxy = $null
    if (-not [Uri]::TryCreate($ProxyUrl, [UriKind]::Absolute, [ref]$proxy) -or
        $proxy.Scheme -notin @('http', 'https') -or -not $proxy.Host -or
        $proxy.UserInfo -or $proxy.Query -or $proxy.Fragment -or $proxy.AbsolutePath -ne '/') {
        throw 'USE_HTTP_PROXY_URL_WITHOUT_CREDENTIALS'
    }
}

$releaseScript = Join-Path $PSScriptRoot 'android-build17-account-continuity-v9-ota.ps1'
& $releaseScript -Action Verify

# Reuse the installed, pinned EAS transport for the anonymous TLS probes.
# Never run npx here: Check must not install anything or publish an update.
$npmCache = [Environment]::GetEnvironmentVariable('npm_config_cache', 'Process')
if (-not $npmCache) { $npmCache = Join-Path $env:LOCALAPPDATA 'npm-cache' }
$easRoot = $null
foreach ($entry in (Get-ChildItem -LiteralPath (Join-Path $npmCache '_npx') -Directory -ErrorAction SilentlyContinue)) {
    $candidate = Join-Path $entry.FullName 'node_modules/eas-cli'
    $packagePath = Join-Path $candidate 'package.json'
    if (Test-Path -LiteralPath $packagePath) {
        $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
        if ($package.version -eq '24.7.0' -and (Test-Path -LiteralPath (Join-Path $candidate 'build/fetch.js'))) {
            $easRoot = $candidate
            break
        }
    }
}
if (-not $easRoot) { throw 'CACHED_EAS_24_7_0_NOT_FOUND' }

$savedEnvironment = @{}
foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    if ($ProxyUrl) {
        # Windows environment names are case insensitive. EAS reads https_proxy.
        foreach ($name in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY')) {
            [Environment]::SetEnvironmentVariable($name, $ProxyUrl, 'Process')
        }
        [Environment]::SetEnvironmentVariable('NO_PROXY', 'localhost,127.0.0.1,::1', 'Process')
        Write-Host 'OTA_NETWORK_ROUTE=EXPLICIT_HTTP_PROXY'
    } elseif ($Direct) {
        foreach ($name in $savedEnvironment.Keys) { Remove-Item -LiteralPath ("Env:\" + $name) -ErrorAction SilentlyContinue }
        Write-Host 'OTA_NETWORK_ROUTE=DIRECT'
    } else {
        Write-Host 'OTA_NETWORK_ROUTE=CURRENT_PROCESS_SETTINGS'
    }

    $probe = @'
const path = require('node:path');
const transport = require(path.join(process.argv[2], 'build/fetch.js'));
const endpoints = [
  ['EXPO_API', 'https://api.expo.dev/', [200]],
  ['EXPO_ASSET_UPLOAD', 'https://update-assets-upload-production.storage.googleapis.com/', [400, 403, 404]],
];
(async () => {
  let failed = false;
  for (const [label, url, expected] of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const start = Date.now();
    try {
      let response;
      try {
        response = await transport.default(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
      } catch (error) {
        if (!(error instanceof transport.RequestError)) throw error;
        response = error.response;
      }
      response.body?.destroy();
      console.log(`${label}_HTTP=${response.status}`);
      console.log(`${label}_TLS_MS=${Date.now() - start}`);
      if (!expected.includes(response.status)) throw Object.assign(new Error(), { code: 'UNEXPECTED_HTTP_STATUS' });
      console.log(`${label}_CONNECTION=PASS`);
    } catch (error) {
      failed = true;
      const code = error.name === 'AbortError' ? 'TIMEOUT' : String(error.code || 'TLS_OR_NETWORK_ERROR');
      console.log(`${label}_CONNECTION=FAIL`);
      console.log(`${label}_ERROR=${/^[A-Z0-9_]{1,64}$/.test(code) ? code : 'NETWORK_ERROR'}`);
    } finally {
      clearTimeout(timer);
    }
  }
  // An unsigned storage request is expected to be denied. Receiving that response
  // with certificate verification enabled proves connectivity, not upload rights.
  process.exitCode = failed ? 1 : 0;
})().catch(() => { console.error('OTA_NETWORK_PROBE=FAILED'); process.exitCode = 1; });
'@
    $probe | & node --input-type=commonjs - $easRoot
    if ($LASTEXITCODE -ne 0) { throw 'OTA_NETWORK_NOT_READY_NO_PUBLISH_ATTEMPTED' }
    Write-Host 'OTA_NETWORK_CHECK=PASS'
    if ($Action -eq 'Publish') {
        # The original sealed script controls the Android project, artifact and
        # exact app.json restoration. Do not duplicate or bypass that workflow.
        & $releaseScript -Action Publish
    } else {
        Write-Host 'OTA_PUBLISH_ATTEMPTED=NO'
    }
} finally {
    foreach ($name in $savedEnvironment.Keys) {
        if ($null -eq $savedEnvironment[$name]) {
            Remove-Item -LiteralPath ("Env:\" + $name) -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
        }
    }
}
