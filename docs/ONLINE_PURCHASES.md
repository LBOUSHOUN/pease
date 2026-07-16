# Achats en ligne

Un achat multi-lignes verrouille le fournisseur et les produits physiques dans un ordre stable. Le serveur recalcule les montants en centimes, fusionne les lignes identiques, attribue un numéro `PUR-AAAA-NNNNNN`, augmente le stock, écrit les mouvements, actualise le prix d’achat et conserve son historique.

Les modes comptant, crédit et partiel alimentent atomiquement la caisse et/ou la dette fournisseur. Les services sont refusés. Les listes sont paginées et filtrables; le formulaire accepte recherche et scanner USB clavier. Une clé d’idempotence renvoie le même achat lors d’une soumission répétée.
