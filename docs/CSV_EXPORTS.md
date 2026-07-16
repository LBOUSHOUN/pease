# Exports CSV

Rust produit les exports avec la crate `csv`, UTF-8 avec BOM, séparateur point-virgule et fins de ligne CRLF. Les valeurs commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot sont préfixées par une apostrophe contre l’injection de formules.

Produits, clients, fournisseurs, ventes et stock sont détaillés. Les autres catégories financières restent synthétiques et sont signalées dans le statut.
