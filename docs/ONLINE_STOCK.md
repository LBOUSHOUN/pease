# Stock en ligne

Les listes de stock et de mouvements sont paginées côté serveur. Les agents autorisés utilisent `stock.adjust`; les caissiers ont uniquement `stock.view`.

Une entrée, un stock initial, une sortie, une perte ou un dommage utilise une quantité strictement positive et une direction définie par le type. Les ajustements manuels et d’inventaire exigent explicitement `increase` ou `decrease`. L’API verrouille le produit, relit son stock, calcule avant/après, refuse un résultat négatif, met à jour le produit, ajoute le mouvement et l’audit, puis commit l’ensemble. Toute erreur annule l’ensemble.

Une clé d’idempotence optionnelle empêche une double soumission. L’interface en génère une pour chaque confirmation et désactive le bouton pendant l’envoi.

Le scanner USB est traité comme un clavier : caractères rapides, longueur minimale, puis Entrée. La capture globale ignore `input`, `textarea`, `select` et `contenteditable`, rejette la frappe lente et supprime un scan identique rapproché. Un champ dédié reste disponible sur les produits et l’ajustement. La caméra n’est pas implémentée.
