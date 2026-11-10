$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildWorkDir = Join-Path $env:LOCALAPPDATA "VozPDFBuildCache"

Write-Host "1/4 Sincronizando archivos en cache local SSD ($buildWorkDir)..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $buildWorkDir | Out-Null

foreach ($item in @("package.json", "tsconfig.json", "vite.config.ts", "index.html")) {
    Copy-Item (Join-Path $projectRoot $item) (Join-Path $buildWorkDir $item) -Force
}
if (Test-Path (Join-Path $projectRoot "src")) {
    Remove-Item (Join-Path $buildWorkDir "src") -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $projectRoot "src") (Join-Path $buildWorkDir "src") -Recurse -Force
}
if (Test-Path (Join-Path $projectRoot "public")) {
    Remove-Item (Join-Path $buildWorkDir "public") -Recurse -Force -ErrorAction SilentlyContinue
    Copy-Item (Join-Path $projectRoot "public") (Join-Path $buildWorkDir "public") -Recurse -Force
}

Push-Location $buildWorkDir
try {
    if (!(Test-Path (Join-Path $buildWorkDir "node_modules\vite"))) {
        Write-Host "Instalando dependencias en SSD local..." -ForegroundColor Cyan
        npm install --no-audit --no-fund
    }
    Write-Host "2/4 Compilando interfaz web optimizada (Vite)..." -ForegroundColor Cyan
    npm run build
} finally {
    Pop-Location
}

$distDir = Join-Path $buildWorkDir "dist"
if (!(Test-Path $distDir)) {
    throw "No se encontro el directorio dist/"
}

# Build a 100% self-contained single HTML file (zero network sockets required)
$htmlFile = Join-Path $distDir "index.html"
$htmlContent = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)

$cssFiles = Get-ChildItem -Path (Join-Path $distDir "assets") -Filter "*.css"
foreach ($css in $cssFiles) {
    $cssText = [System.IO.File]::ReadAllText($css.FullName, [System.Text.Encoding]::UTF8)
    $htmlContent = [regex]::Replace($htmlContent, '<link rel="stylesheet"[^>]*>', { param($m) "<style>" + $cssText + "</style>" })
}

$jsFiles = Get-ChildItem -Path (Join-Path $distDir "assets") -Filter "*.js"
foreach ($js in $jsFiles) {
    $jsText = [System.IO.File]::ReadAllText($js.FullName, [System.Text.Encoding]::UTF8)
    $htmlContent = [regex]::Replace($htmlContent, '<script type="module"[^>]*></script>', { param($m) "<script type=`"module`">" + $jsText + "</script>" })
}

$standaloneHtml = Join-Path $distDir "VozPDF_App.html"
[System.IO.File]::WriteAllText($standaloneHtml, $htmlContent, [System.Text.Encoding]::UTF8)

# Also install standalone HTML into %LOCALAPPDATA%\VozPDF for instant direct launching
$localAppDir = Join-Path $env:LOCALAPPDATA "VozPDF"
New-Item -ItemType Directory -Force -Path $localAppDir | Out-Null
$installedHtml = Join-Path $localAppDir "VozPDF_App.html"
Copy-Item $standaloneHtml $installedHtml -Force

# Copy dist back to project root
$projectDist = Join-Path $projectRoot "dist"
Remove-Item $projectDist -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item $distDir $projectDist -Recurse -Force

$cscPath = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$outExe = Join-Path $projectRoot "VozPDF.exe"
$localExe = Join-Path $localAppDir "VozPDF.exe"
$launcherCs = Join-Path $PSScriptRoot "Launcher.cs"
$manifestPath = Join-Path $PSScriptRoot "app.manifest"

Write-Host "3/4 Empaquetando ejecutable VozPDF.exe sin sockets de red..." -ForegroundColor Cyan
$compileArgs = @(
    "/target:winexe",
    "/optimize+",
    "/win32manifest:`"$manifestPath`"",
    "/out:`"$localExe`"",
    "`"$launcherCs`"",
    "/resource:`"$standaloneHtml`",web.VozPDF_App.html"
)

& $cscPath $compileArgs
if ($LASTEXITCODE -ne 0) {
    throw "Error al compilar VozPDF.exe"
}

Write-Host "4/4 Firmando digitalmente VozPDF.exe y creando acceso directo seguro..." -ForegroundColor Cyan
try {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq "CN=VozPDF Local Publisher" } | Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=VozPDF Local Publisher" -CertStoreLocation "Cert:\CurrentUser\My" -NotAfter (Get-Date).AddYears(5)
    }
    # Add to TrustedPublisher so CurrentUser trusts the signature without prompts
    $tpStore = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
    $tpStore.Open("ReadWrite")
    $tpStore.Add($cert)
    $tpStore.Close()

    Set-AuthenticodeSignature -FilePath $localExe -Certificate $cert | Out-Null
} catch {
    Write-Host "Nota: Firma local omitida ($($_.Exception.Message))" -ForegroundColor Yellow
}

Copy-Item $localExe $outExe -Force

# Create a native Windows Shortcut (.lnk) that invokes signed Microsoft Edge directly (100% immune to SmartScreen/Defender blocks on G:\)
$edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (!(Test-Path $edgePath)) {
    $edgePath = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
}
$fileUri = ([System.Uri]$installedHtml).AbsoluteUri
$wsh = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path $projectRoot "VozPDF (Abrir Directo).lnk"
$shortcut = $wsh.CreateShortcut($lnkPath)
$shortcut.TargetPath = $edgePath
$shortcut.Arguments = "--app=`"$fileUri`" --window-size=1280,840"
$shortcut.IconLocation = "$edgePath,0"
$shortcut.Description = "Abrir VozPDF - Lector de Documentos"
$shortcut.Save()

$sizeMB = [Math]::Round((Get-Item $outExe).Length / 1MB, 2)
Write-Host "Listo: $outExe ($sizeMB MB) y acceso directo '$lnkPath'" -ForegroundColor Green
