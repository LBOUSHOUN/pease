# Dépenses en ligne

Les dépenses utilisent des montants entiers en centimes et une source caisse ou espèces externes. Une dépense de caisse exige une session ouverte et crée un mouvement sortant.

Une correction ne modifie ni ne supprime l’écriture originale: elle la marque corrigée, crée une écriture liée de montant opposé et inverse le mouvement de caisse si nécessaire. Le motif est obligatoire. Un index unique, une clé d’idempotence et un verrou transactionnel empêchent les corrections doubles.
