#!/usr/bin/env sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
workflow="$root/.github/workflows/android.yml"
fastfile="$root/fastlane/Fastfile"
guide="$root/android/PLAY-PUBLISHING.md"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT HUP INT TERM

fail() {
  printf '%s\n' "Play publishing policy check failed: $*" >&2
  exit 1
}

require_text() {
  file="$1"
  value="$2"
  grep -F -- "$value" "$file" >/dev/null || fail "$file is missing: $value"
}

awk '
  /^  signed-play-release:/ { inside = 1; print; next }
  inside && /^  [[:alnum:]_-]+:[[:space:]]*$/ { exit }
  inside { print }
' "$workflow" > "$scratch/signed-job"

awk '
  /^  publish-play-internal:/ { inside = 1; print; next }
  inside && /^  [[:alnum:]_-]+:[[:space:]]*$/ { exit }
  inside { print }
' "$workflow" > "$scratch/publish-job"

awk '
  /^  signed-play-release:/ { inside = 1; next }
  inside && /^  [[:alnum:]_-]+:[[:space:]]*$/ { inside = 0 }
  !inside { print }
' "$workflow" > "$scratch/outside-signed-job"

test -s "$scratch/signed-job" || fail "signed-play-release job was not found"
test -s "$scratch/publish-job" || fail "publish-play-internal job was not found"

default_branch_guard="github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"
for job in "$scratch/signed-job" "$scratch/publish-job"; do
  require_text "$job" "github.event_name == 'workflow_dispatch'"
  require_text "$job" "$default_branch_guard"
  require_text "$job" "environment: play-internal"
done

for name in RTB_KEYSTORE_BASE64 RTB_KEYSTORE_PASSWORD RTB_KEY_ALIAS RTB_KEY_PASSWORD; do
  require_text "$scratch/signed-job" "secrets.$name"
  if grep -F -- "secrets.$name" "$scratch/outside-signed-job" >/dev/null; then
    fail "$name must not be referenced outside the protected signing job"
  fi
done

sed -n '1,/^    steps:/p' "$scratch/signed-job" > "$scratch/signed-job-header"
if grep -F -- 'secrets.' "$scratch/signed-job-header" >/dev/null; then
  fail "signing secrets must be step-scoped, not job-scoped"
fi
if grep -F -- 'secrets.' "$scratch/outside-signed-job" >/dev/null; then
  fail "no secret may be referenced outside the protected signing job"
fi
if grep -F -- 'bundlePlayStoreRelease' "$scratch/outside-signed-job" >/dev/null; then
  fail "the release bundle task must run only in the protected signing job"
fi
require_text "$scratch/signed-job" "trap 'rm -f \"\$upload_key\"' EXIT HUP INT TERM"
require_text "$scratch/signed-job" "./gradlew --no-daemon bundlePlayStoreRelease"
if grep -F -- 'GITHUB_ENV' "$scratch/signed-job" >/dev/null; then
  fail "signing paths or values must not persist through GITHUB_ENV"
fi

if grep -E '^[[:space:]]*-[[:space:]]+uses:' "$workflow" |
    grep -Ev '@[0-9a-f]{40}([[:space:]]+#.*)?$' >/dev/null; then
  fail "GitHub Actions must be pinned to full commit SHAs"
fi

ruby_line="$(grep -n -F 'ruby/setup-ruby@' "$scratch/publish-job" | cut -d: -f1)"
auth_line="$(grep -n -F 'google-github-actions/auth@' "$scratch/publish-job" | cut -d: -f1)"
test -n "$ruby_line" && test -n "$auth_line" || fail "publisher setup/auth actions were not found"
test "$ruby_line" -lt "$auth_line" || fail "Ruby and gems must be set up before Google credentials are exported"

require_text "$fastfile" 'track: "internal"'
require_text "$fastfile" "skip_upload_metadata: true"
if grep -F -- 'track: "production"' "$fastfile" >/dev/null; then
  fail "Fastfile must not expose a production track"
fi
upload_calls="$(grep -F 'upload_to_play_store(' "$fastfile" | wc -l | tr -d ' ')"
test "$upload_calls" = "1" || fail "Fastfile must contain exactly one reviewed Play upload action"
track_lines="$(grep -E '^[[:space:]]+track:' "$fastfile" | wc -l | tr -d ' ')"
test "$track_lines" = "1" || fail "Fastfile must contain exactly one reviewed Play track"

require_text "$guide" "delete identically named repository secrets"
require_text "$guide" "Prevent self-review"
require_text "$guide" "default_branch"

printf '%s\n' "Play publishing policy checks passed."
