# Sauvegarde et restauration

La sauvegarde fait un checkpoint WAL, utilise l’API de sauvegarde SQLite puis vérifie l’intégrité et les tables obligatoires. La restauration valide d’abord la source et crée `maktaba-pos.before-restore.sqlite3`. Fermer puis relancer l’application après restauration.
