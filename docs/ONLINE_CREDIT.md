# Crédit client en ligne

Le journal est immuable. Une vente à crédit ajoute un montant positif avec soldes avant/après. Un règlement ajoute un montant signé négatif, exige une caisse ouverte, refuse le dépassement de dette et crée simultanément un mouvement de caisse positif.

Client, caisse et lignes affectées sont verrouillés dans PostgreSQL. Dette, journal, mouvement de caisse et audit partagent le même commit. Les clés d’idempotence sont uniques par employé.
