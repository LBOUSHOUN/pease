# Retours en ligne

Un retour utilise les prix sauvegardés sur les lignes de vente. Il vérifie sous verrou les quantités encore retournables, puis affecte la valeur au crédit restant avant tout remboursement en espèces. La part espèces exige une caisse ouverte.

Le restock est explicite et limité aux produits physiques; les services et articles non restockés ne changent jamais le stock. La transaction écrit le retour `RET-AAAA-NNNNNN`, ses lignes, la dette client, les mouvements de caisse/stock et le statut de vente. Les retours concurrents ne peuvent dépasser la quantité vendue.
