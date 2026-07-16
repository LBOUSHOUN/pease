# Maktaba POS

Application de caisse locale pour papeterie/librairie marocaine, construite avec Tauri 2, Rust, React, TypeScript et SQLite. La base, l’authentification et les opérations de caisse fonctionnent sans réseau.

## Fonctionnalités disponibles

- premier démarrage et création atomique du propriétaire ;
- connexion locale Argon2 et permissions contrôlées côté Rust ;
- catalogue de produits et services, catégories et codes internes séquentiels ;
- ajustements de stock tracés ;
- ouverture/clôture de caisse ;
- ventes comptant, crédit et paiement partiel dans une transaction SQLite ;
- clients, dette et règlements comptants ;
- fournisseurs, règlements et achats multi-lignes transactionnels ;
- saisie transactionnelle des dépenses ;
- rapports SQLite paginés et exports CSV compatibles Excel français ;
- tableau de bord réel, paramètres, impression WebView et sauvegarde/restauration validée.

Consultez `IMPLEMENTATION_STATUS.md` pour les limites actuelles.

## Prérequis et développement

- Windows 10/11 avec WebView2
- Node.js 20+
- Rust MSVC stable et Visual Studio Build Tools

```powershell
cd C:\laragon\www\maktaba-pos\apps\desktop
npm install
npm run tauri dev
```

La base `maktaba-pos.sqlite3` est créée dans le dossier de données de l’application résolu par Tauri (sur Windows, sous `%APPDATA%\com.maktaba.pos`). Elle n’est jamais placée dans le dépôt. Les migrations s’exécutent automatiquement et ne suppriment aucune donnée.

## Vérification

```powershell
cd apps\desktop
npm run verify
cd src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

Le scanner USB doit être configuré en mode clavier avec `Entrée` comme suffixe. F2 replace le focus sur la recherche de caisse. L’impression utilise l’aperçu système de WebView (`window.print`) et accepte les imprimantes 58/80 mm ou A4 sans pilote propriétaire.

Les sauvegardes se créent depuis l’écran **Sauvegarde**. Elles font un checkpoint WAL, utilisent l’API SQLite backup et passent `integrity_check`. Toujours conserver une copie sur un autre support.

Pour produire ultérieurement les installateurs : `npm run tauri -- build`. Cette commande n’est volontairement pas exécutée pendant le développement incomplet.

En cas de problème : vérifier WebView2, l’espace disque, les droits du dossier `%APPDATA%`, puis exécuter `npm run typecheck` et `cargo test` séparément.
