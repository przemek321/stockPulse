#!/usr/bin/env bash
# Ochrona gałęzi main na GitHubie: wymagaj zielonych jobów CI (backend + frontend) przed merge/push.
# Decyzja usera 27.09.2026 („5 włącz"). Wymaga tokena z uprawnieniem `repo` (fine-grained: Administration:write):
#   GITHUB_TOKEN=ghp_... scripts/github-branch-protection.sh
# Bez tokena skrypt tylko pokazuje aktualny stan (publiczne API).
set -u
REPO="przemek321/stockPulse"; BRANCH="main"
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "Brak GITHUB_TOKEN — stan obecny (odczyt publiczny):"
  curl -s -m 20 "https://api.github.com/repos/$REPO/branches/$BRANCH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  protected:', d.get('protected'))"
  exit 0
fi
curl -s -m 30 -X PUT "https://api.github.com/repos/$REPO/branches/$BRANCH/protection" \
  -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" \
  -d '{
    "required_status_checks": { "strict": false, "contexts": ["backend", "frontend"] },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK: required checks =', [c for c in d.get('required_status_checks',{}).get('contexts',[])]) if 'required_status_checks' in d else print('BŁĄD:', d.get('message'))"
