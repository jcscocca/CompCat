FROM node:22.23.3-bookworm-slim@sha256:bbf39cb344bb33c1f2eedb3b45b4a890eecfbac91a4f7bac020a95d4e4ea147e AS node_toolchain
FROM mcr.microsoft.com/playwright:v1.63.0-noble@sha256:bc6ab0d6d44ff4826e4cb8c1e6d801e185bfc42bb0753f8e2a30efc70db054c7
USER root
COPY --from=node_toolchain /usr/local/bin/node /usr/local/bin/node
COPY --from=node_toolchain /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx && test "$(node --version)" = v22.23.3 && test "$(id -u pwuser)" = 1001 && test "$(id -g pwuser)" = 1001
ENV HOME=/home/pwuser CI=true PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_SKIP_BROWSER_GC=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMEXPR_NUM_THREADS=1 GOMAXPROCS=2 RAYON_NUM_THREADS=2 UV_THREADPOOL_SIZE=2
COPY --chown=pwuser:pwuser . /work
USER pwuser
WORKDIR /work/frontend
RUN npm ci --no-audit --no-fund
ARG COMPCAT_CI_RUN_ID
ARG COMPCAT_CI_ATTEMPT
LABEL compcat.ci.kind=browser compcat.ci.run=$COMPCAT_CI_RUN_ID compcat.ci.attempt=$COMPCAT_CI_ATTEMPT
CMD ["/bin/bash", "/work/scripts/ci_browser_entry.sh"]
