# État d’implémentation

Évaluation factuelle au 16 juillet 2026.

| Module | État | Vérification |
|---|---|---|
| Migration SQLite et schéma complet | complet | testé (migration) |
| Onboarding, Argon2, connexion, session | complet | tests unitaires partiels |
| Permissions Rust et navigation | complet pour les commandes exposées | testé partiellement |
| Tableau de bord | complet pour les indicateurs affichés | build testé |
| Catégories | complet | test manuel restant |
| Produits et services | complet pour création/modification/liste | test manuel restant |
| Code interne et identifiant QR | complet côté base | rendu Code 128/QR manquant |
| Stock et ajustements | complet | test manuel restant |
| Scanner USB | complet | test unitaire anti-doublon |
| Scanner caméra | manquant | non testé |
| Étiquettes | manquant | non testé |
| Caisse ouverture/clôture | complet (sans compteur de coupures) | test manuel restant |
| POS comptant/crédit/partiel | complet | tests d’intégration Rust à étendre |
| Reçu | partiel (impression WebView, gabarit détaillé manquant) | build testé |
| Clients et règlements | complet pour création/liste/règlement | test manuel restant |
| Fournisseurs et achats | schéma uniquement | non testé |
| Dépenses | schéma uniquement | non testé |
| Retours | schéma uniquement | non testé |
| Employés | permissions et schéma uniquement | non testé |
| Rapports détaillés/exports CSV | manquant | non testé |
| Paramètres | complet pour les champs affichés | test manuel restant |
| Sauvegarde/restauration | complet | test manuel restant |
| Sauvegarde automatique | configuration seulement | non planifiée |
| Tests frontend | 4 réussis | testé |
| Tests Rust | 4 réussis | testé |

Cette version constitue un noyau POS utilisable, mais ne satisfait pas encore tous les critères de l’énoncé initial. Les modules marqués partiels ou manquants ne sont volontairement pas affichés dans la navigation.
