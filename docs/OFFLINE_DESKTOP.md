# Mode hors ligne Tauri

SQLite est uniquement un cache et un outbox. Les tables actives `offline_*` contiennent catalogue, paramètres utiles, caisse observée et opérations `cash_sale`. Les anciennes tables métier et v3 sont conservées; aucune base utilisateur n’est supprimée.

Une vente exige Tauri, une authentification obtenue pendant la session courante, une caisse ouverte observée en ligne, des produits actifs en cache et un paiement comptant sans client. Chaque ligne conserve ID serveur, quantité et prix observé. Le serveur recalcule le total et contrôle stock, produit, permission et caisse.

La synchronisation suit l’ordre de création avec un verrou single-flight et envoie la même clé dans le corps et `Idempotency-Key`. Réseau/401 remet en attente et arrête le cycle; 400/403/404/409 rejette sans supprimer. Une opération synchronisée ou rejetée n’est pas renvoyée automatiquement. Le stock estimé est le cache serveur moins les quantités en attente/synchronisation.
