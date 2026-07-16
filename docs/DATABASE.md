# Base de données

La migration version 1 crée `schema_migrations`, les paramètres, utilisateurs, catégories, produits, historiques de prix, clients et crédits, fournisseurs, caisses et mouvements, ventes et lignes, mouvements de stock, achats, paiements fournisseurs, dépenses, retours et audit. Les identifiants, recherches et dates fréquemment filtrés sont indexés.

Le fichier est `maktaba-pos.sqlite3` dans le répertoire de données Tauri. Les migrations sont intégrées au binaire et ne recréent jamais silencieusement la base.

La migration 2 ajoute `cash_register_denominations` et des index financiers pour les dépenses et retours.
