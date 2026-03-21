(ns com.blockether.styrmann.execution.agent
  "Svar-backed agent utilities for execution namespaces.

   This namespace centralizes RLM wiring so execution code does not depend on
   Svar details directly."
  (:require
   [clojure.string :as str]
   [com.blockether.svar.core :as svar]))

(defn- env
  "Read environment variable by key, returning nil when blank."
  [k]
  (let [value (System/getenv k)]
    (when (and value (not (str/blank? value)))
      value)))

(defn default-config
  "Build default Svar config for OpenAI-compatible APIs from environment.

   Reads:
   - BLOCKETHER_LLM_API_KEY or OPENAI_API_KEY
   - BLOCKETHER_LLM_API_BASE_URL or OPENAI_BASE_URL
   - BLOCKETHER_LLM_DEFAULT_MODEL (optional)

   Returns nil when no API key is configured."
  []
  (let [api-key  (or (env "BLOCKETHER_LLM_API_KEY")
                     (env "OPENAI_API_KEY"))
        base-url (or (env "BLOCKETHER_LLM_API_BASE_URL")
                     (env "OPENAI_BASE_URL"))
        model    (env "BLOCKETHER_LLM_DEFAULT_MODEL")]
    (when api-key
      (let [opts (cond-> {:api-key api-key}
                   base-url (assoc :base-url base-url)
                   model    (assoc :model model))]
        (if-let [make-config (requiring-resolve 'com.blockether.svar.core/make-config)]
          (make-config opts)
          nil)))))

(defn ask!
  "Call Svar ask! with optional default config fallback."
  [opts]
  (let [opts (if (:config opts)
               opts
               (if-let [cfg (default-config)]
                 (assoc opts :config cfg)
                 opts))]
    (svar/ask! opts)))

(def system svar/system)
(def user svar/user)
(def assistant svar/assistant)
