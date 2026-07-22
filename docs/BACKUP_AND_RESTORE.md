# Sauvegardes PostgreSQL Railway vers Supabase Storage

## Architecture et limites

Railway PostgreSQL reste l’unique base active de Maktaba POS. L’API conserve impérativement `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Le service cron Railway séparé exécute `pg_dump` 18, vérifie le dump avec `pg_restore --list`, calcule son SHA256 puis l’envoie dans le bucket Supabase Storage privé `maktaba-backups`. Supabase Database n’est ni la base active ni la destination d’une restauration quotidienne.

Le worker utilise un verrou consultatif PostgreSQL : une seconde exécution quitte sans créer de doublon. Tous les jours, il crée une version `daily`; le dimanche UTC une copie `weekly`; la première sauvegarde réussie du mois crée une copie `monthly`. Après confirmation des objets `.dump` et `.json`, il conserve respectivement les 7, 4 et 6 plus récents.

## Configuration Railway

Créer un service Railway distinct à partir du même dépôt, avec `deploy/railway-backup.toml` comme fichier de configuration. Le cron par défaut est `0 3 * * *` (03:00 UTC). Ne pas ajouter un intervalle au service API.

Variables obligatoires du worker :

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret Railway uniquement>
SUPABASE_BACKUP_BUCKET=maktaba-backups
```

Le bucket doit être créé dans Supabase Dashboard → Storage → New bucket, sous le nom exact `maktaba-backups`, avec **Public bucket désactivé**. Le worker vérifie ce réglage et échoue si le bucket manque ou est public. Ne créer aucune politique anonyme d’upload ou de lecture.

Variables facultatives : `BACKUP_ENABLED`, `BACKUP_RETENTION_DAILY`, `BACKUP_RETENTION_WEEKLY`, `BACKUP_RETENTION_MONTHLY`, `BACKUP_WEEKLY_DAY` (0 = dimanche UTC), `BACKUP_TEMP_DIRECTORY`, `PG_DUMP_PATH`, `PG_RESTORE_PATH`, `BACKUP_SOURCE_LABEL` et `BACKUP_VERIFY_DATABASE_URL`.

## Commandes

Après compilation :

```powershell
npm run backup:run
npm run backup:retention
```

La vérification de nombres de lignes exige une base restaurée séparée :

```powershell
$env:BACKUP_VERIFY_DATABASE_URL = '<base-de-test-restaurée>'
npm run backup:verify
```

La liste extensible par défaut est `products,sales,customers,app_settings,users,categories`; utiliser `BACKUP_VERIFY_TABLES` pour la modifier.

## Objets et manifeste

Les chemins ne sont jamais écrasés :

```text
daily/YYYY/MM/maktaba-railway-full-YYYY-MM-DD_HH-mm-ssZ.dump
weekly/YYYY/maktaba-railway-weekly-YYYY-MM-DD_HH-mm-ssZ.dump
monthly/YYYY/maktaba-railway-monthly-YYYY-MM-DD_HH-mm-ssZ.dump
```

Chaque dump possède un manifeste `.json` contenant le nom, la date UTC, la source, les versions PostgreSQL/pg_dump, la taille, le SHA256, le format, la vérification `pg_restore`, l’environnement, la catégorie et la version du worker. Aucun secret ni URL de connexion n’y figure.

## Téléchargement privé et vérification

Télécharger ponctuellement depuis le Dashboard Supabase authentifié, ou générer une URL signée de courte durée côté administrateur sécurisé. Ne jamais rendre le bucket public et ne jamais placer la clé service-role dans le navigateur.

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' --list .\backup.dump
Get-FileHash .\backup.dump -Algorithm SHA256
```

Comparer le SHA256 avec le manifeste avant toute restauration.

## Restauration sûre

Restaurer d’abord vers une nouvelle base vide de staging, jamais directement par-dessus Railway :

```powershell
pg_restore --verbose --no-owner --no-acl --dbname="$env:TARGET_DATABASE_URL" .\backup.dump
```

`--clean --if-exists` supprime les objets existants dans la base cible. L’utiliser uniquement sur une base de test dédiée ou après validation explicite d’une restauration destructive. Sur une base vide, l’omettre réduit le risque.

Procédure de reprise :

1. Arrêter les écritures applicatives.
2. Choisir un dump dont le manifeste confirme les vérifications.
3. Vérifier SHA256 et `pg_restore --list`.
4. Restaurer dans une base de test vide.
5. Comparer les tables importantes avec `npm run backup:verify`.
6. Appliquer les migrations puis tester `/api/health`, l’authentification et les flux essentiels.
7. Basculer ou restaurer la production uniquement après confirmation humaine.
8. Conserver l’ancienne base de production jusqu’à validation complète.

## Erreurs courantes

- `server version mismatch` : utiliser le worker basé sur PostgreSQL 18.
- Erreurs owner/ACL : conserver `--no-owner --no-acl`.
- Connexions actives avec `--clean` : arrêter les écritures et sessions avant une action destructive.
- Réseau Railway/Supabase : vérifier les références de service et l’accès sortant sans imprimer les secrets.
- Bucket absent/public : créer le bucket privé manuellement ou corriger son réglage.

## Rotation urgente des identifiants Railway

Le mot de passe PostgreSQL public utilisé pendant les tests doit être considéré comme exposé :

1. Régénérer les identifiants du service PostgreSQL Railway.
2. Confirmer que l’API et le worker utilisent toujours `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Redéployer ou redémarrer l’API et le worker.
4. Vérifier `GET https://pease-production.up.railway.app/api/health`.
5. Effectuer une connexion applicative protégée.
6. Exécuter manuellement le job Railway utilisant `npm run backup:run`.
7. Confirmer le nouveau dump et son manifeste dans le bucket privé.
8. Révoquer tout ancien identifiant encore valide.
9. Retirer les valeurs divulguées de l’historique shell, notes et fichiers temporaires quand cela est possible.
10. Scanner les fichiers et l’historique Git. Ne pas réécrire l’historique automatiquement ; coordonner cette opération si une valeur réelle y est trouvée.
