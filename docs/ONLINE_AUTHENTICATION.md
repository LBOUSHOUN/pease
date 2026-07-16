# Authentification en ligne

Les mots de passe utilisent Argon2. Les sessions sont des jetons opaques aléatoires; seul un condensat SHA-256 renforcé par un secret serveur est stocké. Le cookie est HttpOnly, SameSite=Lax, Secure en production et expire après douze heures. Chaque requête recharge une session non révoquée et un utilisateur actif.

Le login accepte le nom d’utilisateur ou l’e-mail sans tenir compte de la casse ni des espaces extérieurs. Les identifiants incorrects renvoient toujours le même message afin de ne pas révéler l’existence d’un compte. La route est limitée par `LOGIN_RATE_LIMIT` (8 tentatives par minute par défaut) et fournit `Retry-After`; l’interface bloque temporairement le bouton et affiche le temps restant.

Au chargement, le navigateur mutualise une seule initialisation, même sous React StrictMode : `/bootstrap/status`, puis `/auth/me` seulement si un propriétaire existe. Une réponse 401 de session efface l’utilisateur local. La déconnexion est une requête POST sans corps, révoque la session en base, efface le cookie avec les mêmes attributs et reste idempotente. Les doubles clics partagent la même requête en vol.

Les erreurs exposées au navigateur sont normalisées (400, 401, 403, 409, 429 et 500) et incluent un identifiant de requête, jamais une trace ou un détail SQL.
