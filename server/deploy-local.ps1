# Fast local database deployment script
# Updates existing database without deleting
# Run from server folder: ./deploy-local.ps1

# Ensure wasm-opt is on PATH for SpacetimeDB WASM optimisation
$binaryenBin = "$env:LOCALAPPDATA\Programs\Binaryen\binaryen-version_126\bin"
if (Test-Path (Join-Path $binaryenBin "wasm-opt.exe")) {
  $env:Path = $binaryenBin + ";" + $env:Path
}

# Set target directory outside OneDrive to avoid file locking issues
$env:CARGO_TARGET_DIR = "C:\RustBuild\medieval-road-system-target"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulePath = $scriptDir
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir ".."))
$outDir = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "src\generated"))

function Assert-LastExit([string]$stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw "[ERROR] $stepName failed with exit code $LASTEXITCODE."
  }
}

Set-Location $projectRoot

Write-Host "[BOOTSTRAP] Generating world tree bootstrap data..." -ForegroundColor Yellow
npm run generate:world-bootstrap
Assert-LastExit "Generate world bootstrap data"

Set-Location $modulePath

Write-Host "[BUILD] Building and deploying to local database..." -ForegroundColor Yellow
spacetime publish --no-config -p . city-builder -y
Assert-LastExit "Publish to local database"

Write-Host "[GEN] Regenerating client bindings..." -ForegroundColor Yellow
spacetime generate --no-config --include-private -p . -l typescript -o "$outDir" -y
Assert-LastExit "Generate TypeScript bindings"

Write-Host "[SUCCESS] Local deployment complete! Database: city-builder" -ForegroundColor Green
Write-Host "[INFO] Run 'npm run dev' from project root to test" -ForegroundColor Cyan
Write-Host "[INFO] Database was updated (not wiped)" -ForegroundColor Blue
