# Rapports

`reports.rs` valide les dates (maximum deux ans), applique les permissions et exécute agrégations et pagination dans SQLite. L’interface propose aujourd’hui, hier, 7/30 jours, mois courant/précédent et dates personnalisées.

Les ventes déduisent les retours. Le bénéfice estimé utilise `purchase_price_snapshot_cents` et la quantité non retournée. Le stock exclut les services. Les rapports clients/fournisseurs utilisent les soldes persistés; les dépenses intègrent leurs corrections négatives.

Le rapport quotidien détaillé de clôture et certaines ventilations avancées restent partiels; voir `IMPLEMENTATION_STATUS.md`.
