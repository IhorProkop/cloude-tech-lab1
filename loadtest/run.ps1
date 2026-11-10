param(
    [int]$Vus = 20,
    [string]$RunName = ("run-" + (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")),
    [string]$RampUp = "3m",
    [string]$Steady = "5m",
    [string]$RampDown = "2m",
    [double]$ThinkTime = 0.2,
    [string]$SecretId = "cloude-tech-lab1-app-secrets",
    [string]$AuthUser = "admin"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$infraDir = Join-Path $repoRoot "infra\main"
$resultsDir = Join-Path $PSScriptRoot "results"
$scriptPath = Join-Path $PSScriptRoot "script.js"
New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null

$k6 = Get-Command k6 -ErrorAction SilentlyContinue
if ($k6) {
    $k6Path = $k6.Source
} elseif (Test-Path "$env:ProgramFiles\k6\k6.exe") {
    $k6Path = "$env:ProgramFiles\k6\k6.exe"
} else {
    throw "k6 not found. Install it with: winget install GrafanaLabs.k6"
}

$baseUrl = terraform "-chdir=$infraDir" output -raw app_url
if ($LASTEXITCODE -ne 0 -or -not $baseUrl) { throw "Cannot read app_url from terraform output" }

$secretString = aws secretsmanager get-secret-value --secret-id $SecretId --query SecretString --output text
if ($LASTEXITCODE -ne 0 -or -not $secretString) { throw "Cannot read secret $SecretId" }
$authPassword = ($secretString | ConvertFrom-Json).AUTH_PASSWORD
$secretString = $null

$env:BASE_URL = $baseUrl
$env:AUTH_USER = $AuthUser
$env:AUTH_PASSWORD = $authPassword
$env:VUS = "$Vus"
$env:RAMP_UP = $RampUp
$env:STEADY = $Steady
$env:RAMP_DOWN = $RampDown
$env:THINK_TIME = $ThinkTime.ToString([System.Globalization.CultureInfo]::InvariantCulture)
$env:RUN_NAME = $RunName
$env:SUMMARY_PATH = Join-Path $resultsDir "$RunName.json"
$authPassword = $null

try {
    & $k6Path run --log-output "file=$(Join-Path $resultsDir "$RunName.log")" $scriptPath
    $exitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:AUTH_PASSWORD, Env:BASE_URL -ErrorAction SilentlyContinue
}

exit $exitCode
