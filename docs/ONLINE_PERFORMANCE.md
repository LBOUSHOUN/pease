# Performance et stabilité en ligne

Mesures locales du 16 juillet 2026, sur la page de connexion Vite en développement avec PostgreSQL Docker : LCP 162 ms, TTFB 5 ms et CLS 0,00. Les médianes de cinq appels directs à l’API étaient de 5,35 ms pour `/bootstrap/status` et 1,43 ms pour `/auth/me`. Ces chiffres sont des repères locaux, pas des objectifs VPS ni des garanties utilisateur.

Le chargement non authentifié produit exactement une requête bootstrap et une requête session, y compris sous React StrictMode. Le tableau de bord et l’enregistrement PWA sont découpés en chunks asynchrones. Le build mesuré contient :

- application principale : 240,27 kB, 77,46 kB gzip ;
- tableau de bord : 0,67 kB, 0,44 kB gzip ;
- enregistrement PWA : 0,92 kB, 0,54 kB gzip ;
- Workbox Window : 5,75 kB, 2,36 kB gzip ;
- CSS : 1,86 kB, 0,83 kB gzip.

Le bundle principal avant la passe mesurait 238,52 kB (76,55 kB gzip). L’augmentation de 1,75 kB brut / 0,91 kB gzip correspond au client HTTP durci et à la gestion explicite du cycle de session; le code du tableau de bord et de la PWA est désormais différé. React, React DOM et React Router sont les principales dépendances; `npm find-dupes` ne signale aucun doublon installable.

## Vérification

```powershell
npm run docker:up
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run build
```

Les tests d’intégration créent/utilisent la base isolée `maktaba_test`, appliquent les migrations et nettoient les tables entre les cas. Ils exigent le PostgreSQL de développement disponible. Le profil navigateur doit confirmer l’absence de service worker en développement, une seule paire bootstrap/session, aucun décalage de mise en page et aucune erreur console.

## Limites connues

Les modules métier en ligne ne sont pas encore implémentés et il n’existe aucune synchronisation avec le desktop. Les mesures réseau devront être refaites sur le VPS avec HTTPS, latence réelle et données représentatives. Le service worker de production précache l’interface statique mais l’API reste exclusivement réseau.
