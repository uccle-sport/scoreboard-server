# GCP setup for the Docker publish workflow

One-time setup so `.github/workflows/docker-publish.yml` can push to Google Artifact
Registry via keyless [Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation).
Run these `gcloud` commands once (you need Owner/IAM-admin on the project).

## 0. Authenticate as the right account

`gcloud` may currently be logged in as a user from another organisation. Switch to
an account that has IAM-admin rights on the `uccle-sport` project before running
anything below.

```bash
# See which account is active.
gcloud auth list

# Log in with the correct account (opens a browser; pick the uccle-sport user).
gcloud auth login

# Or, if that account is already known to gcloud, just switch to it:
gcloud config set account YOUR_EMAIL@example.com
```

> In this session, type `! gcloud auth login` so the browser flow runs in your
> terminal and its output lands directly in the conversation.

## Variables

```bash
export PROJECT_ID="uccle-sport"
export REGION="europe-west1"
export AR_REPO="docker"                       # Artifact Registry repository name
export GITHUB_REPO="uccle-sport/scoreboard-server"

export POOL_ID="github"
export PROVIDER_ID="github"
export SA_NAME="github-actions"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
```

## 1. Artifact Registry repository (skip if it already exists)

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Docker images"
```

## 2. Service account for CI

A freshly created service account takes a few seconds to propagate. If the
`add-iam-policy-binding` below fails with `Service account ... does not exist`,
wait a moment and re-run it — the account is fine, IAM just hadn't caught up yet.

```bash
gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GitHub Actions (Docker publish)"

# Wait for the account to propagate before referencing it in a policy binding.
sleep 10

# Allow it to push images to the registry.
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" \
  --location="$REGION" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# Verify it exists before continuing (step 4 fails with "Unknown service account"
# if this returns nothing).
gcloud iam service-accounts describe "$SA_EMAIL"
```

## 3. Workload Identity pool + GitHub OIDC provider

```bash
gcloud iam workload-identity-pools create "$POOL_ID" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub OIDC" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository_owner == 'uccle-sport'"
```

> The `attribute-condition` restricts which repos may use this provider. It is
> required by gcloud and prevents other orgs' tokens from being accepted.

## 4. Let the GitHub repo impersonate the service account

```bash
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --project="$PROJECT_ID" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/attribute.repository/${GITHUB_REPO}"
```

> **`ERROR: ... NOT_FOUND: Unknown service account`?** gcloud is looking for
> `$SA_EMAIL` in the wrong place or it doesn't exist yet. Check, in order:
>
> ```bash
> echo "SA=$SA_EMAIL  PROJECT=$PROJECT_ID  NUMBER=$PROJECT_NUMBER"  # all non-empty?
> ```
>
> - **Empty values** → you opened a new shell; re-run the **Variables** block so
>   the `export`s are set in this shell.
> - **`SA=@uccle-sport...` / wrong project** → re-run the Variables block.
> - **Values look right but still NOT_FOUND** → the account isn't created in this
>   project. Confirm with `gcloud iam service-accounts list --project="$PROJECT_ID"`
>   and re-run **step 2** if it's missing. (Right after creation, allow a few
>   seconds for it to propagate.)
>
> The `--project` flag above pins the lookup to `uccle-sport` regardless of the
> active `core/project`.

## 5. Print the values for the GitHub repository Variables

Add these under **Settings → Secrets and variables → Actions → Variables**:

```bash
echo "GCP_WORKLOAD_IDENTITY_PROVIDER = projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}/providers/${PROVIDER_ID}"
echo "GCP_SERVICE_ACCOUNT            = ${SA_EMAIL}"
```

## Done — cutting a release

`package.json` is the single source of truth for the version. Bump it with a tool
that edits `package.json` **and** creates the matching git tag in one step, so the
two can never drift (the workflow fails the build if a tag doesn't match
`package.json`):

```bash
bun pm version patch   # or: minor / major — edits package.json, commits, tags v0.0.7
git push --follow-tags # pushes the commit and the new tag, triggering the build
```

> `npm version patch` works identically if you prefer npm. Avoid creating release
> tags by hand (`git tag vX.Y.Z`) — that reintroduces the drift this guards against.
