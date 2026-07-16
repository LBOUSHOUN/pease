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
| Caisse ouverture/clôture | comptage MAD, recalcul Rust et persistance transactionnelle | calcul testé; rapport détaillé à étendre |
| POS comptant/crédit/partiel | complet | tests d’intégration Rust à étendre |
| Reçu | partiel (impression WebView, gabarit détaillé manquant) | build testé |
| Clients et règlements | complet pour création/liste/règlement | test manuel restant |
| Fournisseurs | complet pour création/liste/règlement comptant | compilation testée, intégration à étendre |
| Achats multi-lignes | complet pour création transactionnelle | compilation testée, intégration à étendre |
| Dépenses | création, liste paginée/filtrée et correction transactionnelle avec UI | build testé |
| Retours | transaction multi-articles, dette avant espèces, stock, historique et reçu simple | calculs Rust et build testés; intégration à étendre |
| Employés | liste, création/modification, rôles, activation et réinitialisation; activité détaillée à ajouter | build testé, tests d’intégration à étendre |
| Rapports | ventes, bénéfice, stock, clients, fournisseurs, dépenses et employés avec filtres/pagination; clôtures détaillées partielles | build et lancement testés |
| Exports CSV | produits, stock, clients, fournisseurs et ventes détaillés; autres exports synthétiques | sécurité CSV testée |
| Paramètres | complet pour les champs affichés | test manuel restant |
| Sauvegarde/restauration | complet | test manuel restant |
| Sauvegarde automatique | configuration seulement | non planifiée |
| Tests frontend | 4 réussis | testé |
| Tests Rust | 4 réussis | testé |

Cette version constitue un noyau POS utilisable, mais ne satisfait pas encore tous les critères de l’énoncé initial. Les modules marqués partiels ou manquants ne sont volontairement pas affichés dans la navigation.
