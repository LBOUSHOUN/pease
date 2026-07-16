# Architecture en ligne

Le navigateur/PWA appelle Fastify sur la même origine via `/api`. Fastify applique sessions et permissions puis utilise Drizzle/PostgreSQL. Caddy termine HTTPS et route le web et l’API. PostgreSQL n’est pas exposé dans la composition de production.

Les futurs flux financiers utiliseront des transactions PostgreSQL, `SELECT … FOR UPDATE`, contraintes uniques d’idempotence et mises à jour atomiques du stock. Aucun verrou frontend n’est considéré comme une garantie.
