# Authentification

Le premier propriétaire est créé dans une transaction avec les paramètres et l’audit. Les mots de passe sont hachés par Argon2 avec sel aléatoire. Le mot de passe n’est jamais renvoyé à React. La session Rust est perdue au redémarrage, imposant une nouvelle connexion. Les rôles sont `global_admin`, `manager`, `cashier` et `stock_worker`.

Après une réinitialisation, le mot de passe temporaire n’est affiché qu’une fois. La session est limitée à l’écran de changement de mot de passe jusqu’à validation du mot de passe actuel et d’un nouveau secret fort.
