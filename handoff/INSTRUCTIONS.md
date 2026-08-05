# Journal de pêche — Estuaire de l'Odet (version en ligne, carnet partagé)

App React (Vite + Tailwind) pour consigner des sorties de pêche à vue (Combrit, Bénodet,
Loctudy, Concarneau, Le Guilvinec, Douarnenez, Audierne). Le coefficient de marée, la hauteur
d'eau et le sens de la marée (montante/descendante) sont calculés automatiquement via l'API
gratuite https://api-maree.fr (données SHOM/Ifremer). Chaque sortie peut avoir une photo.

Les sorties sont stockées dans une base **Supabase** (Postgres gratuit) partagée entre les
3 frères, avec synchronisation en direct (si l'un ajoute une sortie, les autres la voient
sans recharger la page). Les photos sont stockées dans le storage Supabase (bucket "photos").

## Étape 0 — Compte Supabase (à faire par l'utilisateur, pas par toi)

L'utilisateur doit créer gratuitement un projet sur https://supabase.com, puis :
1. Dans le dashboard du projet → SQL Editor → coller le contenu de `supabase-schema.sql`
   (fourni à côté de ce fichier) → Run.
2. Dans Project Settings → API, récupérer :
   - "Project URL"
   - "anon public" key
3. Dans Authentication → Users → "Add user" → créer **un seul compte** avec :
   - un email quelconque, jamais affiché aux utilisateurs (ex: `famille@journal-peche.local`)
   - un mot de passe = le **code d'accès partagé** que Joris donnera à ses 2 frères
   - cocher "Auto Confirm User" pour éviter l'email de confirmation
   L'app n'a qu'un seul champ "code d'accès" (pas d'email demandé) : tous les trois se
   connectent avec ce même couple email/mot de passe, l'email est stocké dans `.env`
   et jamais montré à l'écran.

S'il n'a pas encore fait ça, demande-lui ces informations avant de continuer.

## Ce qu'il faut faire

1. Scaffolder un projet Vite + React dans ce dossier :
   ```
   npm create vite@latest . -- --template react
   npm install
   ```

2. Installer les dépendances :
   ```
   npm install lucide-react recharts @supabase/supabase-js
   npm install -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   ```

3. Dans `tailwind.config.js`, remplacer `content: []` par :
   ```js
   content: ["./index.html", "./src/**/*.{js,jsx}"],
   ```

4. Dans `src/index.css`, remplacer tout le contenu par :
   ```css
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

5. Remplacer `src/App.jsx` par le contenu du fichier `App.jsx` fourni dans ce dossier.

6. Créer un fichier `.env` à la racine du projet (ne pas le committer — ajoute-le à
   `.gitignore` s'il n'y est pas déjà) :
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   VITE_LOGIN_EMAIL=famille@journal-peche.local
   ```
   avec les valeurs récupérées à l'étape 0 (le `VITE_LOGIN_EMAIL` doit être exactement
   l'email du compte unique créé à l'étape 0.3 — il n'est jamais montré à l'écran, seul
   le mot de passe/code d'accès est demandé aux utilisateurs).

7. Vérifier que ça compile : `npm run dev`, puis `npm run build`.

## Déploiement en ligne

Le plus simple pour ce projet est **Vercel** ou **Netlify** (plan gratuit largement suffisant) :

- Pousser le dossier sur un dépôt GitHub (créer le repo si besoin, `git init`, `git add -A`,
  `git commit`, `git push`).
- Sur Vercel ou Netlify : "New project" → importer le repo GitHub → renseigner les variables
  d'environnement `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` et `VITE_LOGIN_EMAIL`
  (les mêmes que dans `.env`) → Deploy.
- Le site aura une URL publique (ex: `journal-peche.vercel.app`), utilisable depuis
  n'importe quel téléphone.

## Notes fonctionnelles (pour comprendre le code)

- Connexion : un seul compte Supabase partagé par les 3 frères. L'app ne demande qu'un
  "code d'accès" (le mot de passe), l'email associé est lu depuis `VITE_LOGIN_EMAIL` et
  jamais affiché. La session reste active dans le navigateur tant qu'on ne se déconnecte pas.
- Le coefficient de marée et le sens (montante/descendante) sont calculés côté client via
  `https://api-maree.fr`, avec une clé
  API personnelle que chaque utilisateur colle dans le panneau de réglages (icône engrenage)
  de l'app — stockée dans le `localStorage` de son navigateur, pas dans Supabase. Chaque
  frère doit créer gratuitement sa propre clé sur https://api-maree.fr/register.
- Si l'API marée est indisponible, l'app propose une saisie manuelle du coefficient en secours.
- Les sorties (qui/où/quand/coef/direction/prise/photo) sont dans la table Supabase `sorties`,
  donc bien partagées entre les 3. Les photos sont dans le bucket de storage `photos`
  (créé par `supabase-schema.sql`), en lecture publique mais écriture réservée aux
  utilisateurs connectés.
- L'onglet "Probabilités" permet de filtrer les statistiques par sens de marée
  (toutes / montante / descendante) en plus du coefficient.

## Vérifications avant de rendre la main

- `npm run dev` démarre sans erreur.
- `npm run build` fonctionne.
- Ajouter une sortie depuis le formulaire l'affiche bien dans l'onglet "Carnet" sans recharger
  la page (confirme que l'insertion + le rechargement Supabase fonctionnent).
- `.env` est bien ignoré par git avant tout `git push`.
