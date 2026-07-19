# Déploiement VPS

La cible est Caddy → web/API → PostgreSQL. PostgreSQL n’est pas publié. Les volumes `maktaba_pg`, `maktaba_backups` et Caddy sont persistants.

1. Copier `deploy/.env.production.example` vers `deploy/.env.production`, remplacer secrets et domaine, puis limiter ses droits.
2. Construire : `docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml build`.
3. Migrer : `docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml run --rm api npm run db:migrate -w @maktaba/api`.
4. Démarrer : `docker compose --env-file deploy/.env.production -f deploy/docker-compose.prod.yml up -d`.
5. Vérifier `/health`, `/ready`, les journaux et une connexion réelle.

Les dumps applicatifs sont dans `maktaba_backups`; les copier régulièrement vers un stockage chiffré externe. Une restauration est destructive : arrêter les écritures, créer un dump de sécurité, obtenir une confirmation explicite, restaurer, migrer et tester. Configurer la rotation Docker (`max-size`/`max-file`) ou le collecteur du VPS.

Construire Tauri séparément avec `VITE_API_URL=https://DOMAINE/api`. Ne jamais intégrer `DATABASE_URL` au frontend ou à l’installateur.
