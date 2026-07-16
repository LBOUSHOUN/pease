# Migrations PostgreSQL

Les migrations Drizzle sont générées par `npm run db:generate` et appliquées explicitement par `npm run db:migrate`. En production, exécuter cette étape contrôlée avant de démarrer la nouvelle version API. Le serveur ne supprime ni ne recrée automatiquement une base existante.
