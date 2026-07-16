# Limite hors ligne / en ligne

`apps/desktop` reste la version hors ligne figée et sa base SQLite demeure locale. `apps/api` et `apps/web` constituent une nouvelle version PostgreSQL en ligne. Aucun mécanisme de synchronisation n’existe actuellement.

Les deux bases ne doivent jamais accepter simultanément des ventes de production : cela créerait des numéros, stocks, dettes et caisses divergents. Le passage en production exigera une migration contrôlée et un choix explicite de système autoritatif.
