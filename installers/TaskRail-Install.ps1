$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ($env:OS -ne 'Windows_NT') {
  throw 'This TaskRail installer is for Windows only.'
}

foreach ($cmd in @('node','npm')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "Missing required command: $cmd" }
}

node -e "const m=Number(process.versions.node.split('.')[0]); if(m<22){console.error('TaskRail requires Node.js 22 or newer');process.exit(1)}"
if ($LASTEXITCODE -ne 0) { throw 'Node.js 22 or newer is required.' }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("taskrail-install-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $api = if ($env:TASKRAIL_RELEASE_API) { $env:TASKRAIL_RELEASE_API } else { 'https://api.github.com/repos/gurjyot/taskrail/releases/latest' }
  $release = Invoke-RestMethod -Uri $api -Headers @{ 'User-Agent' = 'taskrail-installer' } -MaximumRetryCount 5 -RetryIntervalSec 2 -TimeoutSec 120
  if (-not $release.tag_name) { throw 'GitHub release did not include tag_name.' }
  $tag = [string]$release.tag_name
  $version = $tag.TrimStart('v')
  $base = if ($env:TASKRAIL_RELEASE_BASE) { $env:TASKRAIL_RELEASE_BASE } else { "https://github.com/gurjyot/taskrail/releases/download/$tag" }
  $platformManifest = if ($env:TASKRAIL_PLATFORM_MANIFEST_URL) { $env:TASKRAIL_PLATFORM_MANIFEST_URL } else { "https://raw.githubusercontent.com/gurjyot/taskrail/$tag/platform-install/manifest.json" }

  $manifestPath = Join-Path $tmp 'taskrail-install-manifest.json'
  Invoke-WebRequest -Uri "$base/taskrail-install-manifest.json" -OutFile $manifestPath -Headers @{ 'User-Agent' = 'taskrail-installer' } -MaximumRetryCount 5 -RetryIntervalSec 2 -TimeoutSec 120
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ([string]$manifest.taskrailVersion -ne $version) { throw "Install manifest version mismatch: expected $version" }

  $asset = [string]$manifest.framework.file
  $expected = ([string]$manifest.framework.sha256).ToLowerInvariant()
  if (-not $asset -or -not $expected) { throw 'Install manifest is incomplete.' }
  $packagePath = Join-Path $tmp $asset
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $packagePath -Headers @{ 'User-Agent' = 'taskrail-installer' } -MaximumRetryCount 5 -RetryIntervalSec 2 -TimeoutSec 300
  $actual = (Get-FileHash -Path $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw 'TaskRail package checksum verification failed.' }

  & npm install -g $packagePath
  if ($LASTEXITCODE -ne 0) { throw 'TaskRail package installation failed.' }

  $env:TASKRAIL_PLATFORM_MANIFEST_URL = $platformManifest
  & taskrail-platform-bootstrap install
  if ($LASTEXITCODE -ne 0) { throw 'TaskRail Windows platform adapter installation failed.' }

  & taskrail --help *> $null
  if ($LASTEXITCODE -ne 0) { throw 'TaskRail CLI verification failed.' }
  & taskrail-platform-bootstrap status *> $null
  if ($LASTEXITCODE -ne 0) { throw 'TaskRail platform verification failed.' }
  Write-Host "TaskRail $version installed successfully for Windows."
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
