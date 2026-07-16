# Dépannage

- Vite affiche `ECONNREFUSED` au démarrage : vérifier que le script racine attend `wait-on http-get://127.0.0.1:3000/health` et qu’aucun ancien processus n’occupe le port 3000.
- Code-barres non détecté : configurer le scanner USB en clavier avec Entrée comme suffixe. La capture globale ignore les champs éditables; utiliser le champ scanner dédié pendant une saisie manuelle.
- Ajustement refusé : seuls les produits physiques avec suivi du stock sont acceptés. Le motif est obligatoire et le stock résultant ne peut jamais être négatif.
- Catégorie impossible à désactiver : désactiver ou déplacer d’abord tous ses produits actifs.

- Fenêtre vide : installer/réparer Microsoft WebView2.
- Base inaccessible : vérifier les droits dans `%APPDATA%\com.maktaba.pos`.
- Compilation Rust `os error 112` : libérer plusieurs Go sur le disque puis exécuter `cargo clean` dans `src-tauri`.
- Scanner inactif : sélectionner la zone de recherche (F2), vérifier le mode clavier et le suffixe Entrée.
- Caisse refusée : ouvrir une session de caisse pour l’utilisateur connecté.
- API en ligne inaccessible : lancer `npm run docker:up`, puis `npm run db:migrate`; vérifier que PostgreSQL répond sur 5433 et l’API sur 3000.
- Configuration API refusée : copier `apps/api/.env.example` vers `apps/api/.env` et remplacer `SESSION_PEPPER` par une valeur aléatoire d’au moins 32 caractères.
- Ancien contenu PWA en développement : recharger une fois. Le client de développement désinscrit automatiquement les service workers et supprime uniquement les caches Maktaba/Workbox connus.
- Trop de tentatives de connexion : attendre la durée affichée ou la valeur `Retry-After`; ne pas contourner la limite en production.
- Session expirée : la prochaine requête renvoie vers la connexion. Si cela boucle, contrôler l’origine, HTTPS et les attributs du cookie.
