$ErrorActionPreference = "Stop"

$thumbprint = ([string]$env:CASTARYN_WINDOWS_CERTIFICATE_THUMBPRINT).Replace(" ", "").ToUpperInvariant()
$timestampUrl = $env:CASTARYN_WINDOWS_TIMESTAMP_URL
$timestampUri = $null

# Public production endpoints are compiled into the desktop client. They are
# identifiers, not secrets; keeping them here prevents accidentally shipping a
# Player-only build with Creator controls disabled.
$env:CASTARYN_CREATOR_API_URL = "https://api.castaryn.ru"
$env:CASTARYN_CREATOR_OIDC_AUTHORITY = "https://control.castaryn.ru/auth/realms/castaryn"
$env:CASTARYN_CREATOR_OIDC_CLIENT_ID = "castaryn-desktop"
$env:CASTARYN_CREATOR_OIDC_AUDIENCE = "castaryn-creator-api"

if ($thumbprint -notmatch "^[A-F0-9]{40,64}$") {
    throw "CASTARYN_WINDOWS_CERTIFICATE_THUMBPRINT is required for a release build."
}
if (-not [Uri]::TryCreate($timestampUrl, [UriKind]::Absolute, [ref]$timestampUri) -or $timestampUri.Scheme -ne "https") {
    throw "CASTARYN_WINDOWS_TIMESTAMP_URL must be an HTTPS timestamp service."
}

$certificate = Get-ChildItem -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
if (-not $certificate) {
    throw "The configured code-signing certificate is not installed."
}
if ($certificate.NotAfter -le (Get-Date).AddDays(1)) {
    throw "The configured code-signing certificate is expired or expires within 24 hours."
}
$codeSigningOid = "1.3.6.1.5.5.7.3.3"
if (-not ($certificate.EnhancedKeyUsageList.ObjectId.Value -contains $codeSigningOid)) {
    throw "The configured certificate is not valid for code signing."
}

$temporaryConfig = Join-Path ([System.IO.Path]::GetTempPath()) "castaryn-release-$([Guid]::NewGuid().ToString('N')).json"
try {
    @{
        bundle = @{
            windows = @{
                certificateThumbprint = $thumbprint
                digestAlgorithm = "sha256"
                timestampUrl = $timestampUrl
            }
        }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryConfig -Encoding utf8

    & "$PSScriptRoot/security-check.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Security check failed." }
    pnpm check
    if ($LASTEXITCODE -ne 0) { throw "Quality checks failed." }
    cargo test --locked --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw "Rust tests failed." }
    pnpm tauri build --bundles nsis --config $temporaryConfig
    if ($LASTEXITCODE -ne 0) { throw "Signed Windows build failed." }
}
finally {
    Remove-Item -LiteralPath $temporaryConfig -Force -ErrorAction SilentlyContinue
}
