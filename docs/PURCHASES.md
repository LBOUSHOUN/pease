# Achats et fournisseurs

La création d’un achat valide le fournisseur, chaque produit, les quantités et les prix. Une transaction unique crée l’achat et ses lignes, augmente le stock physique, écrit les mouvements, actualise le prix d’achat et son historique, augmente la dette impayée et débite la caisse pour la part payée. Les services ne reçoivent aucun stock. Un règlement fournisseur ne peut dépasser la dette et exige une caisse ouverte.
