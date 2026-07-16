# Architecture

React appelle exclusivement des commandes Tauri typées. Rust conserve la session en mémoire, contrôle chaque permission et ouvre SQLite avec clés étrangères, délai d’attente et WAL. Les écritures métier multi-tables utilisent une transaction et un verrou applicatif court. Tous les montants sont des centimes entiers.

Les corrections financières utilisent des écritures liées et des mouvements compensatoires; aucun historique n’est supprimé ou remplacé silencieusement.
