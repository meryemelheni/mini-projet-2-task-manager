FROM node:18-alpine

# Créer un répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances et installer
COPY package.json ./
RUN npm install --omit=dev

# Copier le code source
COPY server.js ./

# Créer un utilisateur non-root et basculer dessus
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Exposer le port par défaut
EXPOSE 3000

# Démarrer l'API
CMD ["node", "server.js"]
