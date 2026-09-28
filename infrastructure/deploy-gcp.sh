#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
gcloud run deploy noware \
  --source=. \
  --region=us-central1 \
  --project=noware-hardware \
  --account=winston@noso.so \
  --service-account=noware-runtime@noware-hardware.iam.gserviceaccount.com \
  --build-service-account=projects/noware-hardware/serviceAccounts/noware-build@noware-hardware.iam.gserviceaccount.com \
  --update-env-vars=APP_ORIGIN=https://noware.so,ADDITIONAL_AUTH_ORIGINS=https://noware-1010426969452.us-central1.run.app,GOOGLE_CLIENT_ID=1010426969452-fshg4587ckka7sms7i9lfgrf8kvnh5qv.apps.googleusercontent.com \
  --update-secrets=SESSION_SECRET=noware-session:1 \
  --min-instances=0 --max-instances=1 \
  --memory=256Mi --cpu=1 --concurrency=40 --timeout=60 \
  --allow-unauthenticated --quiet
