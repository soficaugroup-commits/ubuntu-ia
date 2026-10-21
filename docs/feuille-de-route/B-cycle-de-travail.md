# Lot B — Lui donner un vrai cycle de travail

> Un agent autonome ne répond pas une fois : il conduit une tâche jusqu'au bout.
> C'est le passage d'un bon interlocuteur à un chargé de mission.

Fichiers existants à lire : `lib/server/agent-plan.ts` (classement heuristique sans LLM), `agent-tools.ts`
(2 tours d'outils max, 35 s), `answer-question.ts`, `app/api/chat/route.ts` (SSE, `maxDuration = 300`),
`lib/chat-stream-events.ts`, `components/chat/AnswerProgress.tsx`, `ChatWorkspace.tsx`, `conversations.ts`.

## Principe d'architecture (à respecter)

Une **tâche** est un objet persistant en base, exécuté **pas à pas** par une boucle d'agent dont chaque étape est
idempotente et sauvegardée. Une requête HTTP n'exécute qu'un nombre borné d'étapes (budget temps ~240 s) puis rend
la main ; le client (ou une relance) reprend là où la tâche s'est arrêtée. Ainsi une tâche survit aux timeouts Render,
à la fermeture de l'onglet et peut être **reprise le lendemain**.

## B1 — Modèle de données

Migration `backend/db/016_taches_agent.sql` (RLS : propriétaire + admin ; écriture via service_role) :

- `public.taches` : `id`, `user_id`, `organisation_id`, `conversation_id` (set null), `dossier_id uuid null`
  (préparé pour le lot D), `titre`, `objectif text` (but reformulé), `statut text check in
  ('cadrage','plan_propose','en_cours','en_attente_utilisateur','en_attente_validation','terminee','echouee','annulee')`,
  `plan jsonb` (liste d'étapes), `contexte jsonb` (faits établis, décisions, fichiers produits, sources), `etape_courante int`,
  `budget jsonb` (max étapes, max coût, échéance), `created_at`, `updated_at`, `terminee_at`.
- `public.etapes_tache` : `id`, `tache_id` (cascade), `ordre int`, `type text check in
  ('chercher','lire','rediger','verifier','corriger','livrer','demander','agir')`, `description`, `statut text check in
  ('a_faire','en_cours','faite','sautee','echouee','bloquee')`, `entree jsonb`, `sortie jsonb`, `necessite_validation boolean default false`,
  `tentatives int default 0`, `started_at`, `finished_at`, `erreur text`.
- `public.journal_tache` : `id`, `tache_id`, `horodatage`, `type text check in ('fait','reste','decision','question','reponse','erreur','validation')`,
  `contenu text`, `auteur text check in ('agent','utilisateur')`.

Index : `(user_id, updated_at desc)`, `(tache_id, ordre)`.

## B2 — Boucle d'agent `lib/server/agent-loop/`

Découpe en modules courts :

- `understand.ts` — **Comprendre le but** : appel LLM (modèle « fort ») → JSON validé `{ objectif, livrables, contraintes, infos_manquantes[], risques[] }`.
  Si `infos_manquantes` est non vide et bloquant → statut `en_attente_utilisateur` + questions précises (jamais d'invention).
- `planner.ts` — **Découper** : produit un plan de 3 à 12 étapes typées (voir `type` ci-dessus). Toute étape
  ayant des conséquences (envoi, modification d'un système, document officiel) est marquée `necessite_validation`.
- `executor.ts` — exécute une étape via un **registre d'outils** `tools/registry.ts` (interface commune
  `{ name, description, schema (JSON Schema), risk: 'lecture'|'ecriture'|'externe', run(args, ctx) }`) :
  `search_documents`, `web_search`/`web_fetch` (réutiliser `deep-research.ts`), `read_attachment`, `draft_section`,
  `build_deliverable` (lot A), `review_deliverable` (A3), `ask_user`. Les outils du lot C s'ajouteront à ce registre.
- `verifier.ts` — après chaque étape `rediger`/`livrer` : appelle `document-review.ts` (A3) ; si alerte bloquante →
  insère automatiquement une étape `corriger` (max 2 boucles de correction par étape).
- `runner.ts` — `advanceTask(taskId, { budgetMs, signal })` : charge l'état, exécute les étapes suivantes tant que le budget
  le permet, persiste après **chaque** étape, émet des événements, s'arrête sur `necessite_validation`, `demander`,
  erreur répétée (3 tentatives) ou fin. Verrou d'exécution (colonne `verrou_jusqua timestamptz` ou `select … for update skip locked`
  via RPC) pour empêcher deux exécutions simultanées de la même tâche.
- Garde-fous : nombre max d'étapes, coût max (branché sur le lot E), pas d'outil `externe` sans validation.

Remplace progressivement `runAgentToolRound` : les questions simples continuent sur le chemin rapide actuel
(`agent-plan.ts` mode `answer`) ; les modes `task` / `hybrid` multi-étapes basculent sur une tâche.
Ajoute un critère dans `agent-plan.ts` : tâche longue si plusieurs livrables, plusieurs étapes explicites, ou
`MULTI_STEP`, ou demande de l'utilisateur (« prends en charge », « occupe-toi de »).

## B3 — API et flux temps réel

- `POST /api/taches` (créer depuis un message), `GET /api/taches` (liste), `GET /api/taches/[id]` (état + journal),
  `POST /api/taches/[id]/avancer` (SSE : exécute un budget d'étapes et diffuse les événements),
  `POST /api/taches/[id]/plan` (valider / modifier le plan), `POST /api/taches/[id]/repondre` (réponse à une question),
  `POST /api/taches/[id]/valider-etape`, `POST /api/taches/[id]/annuler`.
- Tous : `requireUser`, contrôle propriétaire côté serveur, quotas (`assertMessageQuota`).
- Nouveaux événements dans `lib/chat-stream-events.ts` : `tache_plan`, `tache_etape` (début/fin + résumé),
  `tache_question`, `tache_validation_requise`, `tache_journal`, `tache_fin`.

## B4 — Interface

- Dans le chat, un message de type **carte de tâche** : objectif, plan numéroté avec états, bouton
  « Valider le plan et lancer » / « Modifier », barre d'avancement, questions en attente avec champ de réponse, étapes à valider.
- Panneau latéral **« Mes tâches »** (composant `Sheet`) : en cours, en attente de moi, terminées ; bouton « Reprendre ».
- **Journal simple** visible par tâche : *Fait*, *Reste à faire*, *Décisions* (lecture de `journal_tache`).
- À la reprise (lendemain, autre appareil) : le contexte vient de `taches.contexte` + `journal_tache` + fichiers produits,
  pas seulement du dernier message. Résumé de reprise généré et affiché (« Voici où nous en étions… »).

## B5 — Tests

- Unitaires (vitest) : validation des JSON `understand`/`planner` (schéma strict, rejet des sorties invalides) ;
  `runner` avec outils simulés : s'arrête sur validation, reprend après réponse, respecte le budget, n'exécute pas deux fois une étape faite.
- Scénario de bout en bout documenté dans le JOURNAL : « Prépare une note de synthèse Word sur la procédure d'achat
  à partir des documents internes, puis un PowerPoint de 5 diapos » → plan proposé, validation, recherche, rédaction,
  relecture, livraison de 2 fichiers, journal complet.

## Critères d'acceptation du lot B

- [ ] Une demande multi-étapes produit un plan visible **avant** toute action à conséquence.
- [ ] L'agent enchaîne chercher → lire → rédiger → vérifier → corriger → livrer sans intervention si rien ne manque.
- [ ] S'il manque une information, il s'arrête et pose une question précise ; il ne l'invente pas.
- [ ] Une tâche interrompue (onglet fermé, timeout) se reprend le lendemain avec tout son contexte.
- [ ] Chaque tâche a un journal : fait / reste / décisions.
