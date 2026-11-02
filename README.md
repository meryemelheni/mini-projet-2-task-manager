Mini-projet 2 : Déploiement d'une application 3-tiers (Task Manager) sur k3s
	
Nom	Elheni
Prénom	Maryem
Classe	MDOC 2
Enseignant	M. Haithem Hafsi
Sommaire
Architecture et schéma
Description de l'application
Structure du dépôt
Tableau des exigences (E1 à E15)
Preuves détaillées
Matrice des flux réseau et tests
Justification des exceptions de durcissement
Réponses aux questions des phases
Difficultés rencontrées
1. Architecture et schéma

L'application est organisée en trois niveaux, déployés sur un cluster k3s. Le trafic suit le chemin suivant :

Utilisateur → Ingress Traefik → Frontend → API → Base de données

Base de données
API
Frontend
http://app.k3s.local
requêtes /api/
connexion à la base
Utilisateurnavigateur web
Ingress Traefikapp.k3s.local
Service frontend-svcClusterIP
Deployment frontend2 réplicas (Nginx)
Service api-svcClusterIP
Deployment api2 réplicas (Node.js)
Service dbHeadless
StatefulSet postgres1 réplica
Volume persistant (PVC)1Gi
2. Description de l'application

L'application est un gestionnaire de tâches (Task Manager) avec un design moderne. Elle comporte trois niveaux :

Frontend : Nginx + HTML/JS/Tailwind
API : Node.js / Express
Base de données : PostgreSQL

L'API expose des routes CRUD (/api/taches) et deux routes de santé (/health et /ready). Les données sont stockées dans PostgreSQL. Tout est déployé sur un cluster k3s via des manifestes YAML dans un dépôt structuré.

3. Structure du dépôt
task-manager/
├── .gitignore
├── docker-compose.yml
├── secret.example.yaml      # modèle du Secret (le vrai secret n'est pas versionné)
├── api/
│   ├── Dockerfile
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── Dockerfile
│   ├── index.html
│   └── nginx.conf
└── k8s/
    ├── 00-namespace.yaml
    ├── 05-quotas.yaml
    ├── 10-config.yaml
    ├── 20-db.yaml
    ├── 30-app.yaml
    └── 40-ingress.yaml
4. Tableau des exigences (E1 à E15)
Exigence	Description	Preuve (capture)
E1	Images versionnées	E1-Pods-Running.png
E2	Namespace + quotas	E2-Quotas-LimitRange.png
E3	ConfigMap / Secret	E3-Config-Secret.png
E4	Pas de secrets dans Git	E4-Gitignore.png (seul un modèle secret.example.yaml est présent)
E5	Base en StatefulSet	E5-BaseDeDonnees-PVC.png
E6	Persistance	E6-Persistance-Avant.png, E6-Persistance-Suppression.png, E6-Persistance-Apres.png
E7	L'API attend la base	Readiness probe sur /ready (voir E7)
E8	Ressources	E8-Ressources-Sondes.png
E9	Sondes	E8-Ressources-Sondes.png
E10	Ingress	E10-Ingress.png
E11	Sauvegarde CronJob	Non implémenté (voir E11)
E12	RBAC	RBAC-1.png, RBAC-2.png
E13	Durcissement	E13-SecurityContext.png
E14	NetworkPolicies	NetworkPolicies.png, App-Fonctionne.png
E15	Dépôt Git	E15-Dossier-Git.png
5. Preuves détaillées
E1 — Images versionnées
bash
kubectl get pods -n tp-app -o wide

E1 - Pods Running

E2 — Namespace et quotas
bash
kubectl apply -f ~/task-manager/k8s/05-quotas.yaml
kubectl describe quota -n tp-app
kubectl describe limitrange -n tp-app

E2 - Quotas et LimitRange

E3 — ConfigMap et Secret
bash
kubectl get configmap,secret -n tp-app

E3 - ConfigMap et Secret

E4 — Pas de secrets dans Git

Le fichier secret n'est pas versionné, seul un modèle (secret.example.yaml) est présent dans le dépôt.

E4 - Gitignore

E5 — Base en StatefulSet
bash
kubectl get statefulset,pvc,pv -n tp-app

E5 - StatefulSet, PVC et PV

E6 — Persistance

Avant la suppression du pod de la base :

E6 - Avant

Suppression du pod postgres-0 :

bash
kubectl delete pod postgres-0 -n tp-app

E6 - Suppression

Après la recréation du pod : les tâches sont toujours présentes.

E6 - Après

E7 — L'API attend la base

L'API utilise une readiness probe sur /ready (qui vérifie la connexion à la base). Cela permet de retarder l'envoi du trafic vers l'API tant que la base n'est pas prête, remplissant le même rôle qu'un InitContainer.

E8 et E9 — Ressources et sondes
bash
kubectl describe pod -n tp-app -l app=api | grep -A 5 "Limits\|Requests"

E8/E9 - Ressources et sondes

E10 — Ingress
bash
kubectl get ingress -n tp-app

E10 - Ingress

E11 — Sauvegarde CronJob

Non implémenté dans cette version en raison du temps imparti. La base de données PostgreSQL tourne dans un StatefulSet avec un volume persistant (PVC), ce qui garantit la persistance des données, mais la sauvegarde automatisée vers un volume externe fera l'objet d'une prochaine itération.

E12 — RBAC

Le ServiceAccount dev-viewer peut lister les pods :

bash
kubectl auth can-i list pods --as=system:serviceaccount:tp-app:dev-viewer -n tp-app

RBAC-1

Mais ne peut pas les supprimer :

bash
kubectl auth can-i delete pods --as=system:serviceaccount:tp-app:dev-viewer -n tp-app

RBAC-2

E13 — Durcissement
bash
kubectl get pod -n tp-app -l app=api -o yaml | grep -A 5 "securityContext"

E13 - SecurityContext

E14 — NetworkPolicies
bash
kubectl get networkpolicy -n tp-app

NetworkPolicies

Application accessible sur app.k3s.local :

Application fonctionnelle

E15 — Dépôt Git
bash
ls -R

E15 - Dossier Git

6. Matrice des flux réseau et tests

Une politique default-deny a été appliquée, puis les flux strictement nécessaires ont été autorisés :

Source	Destination	Port
Traefik	Frontend	80
Frontend	API	3000
API	Base de données	5432

Test : l'application a renvoyé une erreur « Bad Gateway » quand on a oublié d'autoriser Traefik, puis a refonctionné après correction.

7. Justification des exceptions de durcissement

Le frontend (Nginx) n'a pas pu recevoir le securityContext complet (runAsNonRoot) car l'image de base a besoin d'écrire dans ses dossiers temporaires. Cependant, l'API (Node.js) a reçu un durcissement complet (runAsNonRoot, drop ALL, allowPrivilegeEscalation: false), comme le prouve la capture E13.

8. Réponses aux questions des phases

Q1. Pourquoi un secret ne doit-il jamais figurer dans le code ? Car le code est souvent versionné et partagé, ce qui exposerait le secret à toute personne ayant accès au dépôt.

Q2. Quelle différence entre imagePullPolicy: Always et IfNotPresent ? Always force le téléchargement à chaque démarrage, IfNotPresent utilise l'image locale si elle existe (plus rapide et moins de bande passante).

Q3. Pourquoi un StatefulSet plutôt qu'un Deployment pour la base ? Le StatefulSet garantit un nom de pod stable (postgres-0) et un volume persistant dédié (PVC), ce qui est crucial pour une base de données.

Q4. Pourquoi ne pas exposer l'API par l'Ingress ? Pour des raisons de sécurité. Seul le frontend doit être accessible de l'extérieur. L'API et la base communiquent uniquement en interne.

Q5. Où se trouvent les données avec local-path ? Physiquement sur le disque du nœud qui héberge le pod (dans /var/lib/rancher/k3s/storage). Si ce nœud tombe, les données sont perdues.

Q6. Une sauvegarde sur le même nœud protège-t-elle d'une panne ? Non, si le nœud tombe, la base et la sauvegarde disparaissent ensemble. Il faudrait copier les sauvegardes sur un stockage réseau.

Q7. Pourquoi désactiver le jeton de ServiceAccount ? Pour éviter qu'un pod compromis puisse utiliser ce jeton pour interagir avec l'API Kubernetes.

Q8. Pourquoi un « deny all » avant les autorisations ? C'est une approche zero-trust : on bloque tout par défaut et on n'ouvre que les ports strictement nécessaires.

Q9. Quelle est la limite d'une politique qui ne filtre que l'ingress ? Elle ne contrôle pas le trafic sortant (egress), un pod compromis pourrait donc exfiltrer des données vers l'extérieur.

9. Difficultés rencontrées
Problème de cache de navigateur (design qui ne se mettait pas à jour).
Configuration du proxy Nginx pour pointer vers le service api-svc.
Erreur Bad Gateway après l'application des NetworkPolicies (oubli de la règle autorisant Traefik).
Difficulté avec les permissions Nginx (obligation de retirer le runAsNonRoot sur le frontend).
