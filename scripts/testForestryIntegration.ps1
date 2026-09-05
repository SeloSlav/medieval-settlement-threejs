param([string]$Server = 'http://127.0.0.1:3013')
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskCli = Join-Path $env:LOCALAPPDATA 'SpacetimeDB/spacetime.exe'
$taskDatabase = 'selo-forestry-test-' + [guid]::NewGuid().ToString('N').Substring(0,12)
Push-Location $taskRoot
try {
    # The opt-in reducer rejects nonempty databases and is absent from normal builds.
    cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release --features forestry-tests --target-dir server/target-forestry
    if ($LASTEXITCODE -ne 0) { throw 'Forestry test module build failed' }
    & $taskCli publish --server $Server --bin-path server/target-forestry/wasm32-unknown-unknown/release/medieval_road_system_server.wasm --yes $taskDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Forestry test publish failed' }
    & $taskCli call --server $Server $taskDatabase run_forestry_regression
    if ($LASTEXITCODE -ne 0) { throw 'Forestry test reducer failed' }
    $taskLogs = & $taskCli logs --server $Server $taskDatabase --num-lines 15
    if ($LASTEXITCODE -ne 0 -or ($taskLogs -join "`n") -notmatch 'FORESTRY_REGRESSION_PASSED') { throw ($taskLogs -join "`n") }
    New-Item -ItemType Directory -Force -Path artifacts/forestry | Out-Null
    $taskLogs | Set-Content -LiteralPath artifacts/forestry/economy-regression.log
    Write-Output "Forestry integration passed in disposable database $taskDatabase"
} finally { Pop-Location }
