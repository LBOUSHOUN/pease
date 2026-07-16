# Catégories, produits et services en ligne

Les rôles `global_admin`, `manager` et `stock_worker` gèrent les catégories. Le caissier peut les consulter. Un nom de catégorie est nettoyé et unique sans distinction de casse. La désactivation est logique et refusée tant qu’un produit actif dépend de la catégorie.

Les produits physiques peuvent suivre le stock. Les services ne suivent jamais le stock, gardent un stock nul et refusent tout ajustement. Les prix sont des centimes entiers; l’interface accepte MAD avec deux décimales au maximum. Le stock courant ne peut pas être modifié par la route produit.

À la création, PostgreSQL incrémente atomiquement `app_settings.next_barcode_sequence`. Avec le préfixe `MKT`, les codes sont `MKT-000001`, `MKT-000002`, etc. Le QR texte stable est `MKT-P-MKT-000001`. Un changement futur de préfixe ne modifie jamais les produits existants. Les identifiants ne contiennent ni prix, ni stock, ni donnée personnelle.

Le lookup essaie code fabricant, code interne, QR puis SKU. Les écrans affichent uniquement le texte; les images Code 128 et QR appartiennent à une phase ultérieure.

Permissions : `products.view` pour tous les rôles actuels; création, modification et désactivation pour administrateur, manager et agent de stock. Le prix d’achat n’est renvoyé qu’à ces trois rôles.
