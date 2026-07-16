# Base PostgreSQL

La migration Phase 2 ajoute l’unicité de `lower(trim(categories.name))`, les index de catégorie, type, état et identifiants produit, ainsi que les index produit/employé/type des mouvements. `stock_movements.idempotency_key` possède un index unique partiel.

`app_settings.next_barcode_sequence` est incrémenté atomiquement dans la transaction de création. Le nombre de produits n’est jamais utilisé comme séquence. Les suppressions physiques ne font pas partie de l’API : catégories et produits sont activés ou désactivés.

Le schéma Drizzle transpose les tables SQLite et conserve les montants en centimes entiers, instantanés de prix, journaux de dette, mouvements de stock/caisse, retours, coupures et audit. Les contraintes partielles garantissent notamment un seul registre ouvert par caissier.

Les migrations Phase 3 ajoutent la séquence atomique de vente, les clés d’idempotence d’ouverture/clôture/vente/règlement, les phases de coupures, les soldes avant/après du crédit, les références caisse et les index de date, client, caissier, vente et mouvement. Des contraintes vérifient montants non négatifs, allocation de vente, valeurs de coupure et total des coupures.
