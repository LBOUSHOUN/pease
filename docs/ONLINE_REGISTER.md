# Caisse en ligne

Chaque utilisateur ne peut avoir qu’une caisse ouverte. L’ouverture accepte un fond non négatif, une note et éventuellement les coupures; leur total est recalculé par l’API. Les coupures autorisées sont 200, 100, 50, 20, 10, 5, 2, 1 et 0,50 MAD.

La clôture verrouille la session, recalcule les ventes comptant et règlements de dette, puis enregistre attendu, réel et écart. Un écart non nul exige un motif. Ouverture et clôture sont idempotentes et auditées. Les résumés utilisent l’impression navigateur, sans PDF lourd.
