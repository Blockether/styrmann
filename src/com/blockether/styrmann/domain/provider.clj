(ns com.blockether.styrmann.domain.provider
  "Domain rules for LLM provider management."
  (:require
   [babashka.http-client :as http]
   [charred.api :as json]
   [clojure.string :as str]
   [com.blockether.styrmann.db.provider :as db.provider]))

(defn list-providers
  "List all configured LLM providers."
  [conn]
  (db.provider/list-providers conn))

(defn get-provider
  "Fetch a provider by ID."
  [conn provider-id]
  (db.provider/find-provider conn provider-id))

(defn get-default-provider
  "Fetch the default LLM provider."
  [conn]
  (db.provider/find-default-provider conn))

(defn add-provider!
  "Add a new LLM provider.

   Params:
   `conn` - Datalevin connection.
   `attrs` - Map with :name, :base-url, :api-key, and optional :default?

   Returns:
   Created provider map.

   Throws:
   Exception if required fields are missing."
  [conn {:keys [name base-url api-key default?]}]
  (when (or (str/blank? name) (str/blank? base-url) (str/blank? api-key))
    (throw (ex-info "Provider requires name, base-url, and api-key" {})))
  (db.provider/create-provider! conn {:name name :base-url base-url :api-key api-key :default? default?}))

(defn update-provider!
  "Update an existing LLM provider.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID.
   `attrs` - Map with optional :name, :base-url, :api-key, :default?

   Returns:
   Updated provider map."
  [conn provider-id attrs]
  (db.provider/update-provider! conn provider-id attrs))

(defn fetch-models
  "Fetch available models from a provider's /v1/models endpoint.

   Params:
   `provider` - Provider map with :provider/base-url, :provider/api-key.

   Returns:
   Vector of model ID strings, or empty vec on error."
  [provider]
  (try
    (let [base-url (str/replace (:provider/base-url provider) #"/+$" "")
          url (if (str/ends-with? base-url "/models")
                base-url
                (str base-url "/models"))
          resp (http/get url
                 {:headers {"Authorization" (str "Bearer " (:provider/api-key provider))
                            "Accept" "application/json"}
                  :timeout 15000
                  :version :http1.1})
          body (json/read-json (:body resp) :key-fn keyword)]
      (->> (:data body)
           (map :id)
           (filter some?)
           (sort)
           vec))
    (catch Exception _ [])))

(defn fetch-all-models
  "Fetch models from all providers. Returns map of provider-id → model list.

   Params:
   `conn` - Datalevin connection.

   Returns:
   Map of UUID → vector of model ID strings."
  [conn]
  (let [providers (list-providers conn)]
    (into {}
          (map (fn [p]
                 [(:provider/id p) (fetch-models p)])
               providers))))

(defn set-default!
  "Set a provider as the default.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID.

   Returns:
   Updated provider map."
  [conn provider-id]
  (db.provider/set-default-provider! conn provider-id))
