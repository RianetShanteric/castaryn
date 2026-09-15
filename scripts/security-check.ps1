$ErrorActionPreference = "Stop"

$forbiddenPathPattern = '(^|/)(work|secrets|backups)/|(^|/)\.env|\.sqlite3?$|\.db$|\.(elyvo|castaryn)$|\.pem$|\.key$|\.p12$|\.pfx$|\.cer$|\.crt$|setup\.exe$|\.msi$'
$trackedFiles = @(git ls-files)
$forbiddenPaths = @(
    $trackedFiles | Where-Object {
        $_ -match $forbiddenPathPattern -and $_ -notmatch '(^|/)\.env\.example$'
    }
)

if ($forbiddenPaths.Count -gt 0) {
    Write-Error "Forbidden files are tracked: $($forbiddenPaths -join ', ')"
}

# This is a fast, low-false-positive sanity check on the current working
# tree only -- it intentionally does not try to match every possible secret
# shape (e.g. bare JWTs or DB connection strings), since those are too
# generic to match reliably without flagging legitimate fixtures/examples.
# Full git-history scanning is handled separately by gitleaks in CI, which
# can look at every past commit, not just what's checked out right now.
$forbiddenContentPattern = 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|sk_(live|test)_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}'
$contentMatches = @(git grep -l -I -E $forbiddenContentPattern -- . ':!scripts/security-check.ps1' 2>$null)

if ($contentMatches.Count -gt 0) {
    Write-Error "Internal or sensitive content is tracked in: $($contentMatches -join ', ')"
}

$privateFiles = @(
    "work/private/MVP_SPEC.md",
    "work/private/CREATOR_ARCHITECTURE.md",
    "work/private/PUBLISH_CHECKLIST.md"
)

foreach ($privateFile in $privateFiles) {
    git check-ignore -q -- $privateFile
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Private file is not ignored: $privateFile"
    }
}

pnpm audit --audit-level high
if ($LASTEXITCODE -ne 0) {
    Write-Error "Dependency audit failed."
}

pnpm audit signatures
if ($LASTEXITCODE -ne 0) {
    Write-Error "Package signature verification failed."
}

Write-Output "Security check passed."
