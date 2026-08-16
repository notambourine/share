#!/usr/bin/env bash
# Mint (or rotate) one share.notambourine.com bearer token, as the 1Password admin.
# Safe to commit: generates secrets, contains none. Run in a plain terminal,
# never inside an agent session; the raw token prints to stdout.
#
#   scripts/add-employee.sh <name>                              generate + print only
#   scripts/add-employee.sh <name> --vault share-admin          upsert the canonical copy,
#                                                               reprint the full TOKENS map
#   ... --email <addr>                                          also mint a view-once delivery link
#   scripts/add-employee.sh --map --vault share-admin           print the TOKENS map, mint nothing
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

NAME="" VAULT="" EMAIL="" MAP_ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --map) MAP_ONLY=1; shift ;;
    --vault) VAULT="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --*) echo "unknown flag: $1" >&2; exit 1 ;;
    *) NAME="$1"; shift ;;
  esac
done
[[ -n "$EMAIL" && -z "$VAULT" ]] && { echo "--email needs --vault" >&2; exit 1; }

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

[[ -n "$NAME" ]] || { echo "usage: add-employee.sh <name> [--vault <v>] [--email <addr>] | --map --vault <v>" >&2; exit 1; }
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "name must be a lowercase slug" >&2; exit 1; }

# 32 random bytes = 256 bits of entropy; base64 is only a copy-paste-safe wrapper.
TOK="$(openssl rand -base64 32 | tr -d '\n')"
HASH="$(printf '%s' "$TOK" | shasum -a 256 | cut -d' ' -f1)"

echo "token  : ${TOK}"
echo "sha256 : ${HASH}"
echo

if [[ -z "$VAULT" ]]; then
  cat <<EOF
Manual next steps:
1. Store the token in your admin-only vault (title: share-token-${NAME}).
2. Dashboard -> Workers -> share -> Settings -> Variables and Secrets ->
   edit TOKENS and re-paste the FULL map with this entry added:
     "${NAME}":"${HASH}"
3. Deliver with a view-once link:
     op item share "share-token-${NAME}" --vault <v> --expires-in 3d --view-once
EOF
  exit 0
fi

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
if [[ -n "$EMAIL" ]]; then
  cat <<EOF
──────────────────────────────────────────────────────────────
Send ${NAME} the view-once link above plus this block:

  # 1. Save the token from the one-time link into your Employee vault
  #    (replace PASTE-TOKEN-HERE; the link shows it exactly once):
  op item create --vault Employee --category "API Credential" \\
    --title share-token 'credential=PASTE-TOKEN-HERE'

  # 2. Verify, then use: no env file; op run resolves the reference from
  #    the environment and the secret exists only inside the wrapped command:
  op read op://Employee/share-token/credential >/dev/null && echo ready
  SHARE_TOKEN=op://Employee/share-token/credential op run -- sh -c \\
    'curl -sS -H "Authorization: Bearer \$SHARE_TOKEN" -F f=@<file> https://share.notambourine.com/up/<space>'
──────────────────────────────────────────────────────────────
EOF
else
  cat <<EOF
──────────────────────────────────────────────────────────────
No --email given, so no delivery link was minted. If this token is yours,
copy it vault-to-vault without ever displaying it (upsert: delete any old
share-token item in Employee first, or edit it instead of create):

  op item create --vault Employee --category "API Credential" \\
    --title share-token \\
    "credential=\$(op item get share-token-${NAME} --vault "${VAULT}" --fields credential --reveal)"

Verify: op read op://Employee/share-token/credential >/dev/null && echo ready
To deliver to someone else instead, re-run with --email <addr>
(note: re-running rotates ${NAME}'s token again).
──────────────────────────────────────────────────────────────
EOF
fi
