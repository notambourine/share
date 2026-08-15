#!/usr/bin/env bash
# Mint (or rotate) one share.notambourine.com bearer token, as the 1Password admin.
# Safe to commit: generates secrets, contains none. Run in a plain terminal,
# never inside an agent session — the raw token prints to stdout.
#
#   scripts/add-employee.sh <name>                        generate + print only
#   scripts/add-employee.sh <name> --vault share          upsert op://share/share-token-<name>,
#                                                         reprint the full TOKENS map
#   ... --email <addr>                                    also mint a view-once delivery link
#   ... --email <addr> --own-vault                        instead deliver via a per-employee
#                                                         vault emp-<name> (created + granted)
#
# The vault is the source of truth; the TOKENS Worker secret is derived from it.
# Cloudflare secrets are write-only, so every change re-pastes the whole map.
# Offboarding: op item delete "share-token-<name>" --vault share, re-run any
# name with --vault to reprint the map, paste it — their token dies instantly.
set -euo pipefail

NAME="${1:?usage: add-employee.sh <name> [--vault <v>] [--email <addr>] [--own-vault]}"
shift
[[ "$NAME" =~ ^[a-z0-9-]+$ ]] || { echo "name must be a lowercase slug" >&2; exit 1; }

VAULT="" EMAIL="" OWN_VAULT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT="${2:?}"; shift 2 ;;
    --email) EMAIL="${2:?}"; shift 2 ;;
    --own-vault) OWN_VAULT=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
[[ -n "$OWN_VAULT" && -z "$EMAIL" ]] && { echo "--own-vault needs --email" >&2; exit 1; }
[[ -n "$EMAIL" && -z "$VAULT" ]] && { echo "--email needs --vault" >&2; exit 1; }

# 32 random bytes = 256 bits of entropy; base64 is only a copy-paste-safe wrapper.
TOK="$(openssl rand -base64 32 | tr -d '\n')"
HASH="$(printf '%s' "$TOK" | shasum -a 256 | cut -d' ' -f1)"

echo "token  : ${TOK}"
echo "sha256 : ${HASH}"
echo

if [[ -z "$VAULT" ]]; then
  cat <<EOF
Manual next steps:
1. Store the token in 1Password yourself (title: share-token-${NAME}).
2. Dashboard -> Workers -> share -> Settings -> Variables and Secrets ->
   edit TOKENS and re-paste the FULL map with this entry added:
     "${NAME}":"${HASH}"
3. Deliver the raw token with a view-once link:
     op item share "share-token-${NAME}" --vault <v> --expires-in 3d --view-once
EOF
  exit 0
fi

NOTES="Bearer for share.notambourine.com uploads. Load via op run --env-file; never paste into chat or a query string. Rotate: re-run scripts/add-employee.sh ${NAME} --vault ${VAULT} and re-paste TOKENS."
TITLE="share-token-${NAME}"
if op item get "$TITLE" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$TITLE" --vault "$VAULT" "credential=${TOK}" >/dev/null
  echo "rotated: op://${VAULT}/${TITLE}/credential"
else
  op item create --vault "$VAULT" --category "API Credential" --title "$TITLE" \
    "credential=${TOK}" "notes=${NOTES}" >/dev/null
  echo "created: op://${VAULT}/${TITLE}/credential"
fi

if [[ -n "$OWN_VAULT" ]]; then
  EMP_VAULT="emp-${NAME}"
  op vault get "$EMP_VAULT" >/dev/null 2>&1 || op vault create "$EMP_VAULT" >/dev/null
  op vault user grant --vault "$EMP_VAULT" --user "$EMAIL" \
    --permissions view_items,view_and_copy_passwords >/dev/null
  if op item get "$TITLE" --vault "$EMP_VAULT" >/dev/null 2>&1; then
    op item edit "$TITLE" --vault "$EMP_VAULT" "credential=${TOK}" >/dev/null
  else
    op item create --vault "$EMP_VAULT" --category "API Credential" --title "$TITLE" \
      "credential=${TOK}" "notes=${NOTES}" >/dev/null
  fi
  echo "granted: ${EMAIL} can view op://${EMP_VAULT}/${TITLE}/credential"
elif [[ -n "$EMAIL" ]]; then
  echo "view-once link for ${EMAIL}:"
  op item share "$TITLE" --vault "$VAULT" --emails "$EMAIL" --expires-in 3d --view-once
fi

echo
echo "TOKENS — re-paste the whole value into the Worker secret:"
JSON="{"
while IFS= read -r T; do
  N="${T#share-token-}"
  C="$(op item get "$T" --vault "$VAULT" --fields credential --reveal)"
  JSON+="\"${N}\":\"$(printf '%s' "$C" | shasum -a 256 | cut -d' ' -f1)\","
done < <(op item list --vault "$VAULT" --format json \
  | jq -r '.[].title | select(startswith("share-token-"))' | sort)
echo "${JSON%,}}"

echo
echo "Their env file (~/.config/share/env):"
if [[ -n "$OWN_VAULT" ]]; then
  echo "  SHARE_TOKEN=op://emp-${NAME}/${TITLE}/credential"
else
  echo "  SHARE_TOKEN=<paste from the view-once link into their own vault, then reference it>"
fi
