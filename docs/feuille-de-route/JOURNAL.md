# Journal d'exécution — Feuille de route Ubuntu IA

> Tenu par l'agent Cursor. Entrée la plus récente en haut.
> Pour chaque lot : plan avant de coder, puis à la fin : Fait / Reste / Décisions / Migrations SQL à appliquer / Nouvelles variables d'environnement / Questions ouvertes.

## Migrations à appliquer sur Supabase (cumul)

- `backend/db/015_modeles_documents.sql` : bucket privé `modeles-documents` (25 Mo) + table
  `public.modeles_documents` + RLS (lecture org / écriture admin) + politique Storage `service_role`.
  À jouer **avant** d'utiliser l'onglet admin « Modèles ».

## Variables d'environnement nouvelles (cumul)

- `OFFICE_WORKER_URL` (déjà déclarée dans `render.yaml`) : désormais **lue par le front**. Vide → aucun job
  `validate_ooxml` / `xlsx_recalc` mis en file (la validation locale reste active). Renseignée → jobs envoyés.

## Questions ouvertes pour l'équipe

- **Lint de base** : `npm run lint` remonte 10 erreurs **préexistantes** (règles React Compiler
  `react-hooks/set-state-in-effect` et accès aux refs pendant le rendu) dans `AccessWorkspace`, `DomainsWorkspace`,
  `FeedbackWorkspace`, `ChatWorkspace`, `Composer`, `UserTurn`, `Dialog`, `SelectField`, `Sheet`, `lib/session.tsx`.
  Aucune n'est introduite par la feuille de route. Composer `withFileBytes` (accès avant déclaration)
  a été corrigé en A2. Les 9 restantes relèvent des fichiers non encore touchés, ou d'un sous-lot dédié.

---

## Lot A — Livrables fiables

### Plan A3 (avant code)

- `document-review.ts` : contrôles déterministes (totaux, chiffres sourcés, citations `[n]`, dates FR)
  + `document-review-llm.ts` (modèle rapide, `temperature 0`, JSON strict) derrière le même
  `reviewDeliverable`. Si l'appel LLM échoue ou n'est pas configuré → relecture déterministe seule,
  jamais de blocage.
- Appel dans `generate-chat-file.ts` **avant** construction, sur la spec ; corrections sûres appliquées
  (total de tableau) ; faits non étayés marqués « [à confirmer] ».
- `GeneratedFile.relecture` dans `types.ts` + `conversations.ts#parseFiles` ; badge + panneau dans
  `GeneratedFiles.tsx` ; étape SSE « Relecture du livrable… ».
- Tests vitest : total faux → corrigé ; chiffre absent → alerte ; `[7]` sans extrait 7 → alerte.
- Pas de nouvelle migration. `env.ts` non modifié (le vérificateur réutilise `chatModel`).

### Plan A2 (avant code)

- Migration `backend/db/015_modeles_documents.sql` : bucket privé `modeles-documents` (25 Mo), table
  `modeles_documents` + RLS (lecture org, écriture admin), politique Storage réservée à `service_role`.
- Admin : onglet `/admin/modeles` (`TemplatesWorkspace`) — upload, analyse des balises `{{champ}}` /
  structure, activer/désactiver, supprimer (objet Storage inclus). Miniature PPTX via job
  `pptx_thumbnails` si `OFFICE_WORKER_URL`.
- Moteur `template-fill.ts` / `ooxml-text.ts` / `template-xlsx.ts` : fusion des balises coupées entre
  runs, duplication `{{#lignes}}`, insertion sous les titres du modèle, xlsx plages nommées + tableaux
  sans écraser les formules, pptx via `clone-pptx.ts` à défaut de balises.
- Chat : `SelectField` « Partir d'un modèle » dans le composeur ; outil agent `use_template` ;
  `tools.modeleId` jusqu'à `generate-chat-file.ts` ; étape SSE « Modèle utilisé : … ».
- Worker : `payload.bucket` autorisé (`generated-files`, `modeles-documents`) pour lire les modèles.
- Tests : balises coupées, lignes de tableau, formules xlsx intactes, correspondance de nom.
- Hors périmètre (ne pas commiter) : `env.ts`, `invitation-mail.ts`, `password-reset-mail.ts`.
- Risques : la TOC Word reste un champ à mettre à jour à l'ouverture ; le bucket n'existe qu'après
  application de 015 — l'admin affichera une erreur propre tant que la migration n'est pas jouée.

### Plan (avant code)

**A1 — Thème SOFICAU unique et qualité « livrable interne »**
- Nouveau `frontend/lib/server/brand/soficau-theme.ts` : source unique (couleurs, polices, tailles H1–H3, interlignes,
  marges A4, styles de tableau, palette des graphiques). `BRAND` (document-spec), `defaultDna` (design-dna),
  `ensureContrast` (document-process), `chart-png`, `xlsx-chart` lisent ce thème au lieu de valeurs codées en dur.
- Word (`generate-chat-docx.ts`) : styles Titre 1/2/3 déclarés, page de garde (logo, titre, date, entité),
  en-tête « titre · entité », pied « Page X sur Y » (PAGE/NUMPAGES), TOC native si ≥ 3 titres H1/H2,
  légendes « Tableau n — » / « Figure n — », `tableHeader` répété, graphique PNG rendu à 2×.
- PDF (`generate-chat-pdf.ts`) : mise en page en flux (curseur de page), en-tête + pied « Page X / Y » posés
  en fin de rendu, TOC avec numéros de page si ≥ 3 titres, pas de titre orphelin, en-tête de tableau répété.
- Excel (`generate-chat-xlsx.ts`) : formats numériques (`#,##0.00`, `0%`, `dd/mm/yyyy` — Excel les affiche
  selon la langue, donc « 1 234,56 » en FR), pourcentages stockés en fraction, dates réelles, ligne « Total »
  du modèle remplacée par une vraie formule, largeur de colonnes ajustée au contenu, mise en page A4
  (orientation selon le nombre de colonnes, ajustement en largeur, ligne d'en-tête répétée, pied paginé).
- PowerPoint (`generate-chat-pptx.ts`, `slide-plan.ts`) : masque SOFICAU (fond, pied de page, numéro de diapo),
  pagination par estimation de hauteur de texte (lignes visuelles, pas nombre d'items), titres ≤ 2 lignes,
  notes de l'orateur avec le texte complet de la section quand une diapo en montre moins.
- Validation (`office-validate.ts`) : ouverture JSZip + parties obligatoires par format ; fichier invalide →
  1 régénération, puis étape en erreur. Jobs worker (`validate_ooxml` / `xlsx_recalc`) envoyés seulement si
  `OFFICE_WORKER_URL` est défini (aujourd'hui ils sont mis en file même sans worker).
- Tests : `vitest` + `vitest.config.mts` (alias `@` et bouchon `server-only`), fixture riche commune.
- Risques : rendu Word de la TOC (champ mis à jour à l'ouverture → `updateFields`, Word demande confirmation) ;
  polices : Poppins n'est pas installée chez la plupart des destinataires → fichiers Office en Calibri (repli
  déclaré dans le thème), Poppins reste la police de l'interface.

**A2 — Modèles du groupe** : migration `015_modeles_documents.sql` (table + bucket + RLS), onglet admin « Modèles »,
`template-fill.ts` (docx balises coupées, lignes répétées ; pptx via clone ; xlsx plages nommées), routes
`/api/modeles` et `/api/admin/modeles`, sélecteur « Partir d'un modèle » dans le composeur, outil agent `use_template`.

**A3 — Relecture automatique** : `document-review.ts` (contrôles déterministes + vérificateur LLM JSON strict),
appel avant construction des fichiers, `GeneratedFile.relecture`, badge + panneau dans `GeneratedFiles.tsx`,
étape SSE « Relecture du livrable… ».

**A4 — Publication** : `.env.example`, README worker, JOURNAL, commit final.

### Bilan A1 (fait)

- Thème unique `lib/server/brand/soficau-theme.ts` + `brand/document-marks.ts` (entité, sur-titre, date FR, seuil TOC).
  Plus aucune couleur SOFICAU codée en dur dans les générateurs ; `ensureContrast` revérifie aussi l'en-tête de tableau.
- Word : styles Titre 1–3 déclarés (volet de navigation), légende `Caption`, couverture avec date + entité,
  en-tête « titre ⇥ entité », pied « Page X sur Y », TOC native (≥ 3 titres H1/H2, `updateFields`), légendes
  « Tableau n — » / « Figure n — », lignes d'en-tête répétées et non sécables, bordures fines, graphique rendu à 2×.
  Le tableau de données du graphique n'est plus dupliqué quand la section a déjà son tableau.
- PDF : moteur en flux (`Flow`), pages blanches imprimables, en-tête + « Page X / Y », sommaire avec numéros de
  page réels, titres jamais orphelins, cellules de tableau renvoyées à la ligne (avant : texte qui débordait),
  en-tête de tableau répété à chaque saut de page.
- Excel : `xlsx-cells.ts` (nombres FR/EN, %, dates, montants FCFA/€), ligne « Total » recopiée remplacée par la
  formule du tableau structuré (SUM, ou AVERAGE pour les %), styles SOFICAU explicites (avant : style Office bleu
  et échelle de couleurs qui rendait le texte illisible → barres de données or), largeurs ajustées, A4 avec
  ajustement en largeur, ligne d'en-tête imprimée, en-tête/pied d'impression.
- PowerPoint : masque `SOFICAU_CONTENU` (pied + numéro de diapo), pagination par hauteur estimée (≤ 6 lignes et
  jamais au-delà de la zone), paragraphes trop longs coupés aux phrases, gabarits cartes/frise/citation abandonnés
  si le texte déborde, tableaux paginés par hauteur, titres ≤ 2 lignes (réduction puis troncature), notes de
  l'orateur avec le texte de la diapo et le détail non affiché.
- Validation : `office-validate.ts` (archive, parties obligatoires, XML, PDF `%PDF`/`%%EOF`) → 1 régénération puis
  étape d'erreur « … n'a pas passé le contrôle technique » ; jobs worker conditionnés à `OFFICE_WORKER_URL`
  (xlsx : `validate_ooxml` + `xlsx_recalc`).
- Tests : `vitest` 4 (la v5 exige `@types/node` ≥ 22), 11 tests (`tests/livrables.test.ts`, `tests/xlsx-cells.test.ts`).
- Vérifications : tsc ✓, build ✓, tests ✓, lint : aucune nouvelle erreur (voir question « Lint de base »).
- Décision : fichiers Office en Calibri (repli déclaré dans le thème) car Poppins n'est pas installée chez la plupart
  des destinataires ; Poppins reste la police de l'interface.
- Non vérifié visuellement dans Word/PowerPoint (pas de LibreOffice sur le poste) : contrôle par extraction de
  texte du PDF et inspection du XML. Échantillons dans `outputs/a1-echantillons/` (ignoré par git).

### Bilan A2 (fait)

- Migration `015_modeles_documents.sql` : bucket `modeles-documents` (privé, 25 Mo), table
  `modeles_documents` (champs + structure détectés), RLS lecture org / écriture admin, Storage
  réservé à `service_role`.
- Admin `/admin/modeles` : upload .docx/.pptx/.xlsx, analyse des balises `{{champ}}` et de la
  structure (titres, diapos, plages nommées), activer/désactiver, suppression (fichier Storage inclus).
  Miniature PPTX via job `pptx_thumbnails` si le worker est configuré (`payload.bucket`).
- Moteur : fusion des balises coupées entre runs (`ooxml-text.ts`), duplication `{{#lignes}}`,
  insertion des sections sous les titres du modèle, xlsx sans écraser les formules, pptx via
  `clone-pptx.ts` à défaut de balises.
- Chat : `SelectField` « Partir d'un modèle » dans le composeur ; `tools.modeleId` jusqu'à
  `generate-chat-file.ts` ; outil agent `use_template` ; étape SSE « Modèle utilisé : … ».
- Worker : `payload.bucket` autorisé (`generated-files`, `modeles-documents`).
- Tests : 17 vitest (dont balises coupées, lignes de tableau, formules xlsx, correspondance de nom)
  + tests bucket worker.
- Vérifications : tsc ✓, build ✓, tests ✓, lint : 9 erreurs préexistantes (Composer `withFileBytes`
  corrigé). `env.ts` / mails d'invitation et de reset **non touchés**.
- Non vérifié dans le navigateur authentifié (pas d'outils browser) : le sélecteur n'apparaît qu'une
  fois la migration 015 appliquée et au moins un modèle actif déposé.

### Bilan A3 (fait)

- `document-review.ts` : totaux de tableau recalculés (correction si une seule ligne Total),
  chiffres absents des sources → alerte + « [à confirmer] », citations `[n]` hors extraits,
  dates futures présentées comme passées.
- `document-review-llm.ts` : vérificateur optionnel (`chatModel`, temperature 0, JSON strict).
  Échec ou absence de clé → relecture déterministe seule, le livrable part quand même.
- Intégré dans `generate-chat-file.ts` avant construction ; `GeneratedFile.relecture` persisté
  via `conversations.ts` ; badge Relu / Corrigé / Points à vérifier + panneau dans
  `GeneratedFiles.tsx` ; étape SSE « Relecture du livrable… ».
- Tests : 20 vitest (3 nouveaux). tsc ✓, build ✓, lint : aucune nouvelle erreur.
- Pas de migration. `env.ts` non modifié.
