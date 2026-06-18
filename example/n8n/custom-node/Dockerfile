FROM node:22-alpine AS builder
WORKDIR /work/example/n8n/custom-node

RUN npm install -g npm@11.17.0

COPY example/n8n/custom-node/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund --omit=optional --omit=peer

COPY example/n8n/custom-node ./

RUN npm run build \
 && npm run smoke:load \
 && npm prune --omit=dev --omit=optional \
 && node -e "import('@openbox-ai/openbox-sdk').then(() => console.log('sdk-import-ok'))"

# ---------------------------------------------------------------------------

FROM n8nio/n8n:latest
USER root

# Stage the compiled node + its runtime deps in /opt; the entrypoint
# copies it into the n8n data volume on first start so the volume mount at
# /home/node/.n8n does not shadow the install.
RUN mkdir -p /opt/custom-nodes/n8n-nodes-openbox-hook
COPY --from=builder /work/example/n8n/custom-node/package.json /opt/custom-nodes/n8n-nodes-openbox-hook/
COPY --from=builder /work/example/n8n/custom-node/dist /opt/custom-nodes/n8n-nodes-openbox-hook/dist
COPY --from=builder /work/example/n8n/custom-node/node_modules /opt/openbox-runtime/node_modules
RUN mkdir -p /opt/custom-nodes/n8n-nodes-openbox-hook/node_modules \
 && mkdir -p /opt/custom-nodes/n8n-nodes-openbox-hook/node_modules/@openbox-ai \
 && ln -s /opt/openbox-runtime/node_modules/@openbox-ai/openbox-sdk /opt/custom-nodes/n8n-nodes-openbox-hook/node_modules/@openbox-ai/openbox-sdk

COPY example/n8n/custom-node/entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

USER node
ENTRYPOINT ["/opt/entrypoint.sh"]
