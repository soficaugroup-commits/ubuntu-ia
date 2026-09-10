# Déploiement Render — Ubuntu IA

Guide pour héberger **toute** la plateforme sur Render (sans Netlify) :
Web Next.js + Worker Python/LibreOffice. Supabase reste externe.

## 1. Préparer Supabase

1. Exécuter `backend/db/013_office_jobs.sql` (SQL Editor).
2. Créer un bucket Storage privé `office-jobs` (Dashboard → Storage).
3. Politique d’accès : réservé à `service_role` (le worker et l’API Next l’utilisent).

## 2. Déployer via Blueprint

1. Pousser ce dépôt sur GitHub.
2. Render → **New** → **Blueprint**.
3. Sélectionner le repo : Render lit `render.yaml`.
4. Deux services apparaissent :
   - `ubuntu-ia-web` (Node, `frontend/`)
   - `ubuntu-ia-office` (Docker worker)

## 3. Variables d’environnement

Renseigner les valeurs `sync: false` dans le dashboard (même secrets pour web + worker quand c’est pertinent).

### Web (`ubuntu-ia-web`)

| Variable | Exemple |
|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://ubuntu-ia.onrender.com` puis `https://ubuntu-ia.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | URL projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon |
| `SUPABASE_URL` | idem |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role |
| `OPENROUTER_API_KEY` | `sk-or-v1-…` |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | e-mails |
| `FILE_MODEL` | `anthropic/claude-opus-5` (déjà dans le blueprint) |
| `OFFICE_WORKER_SECRET` | chaîne aléatoire longue (optionnel pour plus tard) |

### Worker (`ubuntu-ia-office`)

| Variable | Notes |
|---|---|
| `SUPABASE_URL` | même que le web |
| `SUPABASE_SERVICE_ROLE_KEY` | même que le web |
| `OFFICE_STORAGE_BUCKET` | `office-jobs` (défaut) |
| `OFFICE_POLL_SECONDS` | `5` |
| `OFFICE_JOB_TIMEOUT_SECONDS` | `300` |

## 4. Commandes (référence)

### Web (déjà dans `render.yaml`)

```text
rootDir: frontend
build: npm ci && npm run build
start: npm run start
```

### Worker (Docker)

```text
Dockerfile: backend/office_worker/Dockerfile
context: racine du repo
cmd: python -m office_worker.worker
```

Test local du worker :

```bash
# depuis la racine du repo, avec .env rempli
docker build -f backend/office_worker/Dockerfile -t ubuntu-ia-office .
docker run --env-file .env ubuntu-ia-office
```

## 5. Domaine

1. Render → `ubuntu-ia-web` → Custom Domain → `ubuntu-ia.com`
2. Mettre à jour les DNS (CNAME / ALIAS) chez le registrar
3. Mettre `NEXT_PUBLIC_APP_URL=https://ubuntu-ia.com`
4. Mettre à jour Resend / OpenRouter referer si besoin
5. Une fois stable : retirer le site Netlify

## 6. Jobs supportés (MVP worker)

| `kind` | Statut |
|---|---|
| `validate_ooxml` | prêt |
| `pptx_thumbnails` | prêt |
| `xlsx_recalc` | prêt |
| `pptx_from_template` | à brancher |
| `pdf_fill_form` | à brancher |

Insérer un job (service_role) :

```sql
insert into public.office_jobs (user_id, kind, input_path, payload)
values (
  '<uuid utilisateur>',
  'pptx_thumbnails',
  '<user_id>/<job_id>/input.pptx',
  '{}'::jsonb
);
```

Le fichier d’entrée doit déjà être dans le bucket `office-jobs`.

## 7. Suite produit

- API Next `POST /api/office/jobs` + polling UI (prochaine étape code)
- Brancher le worker après génération TS pour QA / templates
- Abandonner Netlify quand le Web Service Render est validé en prod

## Coût / plans

Prévoir un plan **payant** (Starter+) pour web et worker : les instances free s’endorment et LibreOffice a besoin de RAM (recommandé ≥ 1–2 Go pour le worker).
