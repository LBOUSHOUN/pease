# Authentification en ligne

Les mots de passe utilisent Argon2. Les sessions sont des jetons opaques aléatoires; seul un condensat SHA-256 renforcé par un secret serveur est stocké. Le cookie est HttpOnly, SameSite=Lax, Secure en production et expire après douze heures. Chaque requête recharge une session non révoquée et un utilisateur actif.
