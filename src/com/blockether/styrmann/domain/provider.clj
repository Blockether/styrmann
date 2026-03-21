(ns com.blockether.styrmann.domain.provider
  "Domain rules for LLM provider management."
  (:require
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

(defn set-default!
  "Set a provider as the default.

   Params:
   `conn` - Datalevin connection.
   `provider-id` - UUID.

   Returns:
   Updated provider map."
  [conn provider-id]
  (db.provider/set-default-provider! conn provider-id))
