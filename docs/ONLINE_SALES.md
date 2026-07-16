# Ventes en ligne

Une vente `cash`, `credit` ou `partial` est une transaction PostgreSQL unique. L’API verrouille les produits dans l’ordre de leur identifiant, recharge prix/état/stock, calcule les lignes et le total, verrouille caisse et client si nécessaires, puis écrit vente, instantanés, stock, mouvements, dette et audit.

Les numéros utilisent le format `SALE-AAAA-NNNNNN`. `app_settings.next_sale_sequence` est verrouillé et incrémenté; aucun comptage de lignes n’est utilisé. L’idempotence est unique par caissier. Les reçus affichent magasin, vente, caissier, client, lignes et allocation comptant/crédit via CSS d’impression navigateur.

Les retours, remises, fiscalité avancée et tickets matériels ne font pas partie de cette phase.
