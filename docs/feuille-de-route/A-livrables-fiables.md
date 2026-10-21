# Lot A — Finir le métier qu'il sait déjà faire

> Avant d'ajouter des pouvoirs, ce que produit Ubuntu IA doit être fiable à l'œil d'un directeur ou d'un juriste.
> Sans cela, l'autonomie ne ferait qu'accélérer des documents qu'il faudrait reprendre à la main.

Fichiers existants à lire d'abord : `lib/server/generate-chat-file.ts`, `generate-chat-docx.ts`, `generate-chat-pptx.ts`,
`generate-chat-xlsx.ts`, `generate-chat-pdf.ts`, `document-spec.ts`, `slide-plan.ts`, `design-dna.ts`, `style-transfer.ts`,
`clone-docx.ts`, `clone-pptx.ts`, `xlsx-chart.ts`, `chart-png.ts`, `document-skills.ts`, `generated-files.ts`,
`components/chat/GeneratedFiles.tsx`, `backend/office_worker/jobs.py`.

## A1 — Thème SOFICAU unique et qualité « livrable interne »

**But** : Word, PDF, Excel et PowerPoint sortent avec titres, tableaux, graphiques, pagination et charte SOFICAU cohérents.

1. Crée `frontend/lib/server/brand/soficau-theme.ts` : **source unique** de la charte (marine `17405B`, or `AD8859`,
   canvas `E8EEF2`, texte dérivé du marine, Poppins → repli Calibri/Arial, tailles de titres H1–H3, interlignes,
   marges A4, styles de tableau : en-tête marine texte blanc, lignes zébrées très claires, bordures fines).
   Remplace toutes les couleurs/polices codées en dur dans les générateurs par ce thème (le `design` fourni par le
   modèle reste possible, mais le défaut = SOFICAU, et le contraste est revérifié).
2. **Word (docx)** — dans `generate-chat-docx.ts` :
   - styles natifs Titre 1/2/3 (pour le volet de navigation), page de garde optionnelle (logo, titre, date, entité),
   - **en-tête** (nom du document + entité) et **pied de page** avec « Page X sur Y » (champs `PAGE`/`NUMPAGES`),
   - **table des matières** native (champ TOC) quand le document a ≥ 3 titres H1/H2,
   - légendes « Tableau n — … » / « Figure n — … », tableaux sans coupure de ligne d'en-tête (`tableHeader: true`),
   - graphiques : image PNG nette (`chart-png.ts`) à 2× la résolution, avec légende.
3. **PDF** — `generate-chat-pdf.ts` : mêmes règles (en-tête, pied « Page X / Y », TOC si long, sauts de page
   propres : pas de titre orphelin en bas de page, pas de tableau coupé sans répéter son en-tête).
4. **Excel (xlsx)** — `generate-chat-xlsx.ts` : feuille « Synthèse » + feuilles de données, tableaux structurés
   (ListObject), formats numériques FR (`# ##0,00`, `0 %`, dates `jj/mm/aaaa`), en-têtes figés, largeur de colonnes
   ajustée, **formules réelles** (SUM, AVERAGE…) au lieu de valeurs recopiées, graphiques natifs, mise en page
   d'impression (orientation, ajustement à la largeur, titres imprimés). Envoie ensuite un job `xlsx_recalc`
   au worker quand il est configuré (`OFFICE_WORKER_URL`) pour recalculer et valider.
5. **PowerPoint (pptx)** — `generate-chat-pptx.ts` / `slide-plan.ts` : masque commun SOFICAU, numéro de diapositive,
   pied de page, max ~6 lignes par diapo, titres ≤ 2 lignes, détection de débordement (estimation de hauteur du texte ;
   si débordement → scinder la diapo), graphiques natifs, notes de l'orateur avec le détail retiré des diapos.
6. **Validation technique** systématique : après génération, job `validate_ooxml` (docx/pptx/xlsx) via le worker
   quand disponible ; sinon validation locale minimale (ouverture JSZip + présence des parties obligatoires).
   Un fichier invalide n'est jamais livré : on régénère une fois, puis on signale l'erreur proprement.

**Tests (vitest)** : pour chaque format, un fixture `document-spec` riche (titres, liste, tableau de 30 lignes,
graphique) → vérifier : styles de titre présents, champ PAGE présent (docx), TOC présente si ≥ 3 titres,
formule SUM présente (xlsx), nombre de diapos attendu et aucune diapo > N lignes (pptx).

## A2 — Repartir d'un modèle déjà utilisé dans le groupe

**But** : produire un document à partir d'un modèle officiel du groupe plutôt que de tout réinventer.

1. Migration `backend/db/015_modeles_documents.sql` :
   - bucket privé `modeles-documents` (25 Mo max), politique lecture/écriture réservée à `service_role` ;
   - table `public.modeles_documents` : `id uuid pk`, `organisation_id uuid` → organisations, `nom text`,
     `description text`, `format text check (format in ('docx','pptx','xlsx'))`, `categorie text` (même valeurs que
     `document_categories`), `storage_path text not null`, `champs jsonb default '[]'` (balises détectées),
     `apercu_path text`, `actif boolean default true`, `cree_par uuid` → users, `created_at`, `updated_at` ;
   - RLS : lecture pour les utilisateurs authentifiés de la même organisation ; écriture admin (`is_administrateur()`).
2. Admin : nouvel onglet **« Modèles »** dans `app/admin` (à côté de Documents / Accès / Domaines / Retours) :
   upload (.docx/.pptx/.xlsx, whitelist + taille), nom, catégorie, description, activer/désactiver, supprimer
   (supprime aussi l'objet Storage). À l'upload : analyse du modèle → détecte les balises `{{champ}}` et, à défaut,
   la structure (titres, tableaux, masques de diapos) via `clone-docx.ts` / `clone-pptx.ts` / `design-dna.ts` ;
   miniature PPTX via job `pptx_thumbnails` si le worker est dispo.
3. Moteur : `lib/server/template-fill.ts` :
   - docx : remplace les balises `{{…}}` (y compris coupées entre plusieurs `w:r` — normaliser les runs avant),
     duplique les lignes de tableau marquées `{{#lignes}}…{{/lignes}}`, insère les sections rédigées après les titres
     correspondants en conservant les styles du modèle ;
   - pptx : réutilise les dispositions (layouts) du modèle via `clone-pptx.ts` / job `pptx_from_template` ;
   - xlsx : écrit dans les plages nommées / tableaux structurés existants sans casser les formules.
4. Chat : dans le composeur, sélecteur **« Partir d'un modèle »** (composant `SelectField`) listant les modèles actifs
   du format demandé ; nouvel outil agent `use_template` (dans `agent-tools.ts`) que le planificateur peut appeler quand
   l'utilisateur cite un modèle (« comme la note de service habituelle »). Recherche du modèle par nom/catégorie
   + similarité simple. Le choix est affiché dans les étapes (`AnswerProgress`).
5. Route `GET /api/modeles?format=` (utilisateur authentifié) et routes admin `POST/PATCH/DELETE /api/admin/modeles`.

**Tests** : remplissage de balises coupées sur plusieurs runs ; duplication de lignes de tableau ; xlsx dont les
formules restent intactes après remplissage.

## A3 — Relecture automatique avant remise

**But** : avant tout livrable, vérifier que les chiffres sont cohérents, que les sources sont citées, qu'aucune
procédure n'est inventée.

1. Crée `lib/server/document-review.ts` exportant `reviewDeliverable(input) : Promise<ReviewReport>` appelé dans
   `generate-chat-file.ts` **avant** la construction des fichiers (sur la `document-spec`) :
   - **Contrôles déterministes** (sans LLM) :
     - recalcul des totaux/sous-totaux/pourcentages des tableaux (une ligne « Total » doit égaler la somme ; écart → correction
       automatique si non ambigu, sinon avertissement) ;
     - chaque nombre du livrable doit se retrouver dans : la question, les pièces jointes, les extraits internes cités,
       ou un calcul tracé ; sinon → « chiffre non sourcé » ;
     - chaque affirmation interne doit porter une citation `[n]` qui renvoie à un extrait réellement fourni ;
     - dates cohérentes (pas de date future pour un fait passé, format FR).
   - **Contrôle LLM vérificateur** (modèle rapide, `temperature 0`, sortie JSON stricte validée) : compare le livrable
     aux extraits sources et liste les procédures/règles/chiffres internes **non étayés** par les extraits.
   - Résultat `ReviewReport = { statut: "ok" | "corrige" | "a_verifier", corrections: […], alertes: [{ type, extrait, explication }] }`.
2. Politique : les corrections sûres sont appliquées ; les éléments non étayés sont **retirés ou marqués**
   « [à confirmer] » dans le livrable ; jamais de procédure interne inventée.
3. UI : `GeneratedFiles.tsx` affiche un badge (`StatusBadge`) « Relu » / « Corrigé » / « Points à vérifier » et un
   panneau dépliable listant les alertes. Le rapport est stocké avec le message (`GeneratedFile.relecture`) — étends
   `lib/types.ts` et `conversations.ts#parseFiles/serializeMessage`.
4. Étape SSE visible : « Relecture du livrable… » dans `AnswerProgress`.

**Tests** : tableau avec total faux → corrigé ; chiffre absent des sources → alerte ; citation `[7]` sans extrait 7 → alerte.

## A4 — Publication du chantier

- Nettoyage, `npm run lint`, `tsc`, `build`, tests verts, mise à jour de `.env.example`, `backend/office_worker/README.md`
  (nouveaux jobs éventuels) et du JOURNAL (migrations 015 à appliquer, bucket à créer).
- Commit final du lot. Ne pas déployer : indiquer à l'utilisateur la procédure Render (migrations puis redeploy).

## Critères d'acceptation du lot A

- [ ] Un rapport Word de 10 pages généré depuis le chat a : page de garde, TOC, en-têtes/pieds paginés, tableaux légendés, charte SOFICAU.
- [ ] Un classeur Excel contient de vraies formules et s'imprime proprement sur A4.
- [ ] Un PowerPoint n'a aucune diapo qui déborde ; numéros de diapos présents.
- [ ] Un administrateur ajoute un modèle .docx ; un utilisateur génère un document à partir de ce modèle depuis le chat.
- [ ] Chaque livrable affiche son statut de relecture ; un total faux est corrigé ; un chiffre inventé est signalé.
