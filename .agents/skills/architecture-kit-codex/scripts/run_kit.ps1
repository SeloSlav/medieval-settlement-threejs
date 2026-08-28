param(
    [string]$ProjectRoot,
    [string]$KitRoot = "art-source\gorski-architecture-kit",
    [string]$BlenderPath,
    [switch]$SkipRender
)

$ErrorActionPreference = "Stop"

if (-not $ProjectRoot) {
    $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
}
if (-not $BlenderPath) {
    $candidates = @(
        "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe",
        "C:\Program Files\Blender Foundation\Blender 5.0\blender.exe",
        "C:\Program Files\Blender Foundation\Blender 4.5\blender.exe"
    )
    $BlenderPath = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $BlenderPath -or -not (Test-Path -LiteralPath $BlenderPath)) {
    throw "Blender executable not found. Pass -BlenderPath explicitly."
}

$resolvedKitRoot = (Resolve-Path (Join-Path $ProjectRoot $KitRoot)).Path
$blendPath = Join-Path $resolvedKitRoot "out\gorski_architecture_kit.blend"

Push-Location $ProjectRoot
try {
    & $BlenderPath --background --factory-startup --python-exit-code 1 --python (Join-Path $resolvedKitRoot "build_kit.py")
    if ($LASTEXITCODE -ne 0) { throw "Architecture-kit build failed with exit code $LASTEXITCODE" }

    & $BlenderPath --background $blendPath --python-exit-code 1 --python (Join-Path $resolvedKitRoot "validate_kit.py")
    if ($LASTEXITCODE -ne 0) { throw "Architecture-kit structural validation failed with exit code $LASTEXITCODE" }

    & $BlenderPath --background --factory-startup --python-exit-code 1 --python (Join-Path $resolvedKitRoot "validate_roundtrip.py")
    if ($LASTEXITCODE -ne 0) { throw "Architecture-kit GLB round-trip failed with exit code $LASTEXITCODE" }

    if (-not $SkipRender) {
        & $BlenderPath --background $blendPath --python-exit-code 1 --python (Join-Path $resolvedKitRoot "render_kit.py")
        if ($LASTEXITCODE -ne 0) { throw "Architecture-kit render pass failed with exit code $LASTEXITCODE" }
    }
}
finally {
    Pop-Location
}

Write-Host "Architecture kit pipeline passed: $resolvedKitRoot"
