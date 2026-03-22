(ns com.blockether.styrmann.execution.agent
  "Svar-backed agent utilities for execution namespaces.

   This namespace centralizes RLM wiring so execution code does not depend on
   Svar details directly.

   Provider resolution order:
   1. Explicit :provider map passed in opts
   2. Default provider from context (via :find-default-provider in opts)
   3. Environment variables (BLOCKETHER_OPENAI_API_KEY, etc.)

   Default model: glm-5-turbo (Blockether LLM)."
  (:require
   [clojure.string :as str]
   [com.blockether.svar.core :as svar]))

(def default-model
  "Default LLM model for all execution."
  "glm-5-turbo")

(defn- env
  "Read environment variable by key, returning nil when blank."
  [k]
  (let [value (System/getenv k)]
    (when (and value (not (str/blank? value)))
      value)))

(defn provider->config
  "Convert a DB provider map to a Svar config map.

   Params:
   `provider` - Map with :provider/api-key, :provider/base-url.
   `model`    - Optional model override. Defaults to `default-model`.

   Returns:
   Svar config map with :api-key, :base-url, :model."
  [provider model]
  (let [opts {:api-key  (:provider/api-key provider)
              :base-url (:provider/base-url provider)
              :model    (or model default-model)}]
    (svar/make-config opts)))

(defn default-config
  "Build default Svar config for OpenAI-compatible APIs from environment.

   Reads (in priority order):
   - BLOCKETHER_OPENAI_API_KEY or BLOCKETHER_LLM_API_KEY or OPENAI_API_KEY
   - BLOCKETHER_OPENAI_BASE_URL or BLOCKETHER_LLM_API_BASE_URL or OPENAI_BASE_URL
   - BLOCKETHER_LLM_DEFAULT_MODEL (optional, defaults to glm-5-turbo)

   Returns nil when no API key is configured."
  []
  (let [api-key  (or (env "BLOCKETHER_OPENAI_API_KEY")
                     (env "BLOCKETHER_LLM_API_KEY")
                     (env "OPENAI_API_KEY"))
        base-url (or (env "BLOCKETHER_OPENAI_BASE_URL")
                     (env "BLOCKETHER_LLM_API_BASE_URL")
                     (env "OPENAI_BASE_URL"))
        model    (or (env "BLOCKETHER_LLM_DEFAULT_MODEL") default-model)]
    (when api-key
      (svar/make-config (cond-> {:api-key api-key :model model}
                          base-url (assoc :base-url base-url))))))

(defn resolve-config
  "Resolve Svar config from provider map, find-default-provider fn, or env vars.

   Params:
   `opts` - Map with optional keys:
     :provider              - DB provider map (highest priority)
     :find-default-provider - Zero-arity fn returning default provider (replaces :conn)
     :model                 - Model override
     :config                - Pre-built Svar config (bypasses resolution)

   Returns:
   Svar config map or nil."
  [{:keys [provider find-default-provider model config]}]
  (or config
      (when provider
        (provider->config provider model))
      (when find-default-provider
        (when-let [db-provider (find-default-provider)]
          (provider->config db-provider model)))
      (default-config)))

(defn ask!
  "Call Svar ask! with config resolution.

   Config is resolved in order: explicit :config > :provider > :find-default-provider > env vars."
  [opts]
  (let [cfg (resolve-config opts)
        opts (cond-> opts
               cfg (assoc :config cfg))]
    (svar/ask! opts)))

(def system svar/system)
(def user svar/user)
(def assistant svar/assistant)
