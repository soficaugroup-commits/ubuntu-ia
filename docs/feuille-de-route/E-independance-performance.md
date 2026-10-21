# Lot E — Le rendre indépendant et performant

> Indépendant ne veut pas dire « coupé du monde » : le groupe ne doit être à la merci ni d'un seul fournisseur,
> ni d'une facture imprévisible, ni d'une panne extérieure.
> La performance se juge ainsi : une demande courante aboutit vite, une demande lourde aboutit juste, et le coût reste prévisible.

Fichiers existants : `lib/server/env.ts` (`chatModel`, `fileModel`, `imageModel`, `visionModel`, `titleModel`, `*Candidates`,
`resolveLlmEndpoint` — attention, modifications locales non commitées : changements **additifs** uniquement),
`deep-research.ts` (`postChatCompletion`, `streamChatCompletion`, repli si modèle manquant), `quotas.ts`, `usage_journalier`,
`render.yaml`, `instrumentation.ts`.

## E1 — Plusieurs intelligences, routage selon la tâche

- `lib/server/model-router.ts` : registre déclaratif des modèles par **rôle** :
  `rapide` (question simple, titres, classification), `fort` (dossier, plan, rédaction longue, juge), `documents` (= `FILE_MODEL`),
  `vision`, `image`, `calcul/code`, `embedding` (figé). Chaque rôle = liste ordonnée de candidats **chez au moins deux fournisseurs
  différents** (ex. DeepSeek / Anthropic / OpenAI / Google via OpenRouter) + paramètres (max tokens, température, raisonnement).
- `routeModel({ tache, mode, effort, longueur, piecesJointes, organisation })` → rôle + modèle. Remplace les choix de modèle
  dispersés (agent-tools, answer-question, conversation-title, generate-*) par des appels au routeur.
- **Bascule automatique** : erreur 5xx/429/timeout/modèle indisponible → candidat suivant (circuit breaker en mémoire : un modèle en
  échec est écarté 5 min). Journaliser chaque bascule.
- Surcharge possible par variables d'env (`MODEL_RAPIDE`, `MODEL_FORT`, …) et par organisation (colonne `organisations.modeles jsonb`).
- Préparer un fournisseur **auto-hébergé compatible OpenAI** (`LOCAL_LLM_BASE_URL`, `LOCAL_LLM_API_KEY`) dans `resolveLlmEndpoint`
  pour le long terme (aucun modèle à entraîner dans ce lot).

## E2 — Connaître et piloter le coût

- Migration `021_couts_supervision.sql` :
  - `public.appels_modele` : `user_id`, `organisation_id`, `tache_id` null, `conversation_id` null, `role`, `modele`, `fournisseur`,
    `tokens_entree`, `tokens_sortie`, `cout_usd numeric(12,6)`, `latence_ms`, `statut`, `created_at`.
  - `organisations` : `budget_mensuel_usd numeric`, `seuil_alerte_pct int default 80`, `plafond_par_utilisateur_jour_usd numeric null`,
    `blocage_si_depassement boolean default false`.
- Capture : demander `usage: { include: true }` à OpenRouter et lire `usage.cost` / tokens dans **chaque** réponse
  (y compris en streaming : dernier chunk) — centraliser dans `deep-research.ts` via un hook `onUsage`. Embeddings et images compris.
- `quotas.ts` : en plus du quota de messages, contrôle budgétaire par organisation et par utilisateur (avant appel : estimation ;
  après : enregistrement). Au seuil d'alerte → e-mail aux admins (Resend) ; au dépassement → bascule vers le rôle `rapide`
  ou blocage selon `blocage_si_depassement`.
- Admin, onglet **« Coûts »** : dépense du mois par entité, par utilisateur, par rôle de modèle, par type de tâche ; projection fin de mois ;
  réglage des plafonds **visible et ajustable par entité**.

## E3 — Temps de réponse

- Objectifs : premier jeton < 3 s pour une question courante ; tâches lourdes en arrière-plan (lot B) avec **attente claire** :
  étape en cours, estimation (« environ 2 min »), possibilité de quitter et d'être prévenu.
- Mesurer `latence_ms` (premier jeton et total) dans `appels_modele`.
- Optimisations : chemin rapide sans tour d'outils pour les questions simples (`agent-plan.ts`), embeddings de requête mis en cache
  (LRU en mémoire, clé = texte normalisé), recherche vectorielle limitée à l'organisation (`match_document_chunks_scoped`),
  appels indépendants en parallèle (RAG + web), titres et mémoire hors du chemin critique (déjà le cas, conserver).

## E4 — Surveillance simple

- `GET /api/sante` (public, sans données sensibles) : base Supabase joignable, fournisseur LLM joignable (ping léger mis en cache 60 s),
  worker office (dernier battement < 2 min — ajouter une table `battements_services` mise à jour par le worker). Configurer
  `healthCheckPath: /api/sante` dans `render.yaml`.
- Table `evenements_service` (`type` : indexation_echec, modele_bascule, tache_abandonnee, quota_atteint, erreur_api ; `details`, `created_at`).
- Indicateurs admin, onglet **« Supervision »** : le service répond-il ; taux d'échec d'indexation (24 h / 7 j) ; documents bloqués
  en `en_cours` ; **taux d'abandon des tâches** (tâches restées `en_attente_utilisateur` > 72 h ou annulées) ; bascules de modèles.
- Alertes e-mail aux admins sur : indexation en échec répétée, service LLM indisponible > 5 min, budget au seuil.

## E5 — Hébergement et données maîtrisés

- Rédige `docs/gouvernance-donnees.md` : qui stocke quoi (Supabase région, Storage buckets, Render Frankfurt, fournisseurs LLM
  via OpenRouter), où, combien de temps, comment on retire.
- Table `politiques_retention` par organisation : durée de conservation des conversations, fichiers générés, journaux techniques
  (le `journal_audit` a une durée distincte, plus longue). Tâche planifiée de purge (job dans le worker Python, quotidien).
- OpenRouter : activer les paramètres de confidentialité de requête (`provider: { data_collection: "deny" }`) et restreindre
  aux fournisseurs qui n'entraînent pas sur les données ; documenter.
- Droit au retrait : admin peut supprimer un document (déjà fait, chunks compris), un utilisateur peut exporter puis supprimer
  ses conversations et sa mémoire ; vérifier que la suppression couvre Storage + tables.

## E6 — Long terme (documenter seulement)

Dans `docs/feuille-de-route/E-long-terme.md`, une note de 1 page : quand envisager une intelligence propre au groupe
(petit modèle auto-hébergé ou affiné sur les tâches répétitives internes : classification, extraction, titres, résumés),
prérequis (volume de cas d'épreuve du lot D, budget, hébergement), et comment le routeur E1 l'intégrera sans changer le reste.
**Aucune implémentation d'entraînement dans ce lot.**

## Tests

- Routeur : choix du rôle selon les entrées ; bascule sur erreur ; circuit breaker.
- Coûts : agrégation mensuelle ; seuil d'alerte ; comportement au dépassement.
- `/api/sante` : renvoie un état dégradé quand une dépendance est simulée en panne.

## Critères d'acceptation du lot E

- [ ] Coupure simulée du modèle principal : le service continue sur un autre fournisseur, la bascule est visible en supervision.
- [ ] Chaque appel a un coût enregistré ; l'admin voit et ajuste le plafond mensuel par entité.
- [ ] Question courante : premier jeton < 3 s (mesuré) ; tâche lourde : attente annoncée et suivie.
- [ ] `docs/gouvernance-donnees.md` répond à : qui stocke, où, combien de temps, comment on retire.
