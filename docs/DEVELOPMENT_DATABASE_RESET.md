# Réinitialiser la base locale de développement

Cette commande supprime uniquement les schémas `public` et `drizzle` de la base PostgreSQL configurée dans `apps/api/.env`, puis rejoue toutes les migrations.

Elle refuse de démarrer si `NODE_ENV=production`, si l’hôte PostgreSQL n’est pas `127.0.0.1`, `localhost` ou `::1`, si le nom de base est protégé, ou si la confirmation manque. Elle ne touche ni aux fichiers SQLite Tauri ni aux sauvegardes PostgreSQL.

Sous PowerShell :

```powershell
$env:CONFIRM_DEV_DATABASE_RESET = "YES"
npm run db:reset:dev
Remove-Item Env:CONFIRM_DEV_DATABASE_RESET
```

La sortie affiche l’hôte et le nom de base avant l’opération, puis vérifie que la table `users` est vide, que les tables applicatives existent et que l’historique Drizzle a été recréé.
