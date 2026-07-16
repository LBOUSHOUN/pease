# Architecture en ligne

Le navigateur/PWA appelle Fastify sur la même origine via `/api`. Fastify applique sessions et permissions puis utilise Drizzle/PostgreSQL. Caddy termine HTTPS et route le web et l’API. PostgreSQL n’est pas exposé dans la composition de production.

L’API utilise un pool PostgreSQL unique, borné à dix connexions. Les index couvrent les identifiants normalisés, les utilisateurs actifs, les condensats de session et leur expiration. `apps/api/.env` est chargé avant validation de la configuration; une variable fournie au processus a priorité. Le client HTTP web centralise cookies, JSON optionnel, annulation, lecture sûre des réponses et traduction des erreurs.

Le tableau de bord et l’enregistrement PWA sont chargés dynamiquement. Aucun service worker n’est enregistré en développement; les anciens caches Maktaba/Workbox sont nettoyés sans toucher aux autres caches. En production, les routes `/api` utilisent `NetworkOnly` et ne servent jamais de données métier depuis un cache.

Les futurs flux financiers utiliseront des transactions PostgreSQL, `SELECT … FOR UPDATE`, contraintes uniques d’idempotence et mises à jour atomiques du stock. Aucun verrou frontend n’est considéré comme une garantie.
