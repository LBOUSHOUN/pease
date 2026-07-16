# Fournisseurs en ligne

La Phase 4 ajoute la recherche, la création, la modification et l’activation logique des fournisseurs. La dette courante est maintenue par transaction PostgreSQL et expliquée par un grand livre immuable composé des crédits d’achat et règlements.

Les règlements refusent tout dépassement de dette. La source `cash_register` exige une caisse ouverte et crée un mouvement de caisse; `external_cash` n’affecte pas la caisse. Les clés d’idempotence, verrous et permissions protègent les doubles soumissions et mises à jour concurrentes.
