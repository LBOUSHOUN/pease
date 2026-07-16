# Employés

Les comptes sont locaux. Les mots de passe sont hachés avec Argon2 et ne sont jamais renvoyés à React. Un nouveau compte reçoit un mot de passe temporaire et `must_change_password`; toutes les commandes métier sont alors bloquées côté Rust jusqu’au changement. Seul un administrateur global peut gérer un autre administrateur global, et le dernier administrateur actif ne peut pas être désactivé.
