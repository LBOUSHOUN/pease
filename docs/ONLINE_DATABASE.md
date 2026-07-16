# Base PostgreSQL

Le schéma Drizzle transpose les tables SQLite et conserve les montants en centimes entiers, instantanés de prix, journaux de dette, mouvements de stock/caisse, retours, coupures et audit. Les contraintes partielles garantissent notamment un seul registre ouvert par caissier.
