#!/usr/bin/env bash
# Mint (or rotate) one share.notambourine.com bearer token, as the 1Password admin.
# Safe to commit: generates secrets, contains none. Run in a plain terminal,
# never inside an agent session: nothing here prints a raw token, but it writes
# credentials and the --self copy reveals one into a second vault.
#
#   scripts/add-employee.sh <name> --vault share-admin --email <addr>
#                          upsert the canonical copy, mint a view-once delivery
#                          link, reprint the full TOKENS map
#   scripts/add-employee.sh <name> --vault share-admin --self
#                          same, for your own token: no link, you copy it
#                          vault-to-vault
#   scripts/add-employee.sh --map --vault share-admin
#                          print the TOKENS map, mint nothing
#
# Every mint names a delivery route. A token minted with neither flag is
# unreachable: it sits unshared in the admin-only vault, and the vault-to-vault
# copy only runs for someone who can read that vault, which is you.
#
# Lifecycle (the vault is the source of truth; TOKENS is derived from it, so
# the Worker secret staying write-only costs nothing; never read it, rebuild it):
#   onboard   run with --vault + --email; paste the reprinted TOKENS into the
#             Worker secret; recipient saves the token into their built-in
#             Employee vault, item title "share-token", field "credential",
#             so op://Employee/share-token/credential resolves for everyone.
#   rotate    re-run the same name (the item is edited in place), re-paste
#             TOKENS: the old token dies at that moment; send a fresh link.
#             Unchanged people keep their tokens: sha256 is deterministic.
#   offboard  op item delete "share-token-<name>" --vault share-admin, then
#             --map to reprint, paste it. Nobody else rotates.
#
# --vault names an ADMIN-ONLY vault (create once: op vault create share-admin).
# Never a team-shared vault: anyone who can read a vault can use every token
# in it, which breaks per-uploader attribution and offboarding.
set -euo pipefail

NAME="" VAULT="" EMAIL="" MAP_ONLY="" SELF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --map) MAP_ONLY=1; shift ;;
    --self) SELF=1; shift ;;
    --vault) VAULT="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --*) echo "unknown flag: $1" >&2; exit 1 ;;
    *) NAME="$1"; shift ;;
  esac
done

print_map() {
  echo "TOKENS: re-paste the whole value into the Worker secret:"
  local JSON="{" T N C
  while IFS= read -r T; do
    N="${T#share-token-}"
    C="$(op item get "$T" --vault "$VAULT" --fields credential --reveal)"
    JSON+="\"${N}\":\"$(printf '%s' "$C" | shasum -a 256 | cut -d' ' -f1)\","
  done < <(op item list --vault "$VAULT" --format json \
    | jq -r '.[].title | select(startswith("share-token-"))' | sort)
  echo "${JSON%,}}"
}

if [[ -n "$MAP_ONLY" ]]; then
  [[ -n "$VAULT" ]] || { echo "--map needs --vault" >&2; exit 1; }
  print_map
  exit 0
fi

USAGE="usage: add-employee.sh <name> --vault <v> --email <addr>|--self | --map --vault <v>"
[[ -n "$NAME" ]] || { echo "$USAGE" >&2; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "name must be a lowercase slug" >&2; exit 1; }
[[ -n "$VAULT" ]] || { echo "a mint needs --vault <admin-vault>" >&2; exit 1; }
[[ -n "$EMAIL" || -n "$SELF" ]] || { echo "a mint needs --email <addr> or --self" >&2; exit 1; }
[[ -n "$EMAIL" && -n "$SELF" ]] && { echo "--email and --self are exclusive" >&2; exit 1; }

# 32 random bytes = 256 bits of entropy; base64 is only a copy-paste-safe wrapper.
TOK="$(openssl rand -base64 32 | tr -d '\n')"
HASH="$(printf '%s' "$TOK" | shasum -a 256 | cut -d' ' -f1)"

NOTES="Bearer for share.notambourine.com uploads. Recipient saves this into their Employee vault as item 'share-token', field 'credential', then runs commands as: SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c '<command>'. Never paste into chat or a query string."
TITLE="share-token-${NAME}"
if op item get "$TITLE" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$TITLE" --vault "$VAULT" "credential=${TOK}" >/dev/null
  echo "rotated: op://${VAULT}/${TITLE}/credential"
else
  op item create --vault "$VAULT" --category "API Credential" --title "$TITLE" \
    "credential=${TOK}" "notes=${NOTES}" >/dev/null
  echo "created: op://${VAULT}/${TITLE}/credential"
fi

if [[ -n "$EMAIL" ]]; then
  echo "view-once link for ${EMAIL}:"
  op item share "$TITLE" --vault "$VAULT" --emails "$EMAIL" --expires-in 3d --view-once
fi

echo
print_map

echo
echo "──────────────────────────────────────────────────────────────"
if [[ -n "$EMAIL" ]]; then
  cat <<EOF
Send ${NAME} the view-once link above plus this block:

  # Save the token from the one-time link into your Employee vault
  # (replace PASTE-TOKEN-HERE; the link shows it exactly once):
  op item create --vault Employee --category "API Credential" \\
    --title share-token 'credential=PASTE-TOKEN-HERE'
EOF
else
  cat <<EOF
Your own token, so no link was minted. Copy it vault-to-vault without ever
displaying it (upsert: delete any old share-token item in Employee first,
or edit it instead of create):

  op item create --vault Employee --category "API Credential" \\
    --title share-token \\
    "credential=\$(op item get "${TITLE}" --vault "${VAULT}" --fields credential --reveal)"
EOF
fi

# The comparator, not `op read >/dev/null`: presence proves a value exists, and
# the failure this catches is a stale or half-pasted one that still reads fine.
cat <<EOF

  # Verify the saved copy is the token TOKENS now expects. op read emits a
  # trailing newline and the map hashes the bare value, so strip it first:
  [ "\$(op read op://Employee/share-token/credential | tr -d '\\n' \\
      | shasum -a 256 | cut -d' ' -f1)" = "${HASH}" ] \\
    && echo ready || echo "MISMATCH: saved copy is not this token"

  # Then use it: no env file, and the secret exists only inside the wrapped
  # command that op run resolves the reference for.
  SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c \\
    'curl -sS -H "Authorization: Bearer \$SHARE_TOKEN" -F f=@<file> https://share.notambourine.com/up/<space>'
──────────────────────────────────────────────────────────────
EOF
