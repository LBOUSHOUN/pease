# Point de vente en ligne

Le POS recherche par nom ou identifiant et réutilise le scanner USB Phase 2. Un produit déjà présent incrémente sa quantité. Les services ne consomment aucun stock; les produits suivis sont verrouillés et déduits dans la transaction de vente.

Les totaux affichés avant validation sont estimatifs. L’API recharge les produits et prix, fusionne les lignes, calcule le total et valide comptant, crédit ou partiel. Le panier n’est vidé qu’après le commit réussi. Aucune vente n’est mise en attente hors ligne.
