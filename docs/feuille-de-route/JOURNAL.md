# Journal d'exécution — Feuille de route Ubuntu IA

> Tenu par l'agent Cursor. Entrée la plus récente en haut.
> Pour chaque lot : plan avant de coder, puis à la fin : Fait / Reste / Décisions / Migrations SQL à appliquer / Nouvelles variables d'environnement / Questions ouvertes.

## Migrations à appliquer sur Supabase (cumul)

_(aucune pour l'instant)_

## Variables d'environnement nouvelles (cumul)

- `OFFICE_WORKER_URL` (déjà déclarée dans `render.yaml`) : désormais **lue par le front**. Vide → aucun job
  `validate_ooxml` / `xlsx_recalc` mis en file (la validation locale reste active). Renseignée → jobs envoyés.

## Questions ouvertes pour l'équipe

- **Lint de base** : `npm run lint` remonte 10 erreurs **préexistantes** (règles React Compiler
  `react-hooks/set-state-in-effect` et accès aux refs pendant le rendu) dans `AccessWorkspace`, `DomainsWorkspace`,
  `FeedbackWorkspace`, `ChatWorkspace`, `Composer`, `UserTurn`, `Dialog`, `SelectField`, `Sheet`, `lib/session.tsx`.
  Aucune n'est introduite par la feuille de route. Elles seront corrigées au fil des sous-lots qui touchent ces
  fichiers (Composer en A2) ou dans un sous-lot dédié si vous le souhaitez.

---

## Lot A — Livrables fiables

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
