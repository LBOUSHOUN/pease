# Flux POS

Le panier accepte recherche, scanner clavier et quantité. La confirmation envoie une clé d’idempotence. Rust revalide session, permission, client, caisse, produits et stock, puis écrit vente, instantanés, stock, caisse, dette et audit dans une seule transaction. Un service ne diminue pas le stock.

Les retours ont aussi une protection anti-doublon et réduisent la dette restante avant tout remboursement comptant.
