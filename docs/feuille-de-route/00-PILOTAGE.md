# Ubuntu IA — Feuille de route « agent autonome » : consignes de pilotage pour l'agent Cursor

> Ce dossier est le cahier d'implémentation des **cinq prochains chantiers** d'Ubuntu IA.
> Il complète `cursorrules`, `frontend/AGENTS.md` et `.cursor/rules/ubuntu-ia-design-system.mdc`.
> **Sur la question du périmètre, ce dossier remplace la restriction « hors MVP » de `cursorrules`**
> (e-mail, Teams, rapports) : ces sujets sont désormais au programme, dans les conditions décrites ici.
> Toutes les autres règles de `cursorrules` restent en vigueur (RLS, secrets, charte, sources, etc.).

## Objectif

Passer d'un « bon interlocuteur » à un **chargé de mission** : un agent intelligent, autonome,
indépendant et performant. Ordre imposé :

| Lot | Fichier | Finalité |
|---|---|---|
| A | `A-livrables-fiables.md` | Finir le métier déjà su : documents au niveau livrable interne, modèles du groupe, relecture automatique |
| B | `B-cycle-de-travail.md` | Tâches conduites jusqu'au bout : plan, enchaînement d'actions, questions, reprise, journal |
| C | `C-branchements-metier.md` | Agir dans les systèmes (messagerie, iTrack, calendrier, fichiers) avec autorisation explicite et traces |
| D | `D-intelligence-usage.md` | Mémoire de dossier/équipe, retours → cas d'épreuve, évaluation mesurée, spécialisations, contrôle humain |
| E | `E-independance-performance.md` | Routage multi-modèles, coûts pilotés, supervision, gouvernance des données |

A, B et C rendent l'agent utile au quotidien. D et E le rendent durable pour le groupe.

## État actuel du code (à connaître avant d'écrire une ligne)

- **Front + API** : Next.js 16.3 (App Router) dans `frontend/`. ⚠️ Lire `node_modules/next/dist/docs/` avant
  d'utiliser une API Next (voir `frontend/AGENTS.md`). Toute la logique métier serveur vit dans `frontend/lib/server/*`
  (fichiers marqués `import "server-only"`). Les routes sont dans `frontend/app/api/**/route.ts`.
- **Pipeline de réponse** : `app/api/chat/route.ts` (SSE) → `lib/server/answer-question.ts#streamAnswerQuestion`
  → `agent-plan.ts` (classement heuristique answer/task/hybrid) → `agent-tools.ts#runAgentToolRound`
  (2 tours max, outils `search_documents` et `prepare_deliverable`) → rédaction → `generate-chat-file.ts`
  (docx/pptx/xlsx/pdf/html via `generate-chat-*.ts`, `clone-docx.ts`, `clone-pptx.ts`, `style-transfer.ts`, `design-dna.ts`).
- **LLM** : OpenRouter via `lib/server/env.ts` (`resolveLlmEndpoint`, `chatModel`, `fileModel`, `*Candidates`)
  et `lib/server/deep-research.ts` (`postChatCompletion`, `streamChatCompletion`).
  Embeddings figés : `openai/text-embedding-3-small` (1536 dim) — **ne jamais changer**.
- **Base** : Supabase, migrations SQL numérotées `backend/db/001…014`. Tables clés : `users` (role
  `administrateur|utilisateur`, `organisation_id`), `documents`, `document_chunks`, `conversations`,
  `user_memory`, `feedback`, `office_jobs`, `organisations` (`quota_messages_jour`), `usage_journalier`.
  Fonctions : `public.is_administrateur()`, `match_document_chunks`, `match_document_chunks_scoped`.
- **Worker bureautique** : `backend/office_worker` (Python + LibreOffice, Render), file `office_jobs`
  (`validate_ooxml`, `pptx_thumbnails`, `pptx_from_template`, `xlsx_recalc`, `pdf_fill_form`).
- **Auth / droits** : `lib/server/require-admin.ts` (`requireUser`, `isSessionActor`, contrôle admin).
- **UI** : composants `frontend/components/ui` (neumorphisme, charte SOFICAU `#17405B` / `#AD8859` / Poppins).
  Textes UI centralisés dans `frontend/content/fr.ts`.
- **Déploiement** : Render (`render.yaml`), région Frankfurt.

## Règles d'exécution (non négociables)

1. **Un lot à la fois, dans l'ordre A → E.** Ne commence un lot qu'après avoir fini, testé et commité le précédent.
   À l'intérieur d'un lot, procède par sous-lots (A1, A2…) avec un commit par sous-lot.
2. **Avant chaque lot** : relis le fichier du lot, inspecte les fichiers cités, puis écris en tête de
   `docs/feuille-de-route/JOURNAL.md` un plan court (fichiers touchés, migrations, risques). Ensuite seulement, code.
3. **Migrations SQL** : nouveaux fichiers à partir de `backend/db/015_…sql`, idempotents (`if not exists`,
   `drop policy if exists`), **RLS activée dans la même migration que la table**, `revoke all … from public, anon`,
   `grant all … to service_role`, politiques explicites. Ne modifie jamais une migration existante.
   N'applique pas toi-même les migrations sur la base distante : liste-les dans le JOURNAL pour que l'humain les exécute.
4. **Sécurité** : aucune clé côté client ; tout contrôle de droit est fait côté serveur ; toute action qui
   modifie un système externe passe par le circuit « proposer → valider → exécuter » (lot C) et est journalisée.
5. **Pas de régression** : le chat actuel, l'indexation, la mémoire, les retours, le vocal et la génération
   de fichiers doivent continuer de fonctionner. Garde les signatures publiques existantes ou adapte tous les appelants.
6. **Fichiers non commités de l'utilisateur** : `frontend/lib/server/env.ts`, `invitation-mail.ts`,
   `password-reset-mail.ts` ont des modifications locales en cours. Ne les écrase pas, ne les commite pas
   sans nécessité ; si tu dois toucher `env.ts`, fais une modification additive minimale.
7. **Qualité** : TypeScript strict, pas de `any` nouveau ; fonctions courtes ; erreurs gérées explicitement
   avec messages en français pour l'utilisateur et `console.error("[module] …")` côté serveur.
   Python : type hints + docstrings, tests `pytest`.
8. **Vérifications à la fin de chaque sous-lot** : `cd frontend && npm run lint && npx tsc --noEmit && npm run build` ;
   `pytest` à la racine si du Python a changé ; tests ajoutés pour toute logique pure (voir chaque lot).
   Pour les tests TS, ajoute `vitest` en devDependency si besoin (`npm i -D vitest`) et un script `"test": "vitest run"`.
9. **Commits** : messages en français, à l'impératif, une phrase utile (style du dépôt :
   « Livrer des documents fidèles… »). **Ne pousse pas et ne déploie pas** sans accord explicite de l'utilisateur.
10. **Quand une information manque** (identifiants Azure, API iTrack, budget mensuel…) : ne l'invente pas.
    Code derrière une variable d'environnement ou un drapeau désactivé par défaut, documente la valeur
    attendue dans `.env.example` et dans le JOURNAL, puis continue.
11. **UI** : uniquement les composants de `components/ui`, jamais de `<select>` natif, textes dans `content/fr.ts`,
    responsive mobile, accessibilité (labels, focus visibles, `aria-live` pour les états d'avancement).
12. **Fin de lot** : mets à jour `docs/feuille-de-route/JOURNAL.md` (fait / reste / décisions / migrations à appliquer /
    variables d'env nouvelles) et donne un compte rendu court dans le chat avant de passer au lot suivant.

## Définition de « terminé » pour l'ensemble

- Une demande courante aboutit vite (première réponse < 3 s en streaming), une demande lourde aboutit juste,
  et le coût reste visible et plafonné par entité.
- Aucun document livré sans relecture automatique ; aucune action externe sans validation humaine tracée.
- Une suite d'épreuves internes mesure la progression d'Ubuntu IA à chaque changement.
