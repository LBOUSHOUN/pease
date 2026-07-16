# État d’implémentation

## Version en ligne

Phase 4 est fonctionnelle localement : fournisseurs, achats, dépenses/corrections et retours complètent la caisse, les clients, le crédit, le POS et les ventes. La vérification couvre 96 tests, PostgreSQL Docker, migrations, typecheck, lint, build et concurrence.

| Module                                | État                   | Vérification                                                                               |
| ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| Workspace npm séparé                  | complet                | typecheck/build réussis                                                                    |
| Schéma PostgreSQL Drizzle (22 tables) | complet                | migrations générées et appliquées sur PostgreSQL Docker                                    |
| Onboarding propriétaire API           | complet                | tests d’intégration PostgreSQL, normalisation et concurrence                               |
| Sessions opaques/Argon2/cookies       | complet                | login, persistance, révocation, inactivité et rate limit testés                            |
| Web responsive et changement forcé    | complet                | build et tests frontend réussis                                                            |
| PWA statique                          | complet                | production uniquement; API explicitement hors cache                                        |
| Stabilisation/performance en ligne    | complet                | 96 tests, typecheck, lint, build et tests de concurrence réussis                           |
| Catégories en ligne                   | complet                | CRUD logique, pagination, recherche, audit et protection des dépendances testés            |
| Produits et services en ligne         | complet                | filtres, permissions, identifiants atomiques et lookup testés                              |
| Stock en ligne                        | complet                | verrouillage, idempotence, mouvements, audit et concurrence testés                         |
| Scanner USB web                       | complet                | buffer clavier, champ dédié et anti-doublon testés; caméra exclue                          |
| Caisse en ligne                       | complet                | ouverture, coupures, statut, mouvements, clôture, écart, idempotence et concurrence testés |
| Clients et crédit en ligne            | complet                | CRUD logique, journal immuable, règlements comptants et concurrence testés                 |
| POS et ventes en ligne                | complet                | comptant, crédit, partiel, services, stock, reçus, numérotation et idempotence testés      |
| Docker/Caddy                          | configuration complète | PostgreSQL de développement validé; déploiement VPS restant                                |
| Modules métier Phase 4 en ligne       | complet                | fournisseurs, achats, dépenses et retours validés                                          |
| Rapports et exports en ligne          | manquants              | volontairement hors Phase 4                                                                |

Il n’existe aucune synchronisation offline/online. Le déploiement VPS n’a pas été effectué.

### Phase 4 en ligne — 16 juillet 2026

| Module                  | État     | Vérification                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------------- |
| Fournisseurs et dette   | complet  | grand livre immuable, règlements, permissions, idempotence et concurrence |
| Achats                  | complet  | comptant/crédit/partiel, stock, prix d’achat, dette et caisse atomiques   |
| Dépenses                | complet  | source caisse/externe et corrections immuables idempotentes               |
| Retours                 | complet  | prix sauvegardé, crédit avant espèces, restock explicite et concurrence   |
| Rapports et exports web | manquant | volontairement hors Phase 4                                               |

## Version desktop hors ligne

Évaluation factuelle au 16 juillet 2026.

| Module                                 | État                                                                                                                         | Vérification                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Migration SQLite et schéma complet     | complet                                                                                                                      | testé (migration)                                   |
| Onboarding, Argon2, connexion, session | complet                                                                                                                      | tests unitaires partiels                            |
| Permissions Rust et navigation         | complet pour les commandes exposées                                                                                          | testé partiellement                                 |
| Tableau de bord                        | complet pour les indicateurs affichés                                                                                        | build testé                                         |
| Catégories                             | complet                                                                                                                      | test manuel restant                                 |
| Produits et services                   | complet pour création/modification/liste                                                                                     | test manuel restant                                 |
| Code interne et identifiant QR         | complet côté base                                                                                                            | rendu Code 128/QR manquant                          |
| Stock et ajustements                   | complet                                                                                                                      | test manuel restant                                 |
| Scanner USB                            | complet                                                                                                                      | test unitaire anti-doublon                          |
| Scanner caméra                         | manquant                                                                                                                     | non testé                                           |
| Étiquettes                             | manquant                                                                                                                     | non testé                                           |
| Caisse ouverture/clôture               | comptage MAD, recalcul Rust et persistance transactionnelle                                                                  | calcul testé; rapport détaillé à étendre            |
| POS comptant/crédit/partiel            | complet                                                                                                                      | tests d’intégration Rust à étendre                  |
| Reçu                                   | partiel (impression WebView, gabarit détaillé manquant)                                                                      | build testé                                         |
| Clients et règlements                  | complet pour création/liste/règlement                                                                                        | test manuel restant                                 |
| Fournisseurs                           | complet pour création/liste/règlement comptant                                                                               | compilation testée, intégration à étendre           |
| Achats multi-lignes                    | complet pour création transactionnelle                                                                                       | compilation testée, intégration à étendre           |
| Dépenses                               | création, liste paginée/filtrée et correction transactionnelle avec UI                                                       | build testé                                         |
| Retours                                | transaction multi-articles, dette avant espèces, stock, historique et reçu simple                                            | calculs Rust et build testés; intégration à étendre |
| Employés                               | liste, création/modification, rôles, activation et réinitialisation; activité détaillée à ajouter                            | build testé, tests d’intégration à étendre          |
| Rapports                               | ventes, bénéfice, stock, clients, fournisseurs, dépenses et employés avec filtres/pagination; clôtures détaillées partielles | build et lancement testés                           |
| Exports CSV                            | produits, stock, clients, fournisseurs et ventes détaillés; autres exports synthétiques                                      | sécurité CSV testée                                 |
| Paramètres                             | complet pour les champs affichés                                                                                             | test manuel restant                                 |
| Sauvegarde/restauration                | complet                                                                                                                      | test manuel restant                                 |
| Sauvegarde automatique                 | configuration seulement                                                                                                      | non planifiée                                       |
| Tests frontend                         | 4 réussis                                                                                                                    | testé                                               |
| Tests Rust                             | 4 réussis                                                                                                                    | testé                                               |

Cette version constitue un noyau POS utilisable, mais ne satisfait pas encore tous les critères de l’énoncé initial. Les modules marqués partiels ou manquants ne sont volontairement pas affichés dans la navigation.
