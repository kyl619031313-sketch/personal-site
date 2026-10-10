FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
# Install only the admin's runtime dependency, outside the persistent checkout.
RUN npm install --prefix /opt/admin --omit=dev --no-package-lock yaml@2.9.1
ENV NODE_PATH=/opt/admin/node_modules
COPY deploy/entrypoint.sh /usr/local/bin/admin-entrypoint
RUN chmod +x /usr/local/bin/admin-entrypoint
ENTRYPOINT ["/usr/local/bin/admin-entrypoint"]
