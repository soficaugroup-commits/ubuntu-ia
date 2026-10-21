# Lot D — Le rendre plus intelligent au fil de l'usage

> L'intelligence ici n'est pas un slogan : c'est la capacité à mieux réussir les tâches SOFICAU que n'importe quel
> assistant généraliste — et à le **prouver par la mesure**.

Fichiers existants : `lib/server/user-memory.ts` (mémoire personnelle), `feedback.ts`, `app/admin/retours`,
`components/admin/FeedbackWorkspace.tsx`, `lib/server/categories.ts`, `backend/db/006_document_categories.sql`, `010_…`.

## D1 — Mémoire de travail par dossier et par équipe

Migration `019_dossiers_memoire.sql` :
- `public.equipes` (`organisation_id`, `nom`, `domaine` : juridique | exploitation | finance | communication | autre) et
  `public.membres_equipe` (`equipe_id`, `user_id`, `role_equipe`).
- `public.dossiers` (`organisation_id`, `equipe_id` null, `titre`, `description`, `statut`, `cree_par`) et
  `public.membres_dossier` ; relier `taches.dossier_id` et `conversations.dossier_id` (nullable).
- `public.memoire_dossier` (`dossier_id` ou `equipe_id` — exactement un des deux, check), `cle`, `valeur`, `source` (tâche/conversation/manuel),
  `cree_par`, `date_maj`, `expire_at` null.
- RLS : accès limité aux membres du dossier / de l'équipe + admin.

Règles :
- **Distincte des préférences personnelles** : `user_memory` reste personnel ; `memoire_dossier` = faits de travail partagés
  (décisions, interlocuteurs, échéances, chiffres validés). Ne jamais copier des faits personnels dans un dossier.
- **Effaçable** : UI « Mémoire du dossier » (lister, corriger, supprimer un fait, tout effacer) ; suppression d'un dossier = cascade.
- Injection dans le prompt : uniquement la mémoire du dossier actif (sélecteur de dossier dans le chat), étiquetée comme telle.
- Extraction : à la fin d'une tâche, proposer les faits à retenir (l'utilisateur confirme) — pas d'écriture silencieuse.

## D2 — Exploitation des retours

- Toute réponse jugée faible (`feedback.type = 'negatif'`) crée automatiquement un **cas candidat** dans
  `public.cas_epreuve` (migration `020_epreuves.sql`) : `question`, `contexte` (pièces/dossier), `reponse_obtenue`,
  `commentaire_utilisateur`, `reponse_attendue` (à compléter), `criteres jsonb`, `domaine`, `statut` ('candidat','valide','rejete'), `origine` ('retour','manuel').
- Onglet admin « Retours » enrichi : pour chaque retour négatif → « Transformer en cas d'épreuve » (rédiger la réponse attendue
  et les critères), ou « Rejeter ». Un cas validé entre dans la suite d'épreuves (D3).
- Analyse : regroupement des retours par cause (`source manquante`, `mauvaise source`, `invention`, `mise en forme`, `hors sujet`)
  via classification LLM ; tableau de bord par catégorie.

## D3 — Jeux d'épreuves internes (évaluation mesurée)

- Tables : `cas_epreuve` (ci-dessus), `campagnes_epreuve` (`date`, `version_code` = hash git, `modeles`, `score_global`),
  `resultats_epreuve` (`campagne_id`, `cas_id`, `reponse`, `scores jsonb`, `reussi`, `cout`, `latence_ms`).
- Familles de cas à fournir au départ (fixtures dans `backend/fixtures/epreuves/*.json`, au moins 30 cas) : **procédures**
  (réponse doit citer la bonne source), **notes types** (livrable conforme au modèle), **questions pièges** (info absente du
  corpus → l'agent doit dire qu'il ne sait pas / demander, sans inventer), **chiffres** (exactitude).
- Évaluateur `frontend/scripts/eval.ts` (lancé par `npm run eval`) : exécute chaque cas via `answerQuestion` (sans streaming),
  puis note : déterministe (source attendue citée ? chiffre exact ? refus attendu ?) + juge LLM avec grille JSON stricte
  (exactitude, fidélité aux sources, complétude, forme). Enregistre une campagne et affiche l'écart avec la précédente.
- Onglet admin **« Qualité »** : évolution du score par domaine et par campagne, cas en régression.
- Règle : tout changement de prompt, de modèle ou de pipeline doit lancer `npm run eval` ; une baisse > 3 points bloque (à noter dans le JOURNAL).

## D4 — Spécialisation progressive

- Profils de domaine `lib/server/domain-profiles.ts` : `juridique`, `exploitation`, `finance`, `communication` — chacun avec :
  catégories de sources prioritaires (filtre sur `documents.categorie` dans la recherche), consignes de rédaction propres
  (ex. juridique : citer article/clause exacte, prudence ; finance : unités, périodes, arrondis), modèles de documents associés (lot A2),
  cas d'épreuve dédiés.
- Choix du profil : automatique (classification de la demande + équipe/dossier) avec possibilité de forcer dans le composeur.
- Ajouter `domaine` à `document_categories` (migration) et à l'admin des catégories.

## D5 — Contrôle humain obligatoire sur les sujets sensibles

- Détecteur `lib/server/sensitivity.ts` (règles + LLM rapide) : **engagement** (contrat, signature, promesse, offre ferme),
  **chiffre officiel** (budget, résultat, effectif communiqué à l'extérieur), **décision qui engage le groupe**.
- Effet : le livrable est marqué « Brouillon — validation requise », filigrane « BROUILLON » sur docx/pdf/pptx, et l'envoi externe
  (lot C) exige l'approbation d'un **responsable** ; une étape `necessite_validation` est ajoutée à la tâche (lot B).
- Trace dans `journal_audit` de qui a validé le contenu sensible.

## Tests

- RLS : un non-membre ne lit pas la mémoire d'un dossier (script dans le style de `backend/ingestion/test_rls.py`).
- Évaluateur : notation déterministe sur cas simulés ; campagne enregistrée ; détection de régression.
- Sensibilité : phrases d'engagement détectées, phrases neutres non détectées (jeu de 20 exemples).

## Critères d'acceptation du lot D

- [ ] Un dossier a sa mémoire partagée, consultable, corrigible et effaçable, distincte des préférences personnelles.
- [ ] Un retour négatif devient en deux clics un cas d'épreuve.
- [ ] `npm run eval` produit un score par domaine et compare à la campagne précédente.
- [ ] Un document contenant un engagement ne peut pas partir sans validation d'un responsable.
